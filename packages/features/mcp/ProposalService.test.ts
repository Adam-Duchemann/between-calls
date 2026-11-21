import type { PrismaClient } from "@calcom/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { canonicalHash } from "./integrity";
import { ProposalService } from "./ProposalService";

const principal = { userId: 1, grantId: "grant-1" };
const action = { kind: "booking_cancel" as const, bookingUid: "booking-1", reason: "Unavailable" };
const payload = {
  action,
  expectedState: canonicalHash({ booking: "unchanged" }),
  summary: "Cancel booking-1 and notify its attendee.",
};

function setup() {
  const prisma = mockDeep<PrismaClient>();
  const prepare = vi.fn().mockResolvedValue(payload);
  const execute = vi.fn().mockResolvedValue({ bookingUid: "booking-1" });
  const service = new ProposalService({
    prisma,
    prepare,
    execute,
    secret: "test-private-secret-with-at-least-32-characters",
  });
  const row = {
    id: "proposal-1",
    grantId: "grant-1",
    userId: 1,
    payload,
    payloadHash: canonicalHash(payload),
    status: "PENDING" as const,
    expiresAt: new Date("2026-11-13T10:15:00Z"),
    createdAt: new Date(),
    completedAt: null,
    result: null,
  };
  prisma.mcpGrant.findFirst.mockResolvedValue({
    id: "grant-1",
    userId: 1,
    clientId: "client-1",
    resource: "https://cal.example.test/api/mcp",
    scopes: ["cal:read", "cal:propose"],
    redirectUri: "https://client.example.test/callback",
    codeHash: null,
    codeChallenge: "challenge",
    codeExpiresAt: new Date(),
    createdAt: new Date(),
    accessTokenHash: null,
    accessExpiresAt: null,
    refreshTokenHash: null,
    refreshExpiresAt: null,
    revokedAt: null,
  });
  prisma.mcpProposal.create.mockResolvedValue(row);
  prisma.mcpProposal.findFirst.mockResolvedValue(row);
  prisma.mcpProposal.updateMany.mockResolvedValue({ count: 1 });
  return { prisma, prepare, execute, service, row };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("trusted MCP confirmation", () => {
  it("creates only a proposal, without a mutation or confirmation proof", async () => {
    const { service, prisma, execute } = setup();
    expect(await service.propose(principal, action)).toEqual({
      id: "proposal-1",
      expiresAt: new Date("2026-11-13T10:15:00Z"),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.mcpProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 1, grantId: "grant-1", payloadHash: canonicalHash(payload) }),
      })
    );
  });

  it("rejects revoked or read-only grants before storing any proposal", async () => {
    const { service, prisma } = setup();
    prisma.mcpGrant.findFirst.mockResolvedValue(null);
    await expect(service.propose(principal, action)).rejects.toThrow();
    expect(prisma.mcpGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 1, revokedAt: null, scopes: { has: "cal:propose" } }),
      })
    );
    expect(prisma.mcpProposal.create).not.toHaveBeenCalled();
  });

  it("never exposes another owner's proposal or accepts a model confirmation flag", async () => {
    const { service, execute, prisma } = setup();
    prisma.mcpProposal.findFirst.mockResolvedValueOnce(null);
    await expect(service.review(2, "proposal-1")).rejects.toThrow();
    expect(prisma.mcpProposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 2 }) })
    );
    await expect(service.confirm(1, "proposal-1", "true")).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("binds proof to the exact stored payload", async () => {
    const { service, row, execute } = setup();
    const review = await service.review(1, row.id);
    row.payload = { ...payload, action: { ...action, reason: "Changed after review" } };
    await expect(service.confirm(1, row.id, review.confirmationToken!)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects expired proposals before execution", async () => {
    const { service, row, execute } = setup();
    const review = await service.review(1, row.id);
    vi.setSystemTime(row.expiresAt);
    await expect(service.confirm(1, row.id, review.confirmationToken!)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("atomically claims once even when two approvals race", async () => {
    const { service, row, prisma, execute } = setup();
    const review = await service.review(1, row.id);
    prisma.mcpProposal.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });
    const results = await Promise.allSettled([
      service.confirm(1, row.id, review.confirmationToken!),
      service.confirm(1, row.id, review.confirmationToken!),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(1, payload, row.id);
    expect(prisma.mcpProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
          userId: 1,
          grant: expect.objectContaining({ revokedAt: null }),
        }),
        data: { status: "EXECUTING" },
      })
    );
  });

  it("rechecks permission and state after claiming, refusing stale changes", async () => {
    const { service, row, prepare, execute, prisma } = setup();
    const review = await service.review(1, row.id);
    prepare.mockResolvedValue({ ...payload, expectedState: canonicalHash({ booking: "changed" }) });
    await expect(service.confirm(1, row.id, review.confirmationToken!)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.mcpProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("declines without calling the scheduling service", async () => {
    const { service, row, prepare, execute, prisma } = setup();
    const review = await service.review(1, row.id);
    await service.decline(1, row.id, review.confirmationToken!);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.mcpProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DECLINED" }) })
    );
  });

  it("does not retry an executing/failed proposal or expose provider errors", async () => {
    const { service, row, execute, prisma } = setup();
    const review = await service.review(1, row.id);
    execute.mockRejectedValue(new Error("secret-provider-token"));
    await expect(service.confirm(1, row.id, review.confirmationToken!)).rejects.toThrow("mcp_change_failed");
    expect(JSON.stringify(prisma.mcpProposal.updateMany.mock.calls)).not.toContain("secret-provider-token");
    prisma.mcpProposal.findFirst.mockResolvedValue({ ...row, status: "EXECUTING" });
    await expect(service.confirm(1, row.id, review.confirmationToken!)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
