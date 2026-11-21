// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ cookieUser: vi.fn(), confirm: vi.fn(), decline: vi.fn() }));
vi.mock("../_scheduling", () => ({ schedulingServices: () => ({ proposals: mocks }) }));
vi.mock("app/api/mcp/_shared", async (original) => ({
  ...(await original<typeof import("../_shared")>()),
  mcpConfig: () => ({ origin: "https://cal.test" }),
  cookieUser: mocks.cookieUser,
}));
const input = {
  proposalId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  confirmationToken: "a".repeat(64),
  decision: "approve",
};
beforeEach(() => {
  mocks.cookieUser.mockReset().mockResolvedValue(7);
  mocks.confirm.mockReset().mockResolvedValue({ id: 1 });
  mocks.decline.mockReset().mockResolvedValue({ status: "DECLINED" });
});
const request = (body: unknown, headers = {}) =>
  new Request("https://cal.test/api/mcp/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://cal.test", ...headers },
    body: JSON.stringify(body),
  });
describe("browser-only proposal decisions", () => {
  it("uses only the cookie owner, proposal ID and signed proof", async () => {
    expect((await POST(request(input))).status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith(7, input.proposalId, input.confirmationToken);
  });
  it("rejects bearer credentials even with a browser session", async () => {
    expect((await POST(request(input, { Authorization: "Bearer assistant-token" }))).status).toBe(403);
    expect(mocks.cookieUser).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests and injected action payloads", async () => {
    expect((await POST(request(input, { Origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request({ ...input, action: { kind: "booking_cancel" }, userId: 99 }))).status).toBe(
      400
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("declines without running a confirmation", async () => {
    expect((await POST(request({ ...input, decision: "decline" }))).status).toBe(200);
    expect(mocks.decline).toHaveBeenCalledWith(7, input.proposalId, input.confirmationToken);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
