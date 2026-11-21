// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";
import prisma from "@calcom/prisma";
import { expect, it, vi } from "vitest";
import { ConsentService } from "./ConsentService";
import { canonicalHash } from "./integrity";
import { ProposalService } from "./ProposalService";
import { TokenService } from "./TokenService";

it("connects an account, confirms exactly once, then invalidates access and pending changes on revocation", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") {
    throw new Error("This integration test requires the isolated CAL loopback database on port 55432.");
  }
  const rollback = new Error("Rollback test fixtures");
  await expect(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email: `mcp-${randomUUID()}@example.test`, emailVerified: new Date() },
          select: { id: true },
        });
        const secret = "integration-test-private-secret-at-least-32-characters";
        const baseUrl = "https://cal.example.test";
        const consent = new ConsentService(tx, baseUrl, secret);
        const tokens = new TokenService(tx, baseUrl, secret);
        const execute = vi.fn().mockResolvedValue({ bookingUid: "test-booking" });
        const proposals = new ProposalService({
          prisma: tx,
          secret,
          execute,
          prepare: async (_userId, action) => ({
            action,
            expectedState: canonicalHash({ unchanged: true }),
            summary: "Cancel test booking and notify its attendee.",
          }),
        });
        const client = await consent.register({
          client_name: "Test assistant",
          redirect_uris: ["https://client.example.test/callback"],
        });
        const verifier = "v".repeat(43);
        const request = {
          client_id: client.client_id,
          response_type: "code",
          redirect_uri: client.redirect_uris[0],
          resource: tokens.resource,
          scope: "cal:read cal:propose",
          code_challenge_method: "S256",
          code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          state: "nonce",
        };
        const review = await consent.preview(user.id, request);
        const callback = new URL(await consent.approve(user.id, review));
        const exchange = {
          grant_type: "authorization_code",
          client_id: client.client_id,
          resource: tokens.resource,
          redirect_uri: request.redirect_uri,
          code: callback.searchParams.get("code"),
          code_verifier: verifier,
        };
        const issued = await tokens.exchange(exchange);
        await expect(tokens.exchange(exchange)).rejects.toThrow("invalid_grant");
        const principal = await tokens.authenticate(issued.access_token);
        expect(principal.userId).toBe(user.id);
        const action = { kind: "booking_cancel", bookingUid: "test-booking", reason: "Unavailable" };
        const proposed = await proposals.propose(principal, action);
        expect(execute).not.toHaveBeenCalled();
        await expect(proposals.review(user.id + 1, proposed.id)).rejects.toThrow();
        const confirmation = await proposals.review(user.id, proposed.id);
        const attempts = await Promise.allSettled([
          proposals.confirm(user.id, proposed.id, confirmation.confirmationToken!),
          proposals.confirm(user.id, proposed.id, confirmation.confirmationToken!),
        ]);
        expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(await proposals.status(principal, proposed.id)).toMatchObject({ status: "SUCCEEDED" });
        const pending = await proposals.propose(principal, action);
        const pendingReview = await proposals.review(user.id, pending.id);
        const refreshRequest = {
          grant_type: "refresh_token",
          client_id: client.client_id,
          resource: tokens.resource,
          refresh_token: issued.refresh_token,
        };
        const rotated = await tokens.exchange(refreshRequest);
        await expect(tokens.exchange(refreshRequest)).rejects.toThrow("invalid_grant");
        await expect(tokens.authenticate(rotated.access_token)).rejects.toThrow("invalid_token");
        await expect(
          proposals.confirm(user.id, pending.id, pendingReview.confirmationToken!)
        ).rejects.toThrow();
        expect(execute).toHaveBeenCalledTimes(1);
      await expect(consent.approve(user.id, review)).rejects.toThrow("invalid_request");
        throw rollback;
      },
      { timeout: 20000 }
    )
  ).rejects.toBe(rollback);
});
