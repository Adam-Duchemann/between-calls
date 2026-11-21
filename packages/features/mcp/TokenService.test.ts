import { createHash } from "node:crypto";
import type { PrismaClient } from "@calcom/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { TokenService } from "./TokenService";

const resource = "https://cal.example.test/api/mcp";
const verifier = "v".repeat(43);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const exchange = {
  grant_type: "authorization_code",
  code: "test-code",
  client_id: "client-1",
  resource,
  redirect_uri: "https://client.example.test/callback",
  code_verifier: verifier,
};

function setup() {
  const prisma = mockDeep<PrismaClient>();
  const row = {
    id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    userId: 1,
    clientId: "client-1",
    resource,
    scopes: ["cal:read", "cal:propose"],
    redirectUri: exchange.redirect_uri,
    codeHash: hash(exchange.code),
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    codeExpiresAt: new Date(Date.now() + 600000),
    createdAt: new Date(),
    accessTokenHash: null as string | null,
    accessExpiresAt: null as Date | null,
    refreshTokenHash: null as string | null,
    refreshExpiresAt: null as Date | null,
    revokedAt: null,
  };
  prisma.mcpGrant.findFirst.mockResolvedValue(row);
  prisma.mcpGrant.updateMany.mockResolvedValue({ count: 1 });
  const service = new TokenService(
    prisma,
    "https://cal.example.test",
    "test-private-secret-with-at-least-32-characters"
  );
  return { prisma, row, service };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("MCP resource-bound tokens", () => {
  it("stores only hashes, consumes the code atomically and returns scoped short-lived tokens", async () => {
    const { service, prisma } = setup();
    const tokens = await service.exchange(exchange);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 1800, scope: "cal:read cal:propose" });
    const update = prisma.mcpGrant.updateMany.mock.calls[0][0];
    expect(update).toMatchObject({
      where: { codeHash: hash(exchange.code), resource, revokedAt: null, user: { locked: false } },
      data: {
        codeHash: null,
        accessTokenHash: hash(tokens.access_token),
        refreshTokenHash: hash(tokens.refresh_token),
      },
    });
    expect(JSON.stringify(prisma.mcpGrant.updateMany.mock.calls)).not.toContain(tokens.access_token);
    expect(JSON.stringify(prisma.mcpGrant.updateMany.mock.calls)).not.toContain(tokens.refresh_token);
  });

  it("rejects a different resource, redirect, verifier, or unavailable code", async () => {
    for (const changed of [
      { resource: "https://elsewhere.test/api/mcp" },
      { redirect_uri: "https://attacker.test/cb" },
      { code_verifier: "x".repeat(43) },
    ]) {
      const { service, prisma } = setup();
      await expect(service.exchange({ ...exchange, ...changed })).rejects.toThrow();
      expect(prisma.mcpGrant.updateMany).not.toHaveBeenCalled();
    }
    const { service, prisma } = setup();
    prisma.mcpGrant.findFirst.mockResolvedValue(null);
    await expect(service.exchange(exchange)).rejects.toThrow("invalid_grant");
    expect(prisma.mcpGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: "client-1", resource, codeExpiresAt: { gt: new Date() } }),
      })
    );
  });

  it("issues tokens to only one of two concurrent code exchanges", async () => {
    const { service, prisma } = setup();
    prisma.mcpGrant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([service.exchange(exchange), service.exchange(exchange)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("rotates refresh tokens and revokes the connection on reuse of an old signed token", async () => {
    const { service, row, prisma } = setup();
    const initial = await service.exchange(exchange);
    row.refreshTokenHash = hash(initial.refresh_token);
    row.refreshExpiresAt = new Date(Date.now() + 30 * 86400000);
    const rotated = await service.exchange({
      grant_type: "refresh_token",
      client_id: row.clientId,
      resource,
      refresh_token: initial.refresh_token,
    });
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    row.refreshTokenHash = hash(rotated.refresh_token);
    await expect(
      service.exchange({
        grant_type: "refresh_token",
        client_id: row.clientId,
        resource,
        refresh_token: initial.refresh_token,
      })
    ).rejects.toThrow("invalid_grant");
    expect(prisma.mcpGrant.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: row.id },
        data: expect.objectContaining({
          revokedAt: new Date(),
          accessTokenHash: null,
          refreshTokenHash: null,
        }),
      })
    );
  });

  it("rejects forged refresh tokens without revoking an unrelated connection", async () => {
    const { service, prisma } = setup();
    await expect(
      service.exchange({
        grant_type: "refresh_token",
        client_id: "client-1",
        resource,
        refresh_token: "forged",
      })
    ).rejects.toThrow("invalid_grant");
    expect(prisma.mcpGrant.updateMany).not.toHaveBeenCalled();
  });

  it("lists only the owner's connections without token hashes or confirmation material", async () => {
    const { service, prisma } = setup();
    prisma.mcpGrant.findMany.mockResolvedValue([]);
    expect(await service.connections(7, {})).toEqual({ items: [], nextCursor: null });
    expect(prisma.mcpGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, revokedAt: null }, take: 101 })
    );
    const query = JSON.stringify(prisma.mcpGrant.findMany.mock.calls[0]);
    expect(query).not.toMatch(/Hash|Challenge|payload|redirectUri/);
    await expect(service.connections(7, { userId: 99 })).rejects.toThrow();
  });

  it("binds browser revocation to the cookie owner and clears every credential", async () => {
    const { service, prisma } = setup();
    await service.revokeForOwner(7, "grant-1");
    expect(prisma.mcpGrant.updateMany).toHaveBeenCalledWith({
      where: { id: "grant-1", userId: 7 },
      data: { revokedAt: new Date(), codeHash: null, accessTokenHash: null, refreshTokenHash: null },
    });
  });

  it("authenticates only active tokens for this resource and returns no token material", async () => {
    const { service, prisma, row } = setup();
    expect(await service.authenticate("cal_mcp_a_test")).toEqual({
      userId: 1,
      grantId: row.id,
      clientId: row.clientId,
      scopes: row.scopes,
    });
    expect(prisma.mcpGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accessTokenHash: hash("cal_mcp_a_test"),
          resource,
          revokedAt: null,
          accessExpiresAt: { gt: new Date() },
          user: { locked: false },
        }),
      })
    );
    prisma.mcpGrant.findFirst.mockResolvedValue(null);
    await expect(service.authenticate("cal_mcp_a_expired")).rejects.toThrow("invalid_token");
  });
});
