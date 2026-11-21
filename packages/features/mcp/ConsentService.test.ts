import type { PrismaClient } from "@calcom/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { ConsentService } from "./ConsentService";
import { tokenHash } from "./TokenService";

const request = {
  client_id: "client-1",
  response_type: "code",
  redirect_uri: "https://client.test/callback",
  resource: "https://cal.test/api/mcp",
  scope: "cal:read cal:propose",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  state: "original-state",
};
function setup() {
  const prisma = mockDeep<PrismaClient>();
  prisma.user.count.mockResolvedValue(1);
  prisma.mcpClient.findUnique.mockResolvedValue({
    id: "client-1",
    name: "Test assistant",
    redirectUris: [request.redirect_uri],
    createdAt: new Date(),
  });
  const service = new ConsentService(
    prisma,
    "https://cal.test",
    "test-private-secret-with-at-least-32-characters"
  );
  return { prisma, service };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("MCP account consent", () => {
  it("does not grant access when merely showing the exact client, redirect and scopes", async () => {
    const { prisma, service } = setup();
    const review = await service.preview(1, request);
    expect(review).toMatchObject({
      clientName: "Test assistant",
      request: { ...request, scope: "cal:propose cal:read" },
    });
    expect(prisma.mcpGrant.create).not.toHaveBeenCalled();
  });

  it("binds consent to the account, scopes, callback and original state", async () => {
    const { prisma, service } = setup();
    const review = await service.preview(1, request);
    for (const changes of [
      { ...review, request: { ...review.request, scope: "cal:read" } },
      { ...review, request: { ...review.request, redirect_uri: "https://attacker.test/callback" } },
      { ...review, request: { ...review.request, state: "changed-state" } },
      { ...review, consentToken: "true" },
    ]) {
      await expect(service.approve(1, changes)).rejects.toThrow();
    }
    await expect(service.approve(2, review)).rejects.toThrow();
    expect(prisma.mcpGrant.create).not.toHaveBeenCalled();
  });

  it("rejects unknown clients, callback mismatches and other resources before review", async () => {
    const { prisma, service } = setup();
    await expect(
      service.preview(1, { ...request, redirect_uri: "https://client.test/callback/other" })
    ).rejects.toThrow();
    await expect(
      service.preview(1, { ...request, resource: "https://other.test/api/mcp" })
    ).rejects.toThrow();
    prisma.mcpClient.findUnique.mockResolvedValue(null);
    await expect(service.preview(1, request)).rejects.toThrow();
  });

  it("creates a one-time hashed authorization code only after valid explicit consent", async () => {
    const { prisma, service } = setup();
    const review = await service.preview(1, request);
    const callback = new URL(await service.approve(1, review));
    expect(callback.origin + callback.pathname).toBe(request.redirect_uri);
    expect(callback.searchParams.get("state")).toBe("original-state");
    const code = callback.searchParams.get("code")!;
    expect(prisma.mcpGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: review.authorizationId,
          userId: 1,
          clientId: "client-1",
          resource: request.resource,
          scopes: ["cal:propose", "cal:read"],
          codeHash: tokenHash(code),
          codeChallenge: request.code_challenge,
        }),
      })
    );
    expect(JSON.stringify(prisma.mcpGrant.create.mock.calls)).not.toContain(code);
    prisma.mcpGrant.create.mockRejectedValue({ code: "P2002" });
    await expect(service.approve(1, review)).rejects.toThrow("invalid_request");
  });

  it("rejects expired consent and supports declining without a grant", async () => {
    const { prisma, service } = setup();
    const review = await service.preview(1, request);
    const callback = new URL(await service.decline(1, review));
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe(request.state);
    vi.setSystemTime(new Date(review.expiresAt));
    await expect(service.approve(1, review)).rejects.toThrow();
    expect(prisma.mcpGrant.create).not.toHaveBeenCalled();
  });
});
