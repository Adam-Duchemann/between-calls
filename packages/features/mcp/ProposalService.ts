import { createHmac, timingSafeEqual } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { z } from "zod";
import { actionSchema, type McpAction } from "./actions";
import { canonicalHash } from "./integrity";

export const preparedChangeSchema = z
  .object({
    action: actionSchema,
    expectedState: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().min(1).max(2000),
  })
  .strict();
export type PreparedChange = z.infer<typeof preparedChangeSchema>;
export type McpPrincipal = { userId: number; grantId: string };
type Dependencies = {
  prisma: Pick<PrismaClient, "mcpGrant" | "mcpProposal">;
  secret: string;
  prepare: (userId: number, action: McpAction) => Promise<PreparedChange>;
  execute: (userId: number, change: PreparedChange, proposalId: string) => Promise<Prisma.InputJsonObject>;
};
const select = {
  id: true,
  userId: true,
  grantId: true,
  payload: true,
  payloadHash: true,
  expiresAt: true,
  status: true,
  result: true,
} as const;
const activeGrant = { revokedAt: null, scopes: { has: "cal:propose" }, user: { locked: false } };
const deny = () => new ErrorWithCode(ErrorCode.Forbidden, "mcp_confirmation_invalid");

export class ProposalService {
  constructor(private readonly deps: Dependencies) {
    if (deps.secret.length < 32) throw new Error("MCP confirmation requires a persistent private secret.");
  }

  async propose(principal: McpPrincipal, input: unknown) {
    const action = actionSchema.parse(input);
    const grant = await this.deps.prisma.mcpGrant.findFirst({
      where: { id: principal.grantId, userId: principal.userId, ...activeGrant },
      select: { id: true },
    });
    if (!grant) throw deny();
    const payload = preparedChangeSchema.parse(await this.deps.prepare(principal.userId, action));
    const proposal = await this.deps.prisma.mcpProposal.create({
      data: {
        userId: principal.userId,
        grantId: principal.grantId,
        payload,
        payloadHash: canonicalHash(payload),
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
      select: { id: true, expiresAt: true },
    });
    return { id: proposal.id, expiresAt: proposal.expiresAt };
  }

  // Only cookie-authenticated CAL routes may expose this proof. MCP tools return status or the review URL.
  async review(userId: number, id: string) {
    const row = await this.load(userId, id);
    const payload = preparedChangeSchema.parse(row.payload);
    if (canonicalHash(payload) !== row.payloadHash) throw deny();
    return {
      id,
      payload,
      expiresAt: row.expiresAt,
      status: row.status,
      result: row.result,
      confirmationToken:
        row.status === "PENDING" && row.expiresAt > new Date()
          ? this.proof(userId, id, row.payloadHash, row.expiresAt)
          : null,
    };
  }

  async status(principal: McpPrincipal, id: string) {
    const row = await this.deps.prisma.mcpProposal.findFirst({
      where: { id, userId: principal.userId, grantId: principal.grantId, grant: activeGrant },
      select: { id: true, status: true, expiresAt: true, result: true },
    });
    if (!row) throw deny();
    return row;
  }

  async confirm(userId: number, id: string, confirmationToken: string) {
    const row = await this.authorize(userId, id, confirmationToken);
    await this.claim(userId, id, row.payloadHash, "EXECUTING");
    try {
      const payload = preparedChangeSchema.parse(row.payload);
      const fresh = preparedChangeSchema.parse(await this.deps.prepare(userId, payload.action));
      if (canonicalHash(fresh) !== row.payloadHash) throw deny();
      const result = await this.deps.execute(userId, payload, id);
      await this.deps.prisma.mcpProposal.updateMany({
        where: { id, userId, status: "EXECUTING" },
        data: { status: "SUCCEEDED", completedAt: new Date(), result },
      });
      return result;
    } catch {
      // Provider side effects may have succeeded before a timeout. Never automatically retry a consumed proposal.
      await this.deps.prisma.mcpProposal.updateMany({
        where: { id, userId, status: "EXECUTING" },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          result: {
            message:
              "The change could not be completed. Check bookings and calendars before proposing it again.",
          },
        },
      });
      throw new ErrorWithCode(ErrorCode.BadRequest, "mcp_change_failed");
    }
  }

  async decline(userId: number, id: string, confirmationToken: string) {
    const row = await this.authorize(userId, id, confirmationToken);
    await this.claim(userId, id, row.payloadHash, "DECLINED");
    return { status: "DECLINED" as const };
  }

  private async load(userId: number, id: string) {
    const row = await this.deps.prisma.mcpProposal.findFirst({
      where: { id, userId, grant: activeGrant },
      select,
    });
    if (!row) throw deny();
    return row;
  }

  private proof(userId: number, id: string, hash: string, expiresAt: Date) {
    return createHmac("sha256", this.deps.secret)
      .update(JSON.stringify(["cal-mcp-confirmation-v1", userId, id, hash, expiresAt.toISOString()]))
      .digest("hex");
  }

  private async authorize(userId: number, id: string, confirmationToken: string) {
    const row = await this.load(userId, id);
    if (
      row.status !== "PENDING" ||
      row.expiresAt <= new Date() ||
      canonicalHash(row.payload) !== row.payloadHash
    )
      throw deny();
    const expected = this.proof(userId, id, row.payloadHash, row.expiresAt);
    if (
      !/^[a-f0-9]{64}$/.test(confirmationToken) ||
      !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(confirmationToken, "hex"))
    )
      throw deny();
    return row;
  }

  private async claim(userId: number, id: string, payloadHash: string, status: "EXECUTING" | "DECLINED") {
    const claimed = await this.deps.prisma.mcpProposal.updateMany({
      where: {
        id,
        userId,
        payloadHash,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        grant: activeGrant,
      },
      data: status === "DECLINED" ? { status, completedAt: new Date() } : { status },
    });
    if (claimed.count !== 1) throw deny();
  }
}
