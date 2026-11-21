// @vitest-environment node
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "./route";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), handle: vi.fn() }));
vi.mock("./_scheduling", () => ({ schedulingServices: () => ({}) }));
vi.mock("@calcom/features/mcp/server", () => ({ handleMcpRequest: mocks.handle }));
vi.mock("app/api/mcp/_shared", async (original) => ({
  ...(await original<typeof import("./_shared")>()),
  mcpConfig: () => ({ origin: "https://cal.test", allowedOrigins: ["https://assistant.test"] }),
  mcpServices: () => ({
    origin: "https://cal.test",
    allowedOrigins: ["https://assistant.test"],
    tokens: { authenticate: mocks.authenticate },
  }),
}));
beforeEach(() => {
  mocks.authenticate.mockReset().mockResolvedValue({ userId: 1, grantId: "grant", scopes: ["cal:read"] });
  mocks.handle.mockReset().mockResolvedValue(Response.json({ jsonrpc: "2.0", id: 1, result: {} }));
});
function request(headers = {}, body = "{}") {
  return new Request("https://cal.test/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}
describe("MCP HTTP access", () => {
  it("requires bearer auth even when a browser cookie exists and advertises discovery", async () => {
    const response = await POST(request({ Cookie: "next-auth.session-token=browser-session" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "https://cal.test/.well-known/oauth-protected-resource/api/mcp"
    );
    expect(mocks.handle).not.toHaveBeenCalled();
  });
  it("rejects an untrusted origin before token lookup", async () => {
    const response = await POST(request({ Origin: "https://evil.test", Authorization: "Bearer token" }));
    expect(response.status).toBe(403);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it("returns a challenge for expired or revoked bearer tokens", async () => {
    mocks.authenticate.mockRejectedValue(new ErrorWithCode(ErrorCode.Unauthorized, "invalid_token"));
    const response = await POST(request({ Authorization: "Bearer token" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("invalid_token");
  });
  it("bounds the body and marks successful results private", async () => {
    const response = await POST(request({ Authorization: "Bearer token", Origin: "https://assistant.test" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://assistant.test");
    mocks.handle.mockClear();
    expect(
      (await POST(request({ Authorization: "Bearer token" }, JSON.stringify({ text: "x".repeat(33000) }))))
        .status
    ).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
  });
  it("does not open an unbounded GET stream and supports allowed preflight requests", async () => {
    expect(
      (await GET(new Request("https://cal.test/api/mcp", { headers: { Authorization: "Bearer token" } })))
        .status
    ).toBe(405);
    const response = await OPTIONS(
      new Request("https://cal.test/api/mcp", {
        method: "OPTIONS",
        headers: { Origin: "https://assistant.test" },
      })
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("MCP-Protocol-Version");
  });
});
