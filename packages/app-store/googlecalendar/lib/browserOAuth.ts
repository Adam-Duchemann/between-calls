import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import process from "node:process";
import { WEBAPP_URL_FOR_OAUTH } from "@calcom/lib/constants";
import { HttpError } from "@calcom/lib/http-error";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

const ttlSeconds = 15 * 60;
const randomValue = /^[A-Za-z0-9_-]{43}$/;
const optionsSchema = z.object({
  returnTo: z.string().url().max(1536).optional(),
  onErrorReturnTo: z.string().url().max(1536).optional(),
  fromApp: z.boolean().optional(),
  installGoogleVideo: z.boolean().optional(),
});
const stateSchema = z.object({
  nonce: z.string().regex(randomValue),
  expiresAt: z.number().int(),
  options: optionsSchema,
});

function cookieName(): string {
  return WEBAPP_URL_FOR_OAUTH.startsWith("https:") ? "__Host-cal-google-oauth" : "cal-google-oauth";
}

function sign(req: NextApiRequest, browser: string, purpose: "state" | "pkce", value: string): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  const userId = req.session?.user?.id;
  if (!secret || !userId) {
    throw new HttpError({ statusCode: 401, message: "Google authorization requires a signed-in session" });
  }
  return createHmac("sha256", secret)
    .update(JSON.stringify(["cal-google-oauth", purpose, userId, browser, value]))
    .digest();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function startBrowserOAuth(req: NextApiRequest, res: NextApiResponse) {
  const raw = req.query.state;
  if (raw !== undefined && (typeof raw !== "string" || raw.length > 4096)) {
    throw new HttpError({ statusCode: 400, message: "Invalid Google authorization options" });
  }
  const options = optionsSchema.safeParse(raw === undefined ? {} : parseJson(raw));
  if (!options.success) {
    throw new HttpError({ statusCode: 400, message: "Invalid Google authorization options" });
  }

  const name = cookieName();
  const current = req.cookies[name];
  const browser = current && randomValue.test(current) ? current : randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const encoded = Buffer.from(
    JSON.stringify({ nonce, expiresAt: Date.now() + ttlSeconds * 1000, options: options.data })
  ).toString("base64url");
  const state = encoded + "." + sign(req, browser, "state", encoded).toString("base64url");
  const verifier = sign(req, browser, "pkce", nonce).toString("base64url");

  // Lax allows Google's top-level callback while keeping the binding unavailable to JavaScript.
  const secure = name.startsWith("__Host-") ? "; Secure" : "";
  const cookie = `${name}=${browser}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Lax${secure}`;
  const existing = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [
    ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
    cookie,
  ]);
  res.setHeader("Cache-Control", "no-store");
  return { state, codeChallenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function finishBrowserOAuth(req: NextApiRequest) {
  const { state } = req.query;
  const browser = req.cookies[cookieName()];
  if (typeof state !== "string" || state.length > 6144 || !browser || !randomValue.test(browser)) {
    return null;
  }
  const parts = state.split(".");
  const [encoded, signature] = parts;
  if (parts.length !== 2 || !encoded || !signature || !randomValue.test(signature)) return null;
  if (!timingSafeEqual(sign(req, browser, "state", encoded), Buffer.from(signature, "base64url"))) {
    return null;
  }

  const payload = stateSchema.safeParse(parseJson(Buffer.from(encoded, "base64url").toString("utf8")));
  if (!payload.success || Date.now() >= payload.data.expiresAt) return null;
  return {
    state: payload.data.options,
    codeVerifier: sign(req, browser, "pkce", payload.data.nonce).toString("base64url"),
  };
}
