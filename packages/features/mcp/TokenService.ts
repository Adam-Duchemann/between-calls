import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { resourceUrl, tokenRequestSchema } from "./oauthPolicy";

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const invalidGrant = () => new ErrorWithCode(ErrorCode.BadRequest, "invalid_grant");
const active = { revokedAt: null, user: { locked: false } };
const revokeData = () => ({
  revokedAt: new Date(),
  codeHash: null,
  accessTokenHash: null,
  refreshTokenHash: null,
});

export class TokenService {
  readonly resource: string;
  private readonly issuer: string;
  constructor(
    private readonly prisma: Pick<PrismaClient, "mcpGrant">,
    baseUrl: string,
    private readonly secret: string
  ) {
    this.resource = resourceUrl(baseUrl);
    this.issuer = new URL(this.resource).origin;
    if (secret.length < 32) throw new Error("MCP tokens require a persistent private secret.");
  }

  async exchange(input: unknown) {
    const request = tokenRequestSchema.parse(input);
    if (request.resource !== this.resource) throw new ErrorWithCode(ErrorCode.BadRequest, "invalid_target");
    const binding = { clientId: request.client_id, resource: this.resource, ...active };
    const now = new Date();
    if (request.grant_type === "authorization_code") {
      const where = { ...binding, codeHash: tokenHash(request.code), codeExpiresAt: { gt: now } };
      const grant = await this.prisma.mcpGrant.findFirst({
        where,
        select: {
          id: true,
          redirectUri: true,
          codeChallenge: true,
          scopes: true,
        },
      });
      if (
        !grant ||
        grant.redirectUri !== request.redirect_uri ||
        grant.codeChallenge !== createHash("sha256").update(request.code_verifier).digest("base64url")
      )
        throw invalidGrant();
      const issued = this.issue(grant.id, grant.scopes, new Date(Date.now() + 30 * 86400000));
      const consumed = await this.prisma.mcpGrant.updateMany({
        where: { ...where, id: grant.id },
        data: { ...issued.data, codeHash: null },
      });
      if (consumed.count !== 1) throw invalidGrant();
      return issued.tokens;
    }
    const grantId = this.verifyRefresh(request.refresh_token);
    const grant = await this.prisma.mcpGrant.findFirst({
      where: { ...binding, id: grantId, refreshExpiresAt: { gt: now } },
      select: { id: true, scopes: true, refreshTokenHash: true, refreshExpiresAt: true },
    });
    if (!grant?.refreshExpiresAt) throw invalidGrant();
    const previousHash = tokenHash(request.refresh_token);
    // A valid old signed refresh token proves reuse; revoke the whole connection, including the rotated token.
    if (grant.refreshTokenHash !== previousHash) {
      await this.revokeGrant(grant.id);
      throw invalidGrant();
    }
    const issued = this.issue(grant.id, grant.scopes, grant.refreshExpiresAt);
    const rotated = await this.prisma.mcpGrant.updateMany({
      where: { ...binding, id: grant.id, refreshTokenHash: previousHash, refreshExpiresAt: { gt: now } },
      data: issued.data,
    });
    if (rotated.count !== 1) {
      await this.revokeGrant(grant.id);
      throw invalidGrant();
    }
    return issued.tokens;
  }

  async authenticate(token: string) {
    if (!token.startsWith("cal_mcp_a_") || token.length > 200)
      throw new ErrorWithCode(ErrorCode.Unauthorized, "invalid_token");
    const grant = await this.prisma.mcpGrant.findFirst({
      where: {
        accessTokenHash: tokenHash(token),
        resource: this.resource,
        accessExpiresAt: { gt: new Date() },
        ...active,
      },
      select: { id: true, userId: true, clientId: true, scopes: true },
    });
    if (!grant) throw new ErrorWithCode(ErrorCode.Unauthorized, "invalid_token");
    return { userId: grant.userId, grantId: grant.id, clientId: grant.clientId, scopes: grant.scopes };
  }

  async revokeForOwner(userId: number, grantId: string) {
    await this.prisma.mcpGrant.updateMany({ where: { id: grantId, userId }, data: revokeData() });
  }

  async connections(userId: number, input: unknown) {
    const { afterId } = z.object({ afterId: z.string().uuid().optional() }).strict().parse(input);
    const rows = await this.prisma.mcpGrant.findMany({
      where: { userId, revokedAt: null, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: 101,
      select: {
        id: true,
        scopes: true,
        createdAt: true,
        refreshExpiresAt: true,
        codeExpiresAt: true,
        client: { select: { name: true } },
      },
    });
    return {
      items: rows.slice(0, 100).map((row) => ({
        id: row.id,
        clientName: row.client.name,
        scopes: row.scopes,
        createdAt: row.createdAt.toISOString(),
        expiresAt: (row.refreshExpiresAt ?? row.codeExpiresAt).toISOString(),
      })),
      nextCursor: rows.length > 100 ? rows[99].id : null,
    };
  }

  async revokeToken(clientId: string, token: string) {
    const hash = tokenHash(token);
    await this.prisma.mcpGrant.updateMany({
      where: {
        clientId,
        resource: this.resource,
        OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
      },
      data: revokeData(),
    });
  }

  private revokeGrant(id: string) {
    return this.prisma.mcpGrant.updateMany({ where: { id }, data: revokeData() });
  }

  private verifyRefresh(token: string): string {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ["HS256"],
        audience: this.resource,
        issuer: this.issuer,
      });
      if (
        typeof payload === "string" ||
        payload.kind !== "cal_mcp_refresh" ||
        typeof payload.sub !== "string"
      )
        throw invalidGrant();
      return payload.sub;
    } catch {
      throw invalidGrant();
    }
  }

  private issue(grantId: string, scopes: string[], refreshExpiresAt: Date) {
    const expiresIn = Math.min(1800, Math.floor((refreshExpiresAt.valueOf() - Date.now()) / 1000));
    if (expiresIn <= 0) throw invalidGrant();
    const accessToken = `cal_mcp_a_${randomBytes(32).toString("base64url")}`;
    const refreshToken = jwt.sign(
      { kind: "cal_mcp_refresh", exp: Math.floor(refreshExpiresAt.valueOf() / 1000) },
      this.secret,
      {
        algorithm: "HS256",
        audience: this.resource,
        issuer: this.issuer,
        subject: grantId,
        jwtid: randomUUID(),
      }
    );
    return {
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        scope: scopes.join(" "),
      },
      data: {
        accessTokenHash: tokenHash(accessToken),
        accessExpiresAt: new Date(Date.now() + expiresIn * 1000),
        refreshTokenHash: tokenHash(refreshToken),
        refreshExpiresAt,
      },
    };
  }
}
