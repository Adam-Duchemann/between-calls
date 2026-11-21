import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import type { Prisma } from "@calcom/prisma/client";
import { z } from "zod";
import { OAuth2UniversalSchema } from "../../_utils/oauth/universalSchema";

const format = "cal-aes-gcm-v1";
const algorithm = "aes-256-gcm";
const encoding = "base64url";
const encodedBytes = z.string().regex(/^[A-Za-z0-9_-]+$/);
const sealedSchema = z
  .object({
    calGoogleGrantEncryption: z.literal(format),
    calGoogleAccountId: z.string().min(1).optional(),
    calGoogleGrantVersion: z.string().min(1),
    nonce: encodedBytes.length(16),
    tag: encodedBytes.length(22),
    ciphertext: encodedBytes,
  })
  .strict();

function encryptionKey() {
  const secret = process.env.CALENDSO_ENCRYPTION_KEY ?? "";
  if (!/^[\x21-\x7e]{32}$/.test(secret)) {
    throw new Error("CALENDSO_ENCRYPTION_KEY must be configured to encrypt Google Calendar grants.");
  }
  return Buffer.from(hkdfSync("sha256", secret, "cal/google-oauth", "credential-encryption:v1", 32));
}

function grantContext(userId: number, accountId: string | undefined, version: string) {
  return Buffer.from(JSON.stringify([format, userId, accountId ?? null, version]));
}

export function isSealedPrivateGoogleGrant(key: Prisma.JsonValue): boolean {
  return !!key && typeof key === "object" && !Array.isArray(key) && "calGoogleGrantEncryption" in key;
}

export function readPrivateGoogleGrant(key: Prisma.JsonValue, userId: number): Prisma.JsonValue {
  if (!isSealedPrivateGoogleGrant(key)) return key;
  try {
    const sealed = sealedSchema.parse(key);
    const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(sealed.nonce, encoding), {
      authTagLength: 16,
    });
    decipher.setAAD(grantContext(userId, sealed.calGoogleAccountId, sealed.calGoogleGrantVersion));
    decipher.setAuthTag(Buffer.from(sealed.tag, encoding));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, encoding)),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new Error("Could not decrypt the stored Google Calendar grant.");
  }
}

export function sealPrivateGoogleGrant(tokens: Prisma.InputJsonObject, userId: number) {
  const verified = OAuth2UniversalSchema.safeParse(tokens);
  if (!verified.success) throw new Error("Cannot encrypt an invalid Google Calendar grant.");
  const calGoogleAccountId =
    typeof tokens.calGoogleAccountId === "string" && tokens.calGoogleAccountId
      ? tokens.calGoogleAccountId
      : undefined;
  const calGoogleGrantVersion =
    typeof tokens.calGoogleGrantVersion === "string" && tokens.calGoogleGrantVersion
      ? tokens.calGoogleGrantVersion
      : randomUUID();
  const nonce = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), nonce, { authTagLength: 16 });
  cipher.setAAD(grantContext(userId, calGoogleAccountId, calGoogleGrantVersion));
  const plaintext = JSON.stringify({ ...tokens, calGoogleAccountId, calGoogleGrantVersion });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    calGoogleGrantEncryption: format,
    ...(calGoogleAccountId && { calGoogleAccountId }),
    calGoogleGrantVersion,
    nonce: nonce.toString(encoding),
    tag: cipher.getAuthTag().toString(encoding),
    ciphertext: ciphertext.toString(encoding),
  };
}
