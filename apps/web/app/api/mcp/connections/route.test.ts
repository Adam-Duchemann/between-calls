// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ cookieUser: vi.fn(), connections: vi.fn(), revokeForOwner: vi.fn() }));
vi.mock("app/api/mcp/_shared", async (original) => ({
  ...(await original<typeof import("../_shared")>()),
  cookieUser: mocks.cookieUser,
  mcpServices: () => ({ origin: "https://cal.test", tokens: mocks }),
}));
const id = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
beforeEach(() => {
  mocks.cookieUser.mockReset().mockResolvedValue(7);
  mocks.connections.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  mocks.revokeForOwner.mockReset().mockResolvedValue(undefined);
});
const request = (body: unknown, headers = {}) =>
  new Request("https://cal.test/api/mcp/connections", {
    method: "POST",
    headers: { Origin: "https://cal.test", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
describe("connection management", () => {
  it("reads only the signed-in owner's connections with private caching", async () => {
    const response = await GET(new Request("https://cal.test/api/mcp/connections"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.connections).toHaveBeenCalledWith(7, {});
  });
  it("rejects model tokens, cross-site mutations and caller-supplied owners", async () => {
    expect((await POST(request({ grantId: id }, { Authorization: "Bearer assistant" }))).status).toBe(403);
    expect((await POST(request({ grantId: id }, { Origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request({ grantId: id, userId: 99 }))).status).toBe(400);
    expect(mocks.revokeForOwner).not.toHaveBeenCalled();
  });
  it("revokes a connection only for the cookie owner", async () => {
    expect((await POST(request({ grantId: id }))).status).toBe(200);
    expect(mocks.revokeForOwner).toHaveBeenCalledWith(7, id);
  });
});
