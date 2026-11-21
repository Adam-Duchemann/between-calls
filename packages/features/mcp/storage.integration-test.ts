// @vitest-environment node
import { randomUUID } from "node:crypto";
import process from "node:process";
import prisma from "@calcom/prisma";
import { expect, it } from "vitest";

it("persists owner-bound MCP proposals and permits only one atomic claim", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55432") {
    throw new Error("This integration test requires the isolated CAL loopback database on port 55432.");
  }
  const rollback = new Error("Rollback test fixtures");
  await expect(
    prisma.$transaction(
      async (tx) => {
        const suffix = randomUUID();
        const user = await tx.user.create({
          data: { email: `mcp-${suffix}@example.test` },
          select: { id: true },
        });
        const client = await tx.mcpClient.create({
          data: { name: "Test client", redirectUris: ["http://127.0.0.1/callback"] },
          select: { id: true },
        });
        const grant = await tx.mcpGrant.create({
          data: {
            userId: user.id,
            clientId: client.id,
            resource: "http://127.0.0.1:3100/api/mcp",
            scopes: ["cal:read", "cal:propose"],
            redirectUri: "http://127.0.0.1/callback",
            codeHash: suffix,
            codeChallenge: "challenge",
            codeExpiresAt: new Date(Date.now() + 60000),
          },
          select: { id: true },
        });
        const proposal = await tx.mcpProposal.create({
          data: {
            userId: user.id,
            grantId: grant.id,
            payload: { action: { kind: "booking_cancel", bookingUid: "test", reason: "Test" } },
            payloadHash: "hash",
            expiresAt: new Date(Date.now() + 60000),
          },
          select: { id: true, status: true },
        });
        expect(proposal.status).toBe("PENDING");
        expect(
          await tx.mcpProposal.findFirst({
            where: { id: proposal.id, userId: user.id + 1 },
            select: { id: true },
          })
        ).toBeNull();
        const where = {
          id: proposal.id,
          userId: user.id,
          status: "PENDING" as const,
          expiresAt: { gt: new Date() },
        };
        const claims = await Promise.all([
          tx.mcpProposal.updateMany({ where, data: { status: "EXECUTING" } }),
          tx.mcpProposal.updateMany({ where, data: { status: "EXECUTING" } }),
        ]);
        expect(claims.map((claim) => claim.count).sort()).toEqual([0, 1]);
        await tx.mcpGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date() },
          select: { id: true },
        });
        expect(
          await tx.mcpProposal.findFirst({
            where: { id: proposal.id, grant: { revokedAt: null } },
            select: { id: true },
          })
        ).toBeNull();
        throw rollback;
      },
      { timeout: 15000 }
    )
  ).rejects.toBe(rollback);
});
