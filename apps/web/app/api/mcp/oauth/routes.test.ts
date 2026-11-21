// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as consentPost } from "../consent/route";
import { authorizationMetadata, protectedResourceMetadata } from "../metadata";
import { POST } from "./[operation]/route";

const mocks = vi.hoisted(() => ({
  register: vi.fn().mockResolvedValue({ client_id: "registered" }),
  exchange: vi.fn().mockResolvedValue({ access_token: "test-token" }),
  revokeToken: vi.fn(),
  approve: vi.fn().mockResolvedValue("https://client.test/callback?code=test"),
  decline: vi.fn(),
  cookieUser: vi.fn().mockResolvedValue(1),
}));
vi.mock("app/api/mcp/_shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_shared")>()),
  mcpConfig: () => ({ origin: "https://cal.test", resource: "https://cal.test/api/mcp", allowedOrigins: [] }),
  mcpServices: () => ({
    origin: "https://cal.test",
    allowedOrigins: [],
    consent: { register: mocks.register, approve: mocks.approve, decline: mocks.decline },
    tokens: { exchange: mocks.exchange, revokeToken: mocks.revokeToken },
  }),
  cookieUser: mocks.cookieUser,
}));
const req = (body: object, headers: Record<string, string> = {}) =>
  new Request("https://cal.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const ctx = (operation: string) => ({ params: Promise.resolve({ operation }) });
beforeEach(() => vi.clearAllMocks());

describe("MCP OAuth routes", () => {
  it("registers public clients and serves token exchanges without browser cookies", async () => {
    const registration = await POST(req({ client_name: "Assistant" }), ctx("register"));
    expect(registration.status).toBe(201);
    expect(await registration.json()).toEqual({ client_id: "registered" });
    const token = await POST(req({ grant_type: "authorization_code" }), ctx("token"));
    expect(token.status).toBe(200);
    expect(token.headers.get("cache-control")).toContain("no-store");
    expect(mocks.cookieUser).not.toHaveBeenCalled();
  });

  it("rejects untrusted origins and malformed revocation bodies before invoking services", async () => {
    expect((await POST(req({}, { origin: "https://attacker.test" }), ctx("token"))).status).toBe(403);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect((await POST(req({ token: "token" }), ctx("revoke"))).status).toBe(400);
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it("requires same-origin browser confirmation and never trusts a supplied account ID", async () => {
    const body = { decision: "approve", review: { confirmation: "test" } };
    expect(
      (await consentPost(req(body, { origin: "https://cal.test", authorization: "Bearer test" }))).status
    ).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect((await consentPost(req({ ...body, userId: 2 }, { origin: "https://cal.test" }))).status).toBe(400);
    const approved = await consentPost(req(body, { origin: "https://cal.test" }));
    expect(approved.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(1, body.review);
  });

  it("publishes discovery metadata for the exact protected endpoint and public PKCE clients", () => {
    expect(protectedResourceMetadata()).toMatchObject({
      resource: "https://cal.test/api/mcp",
      authorization_servers: ["https://cal.test"],
    });
    expect(authorizationMetadata()).toMatchObject({
      issuer: "https://cal.test",
      authorization_endpoint: "https://cal.test/auth/mcp/authorize",
      token_endpoint: "https://cal.test/api/mcp/oauth/token",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(JSON.stringify(authorizationMetadata())).not.toContain("secret");
  });
});
