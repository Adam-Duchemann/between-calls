import process from "node:process";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { ConsentService } from "@calcom/features/mcp/ConsentService";
import { resourceUrl } from "@calcom/features/mcp/oauthPolicy";
import { TokenService } from "@calcom/features/mcp/TokenService";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import prisma from "@calcom/prisma";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { LRUCache } from "lru-cache";
import { cookies, headers } from "next/headers";
import { ZodError } from "zod";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
const traffic = new LRUCache<string, { count: number; reset: number }>({ max: 4096 });
const safeErrors = new Set([
  "invalid_request",
  "invalid_grant",
  "invalid_target",
  "invalid_client",
  "invalid_scope",
  "invalid_token",
  "access_denied",
  "temporarily_unavailable",
  "mcp_confirmation_invalid",
  "mcp_change_failed",
]);

export function mcpConfig() {
  const resource = resourceUrl(process.env.CAL_MCP_BASE_URL || process.env.NEXT_PUBLIC_WEBAPP_URL || "");
  const origin = new URL(resource).origin;
  const secret = process.env.NEXTAUTH_SECRET || "";
  const allowedOrigins = (process.env.CAL_MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const allowed of allowedOrigins) {
    if (new URL(resourceUrl(allowed)).origin !== allowed) throw new Error("Invalid configured MCP origin.");
  }
  return { resource, origin, secret, allowedOrigins };
}

export function mcpServices() {
  const config = mcpConfig();
  return {
    ...config,
    consent: new ConsentService(prisma, config.origin, config.secret),
    tokens: new TokenService(prisma, config.origin, config.secret),
  };
}

export async function cookieUser() {
  const incoming = await headers();
  // getServerSession can otherwise accept a bearer token via next-auth's getToken fallback.
  if (incoming.has("authorization")) throw new ErrorWithCode(ErrorCode.Forbidden, "access_denied");
  const session = await getServerSession({ req: buildLegacyRequest(incoming, await cookies()) });
  if (!session?.user?.id) throw new ErrorWithCode(ErrorCode.Unauthorized, "access_denied");
  if (session.user.impersonatedBy) throw new ErrorWithCode(ErrorCode.Forbidden, "access_denied");
  return session.user.id;
}

export function limitMcpTraffic(key: string, limit = 300, windowMs = 60000) {
  const current = traffic.get(key);
  if (!current || current.reset <= Date.now()) {
    traffic.set(key, { count: 1, reset: Date.now() + windowMs }, { ttl: windowMs });
    return;
  }
  if (current.count >= limit)
    throw new ErrorWithCode(ErrorCode.BadRequest, "temporarily_unavailable", { httpStatus: 429 });
  current.count++;
}

export async function mcpResponse(work: () => Promise<unknown>, status = 200) {
  try {
    return Response.json(await work(), { status, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json({ error: "invalid_request" }, { status: 400, headers: PRIVATE_HEADERS });
    const known = error instanceof ErrorWithCode && safeErrors.has(error.message);
    const code = known
      ? error.data?.httpStatus === 429
        ? 429
        : error.code === ErrorCode.Unauthorized
          ? 401
          : error.code === ErrorCode.Forbidden
            ? 403
            : 400
      : 500;
    return Response.json(
      { error: known ? error.message : "server_error" },
      { status: code, headers: PRIVATE_HEADERS }
    );
  }
}
