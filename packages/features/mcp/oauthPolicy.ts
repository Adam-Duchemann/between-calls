import { z } from "zod";

export const MCP_SCOPES = ["cal:read", "cal:propose"] as const;
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const secureUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback.has(url.hostname)))
    );
  }, "HTTPS is required except for loopback URLs; credentials and fragments are forbidden.");
const clientId = z.string().min(1).max(200);
const scopes = z
  .string()
  .max(200)
  .default("cal:read")
  .transform((value) => Array.from(new Set(value.trim().split(/\s+/))).sort())
  .refine(
    (values) => values.length > 0 && values.every((scope) => MCP_SCOPES.some((known) => known === scope)),
    "invalid_scope"
  )
  .transform((values) => values.join(" "));

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(secureUrl).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).default(["code"]),
});

export const authorizationSchema = z.object({
  client_id: clientId,
  response_type: z.literal("code"),
  redirect_uri: secureUrl,
  resource: secureUrl,
  scope: scopes,
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2048).optional(),
});
export type AuthorizationRequest = z.infer<typeof authorizationSchema>;

export const tokenRequestSchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    client_id: clientId,
    resource: secureUrl,
    code: z.string().min(1).max(200),
    redirect_uri: secureUrl,
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    client_id: clientId,
    resource: secureUrl,
    refresh_token: z.string().min(1).max(2048),
  }),
]);

export function resourceUrl(baseUrl: string): string {
  const url = new URL(secureUrl.parse(baseUrl));
  if (url.pathname !== "/" || url.search)
    throw new Error("MCP requires a canonical origin without a path or query.");
  return `${url.origin}/api/mcp`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}
