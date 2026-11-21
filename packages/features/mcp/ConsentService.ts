import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { z } from "zod";
import { canonicalHash } from "./integrity";
import {
  type AuthorizationRequest,
  authorizationSchema,
  registrationSchema,
  resourceUrl,
} from "./oauthPolicy";
import { tokenHash } from "./TokenService";

const consentSchema = z
  .object({
    request: authorizationSchema,
    authorizationId: z.string().uuid(),
    clientName: z.string().min(1).max(200),
    expiresAt: z.string().datetime(),
    consentToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ConsentReview = z.infer<typeof consentSchema>;
const invalid = () => new ErrorWithCode(ErrorCode.BadRequest, "invalid_request");

export class ConsentService {
  readonly resource: string;
  constructor(
    private readonly prisma: Pick<PrismaClient, "mcpClient" | "mcpGrant" | "user">,
    baseUrl: string,
    private readonly secret: string
  ) {
    this.resource = resourceUrl(baseUrl);
    if (secret.length < 32) throw new Error("MCP consent requires a persistent private secret.");
  }

  async register(input: unknown) {
    const request = registrationSchema.parse(input);
    const client = await this.prisma.mcpClient.create({
      data: { name: request.client_name, redirectUris: request.redirect_uris },
      select: { id: true, createdAt: true },
    });
    return {
      ...request,
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.valueOf() / 1000),
    };
  }

  async preview(userId: number, input: unknown): Promise<ConsentReview> {
    const request = authorizationSchema.parse(input);
    const client = await this.validate(userId, request);
    const review = {
      request,
      authorizationId: randomUUID(),
      clientName: client.name,
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    };
    return { ...review, consentToken: this.proof(userId, review) };
  }

  async approve(userId: number, input: unknown) {
    const review = await this.verify(userId, input);
    const code = randomBytes(32).toString("base64url");
    try {
      await this.prisma.mcpGrant.create({
        data: {
          id: review.authorizationId,
          userId,
          clientId: review.request.client_id,
          resource: this.resource,
          scopes: review.request.scope.split(" "),
          redirectUri: review.request.redirect_uri,
          codeHash: tokenHash(code),
          codeChallenge: review.request.code_challenge,
          codeExpiresAt: new Date(Date.now() + 10 * 60000),
        },
        select: { id: true },
      });
    } catch (error) {
      // The signed authorization ID is the unique grant key, so replaying consent cannot mint another code.
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw invalid();
      throw error;
    }
    return this.callback(review.request, { code });
  }

  async decline(userId: number, input: unknown) {
    const review = await this.verify(userId, input);
    return this.callback(review.request, { error: "access_denied" });
  }

  private async validate(userId: number, request: AuthorizationRequest) {
    if (request.resource !== this.resource) throw new ErrorWithCode(ErrorCode.BadRequest, "invalid_target");
    const userCount = await this.prisma.user.count({
      where: { id: userId, locked: false, emailVerified: { not: null } },
    });
    if (userCount !== 1) throw new ErrorWithCode(ErrorCode.Forbidden, "access_denied");
    const client = await this.prisma.mcpClient.findUnique({
      where: { id: request.client_id },
      select: { name: true, redirectUris: true },
    });
    if (!client || !client.redirectUris.includes(request.redirect_uri)) throw invalid();
    return client;
  }

  private async verify(userId: number, input: unknown) {
    const { consentToken, ...review } = consentSchema.parse(input);
    const expected = this.proof(userId, review);
    if (
      new Date(review.expiresAt) <= new Date() ||
      !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(consentToken, "hex"))
    )
      throw invalid();
    const client = await this.validate(userId, review.request);
    if (client.name !== review.clientName) throw invalid();
    return review;
  }

  private proof(userId: number, review: Omit<ConsentReview, "consentToken">) {
    return createHmac("sha256", this.secret)
      .update(`cal-mcp-consent-v1:${userId}:${canonicalHash(review)}`)
      .digest("hex");
  }

  private callback(request: AuthorizationRequest, parameters: Record<string, string>) {
    const url = new URL(request.redirect_uri);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (request.state !== undefined) url.searchParams.set("state", request.state);
    return url.toString();
  }
}
