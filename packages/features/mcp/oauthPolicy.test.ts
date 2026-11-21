import { describe, expect, it } from "vitest";
import { authorizationSchema, registrationSchema, resourceUrl, tokenRequestSchema } from "./oauthPolicy";

const request = {
  client_id: "client",
  response_type: "code",
  redirect_uri: "https://client.test/cb",
  resource: "https://cal.test/api/mcp",
  scope: "cal:read cal:propose",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
};

describe("MCP OAuth policy", () => {
  it("requires resource binding, S256 PKCE and known scopes", () => {
    expect(authorizationSchema.safeParse(request).success).toBe(true);
    for (const changes of [
      { resource: undefined },
      { code_challenge_method: "plain" },
      { scope: "admin" },
      { code_challenge: "short" },
    ]) {
      expect(authorizationSchema.safeParse({ ...request, ...changes }).success).toBe(false);
    }
    expect(authorizationSchema.parse({ ...request, scope: "cal:read cal:read" }).scope).toBe("cal:read");
  });

  it("accepts HTTPS and loopback redirects but rejects fragments, credentials and insecure remote URLs", () => {
    for (const uri of ["https://client.test/cb", "http://127.0.0.1:5555/cb", "http://[::1]:5555/cb"]) {
      expect(registrationSchema.safeParse({ client_name: "Test", redirect_uris: [uri] }).success).toBe(true);
    }
    for (const uri of [
      "https://client.test/cb#fragment",
      "http://client.test/cb",
      "https://user:pass@client.test/cb",
      "javascript:alert(1)",
    ]) {
      expect(registrationSchema.safeParse({ client_name: "Test", redirect_uris: [uri] }).success).toBe(false);
    }
    expect(
      registrationSchema.safeParse({
        client_name: "Test",
        redirect_uris: ["https://client.test/cb"],
        token_endpoint_auth_method: "client_secret_post",
      }).success
    ).toBe(false);
  });

  it("does not allow a client to exchange a code without its redirect and verifier", () => {
    const token = {
      grant_type: "authorization_code",
      client_id: "client",
      resource: request.resource,
      code: "code",
      redirect_uri: request.redirect_uri,
      code_verifier: "v".repeat(43),
    };
    expect(tokenRequestSchema.safeParse(token).success).toBe(true);
    expect(tokenRequestSchema.safeParse({ ...token, redirect_uri: undefined }).success).toBe(false);
    expect(tokenRequestSchema.safeParse({ ...token, code_verifier: undefined }).success).toBe(false);
    expect(
      tokenRequestSchema.safeParse({
        grant_type: "refresh_token",
        client_id: "client",
        resource: request.resource,
        refresh_token: "refresh",
      }).success
    ).toBe(true);
  });

  it("uses a configured canonical origin and permits HTTP only on loopback", () => {
    expect(resourceUrl("https://cal.test/")).toBe("https://cal.test/api/mcp");
    expect(resourceUrl("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100/api/mcp");
    expect(() => resourceUrl("http://cal.test")).toThrow();
    expect(() => resourceUrl("https://cal.test/extra-path")).toThrow();
  });
});
