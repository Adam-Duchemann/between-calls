import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), suggest: vi.fn() }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.session }));
vi.mock("@calcom/lib/server/websitePalette", () => ({ suggestWebsiteAppearance: mocks.suggest }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
const request = (body = { url: "https://example.com" }, headers = {}) =>
  new Request("https://booking.example.com/api/appearance/import", {
    method: "POST",
    headers: { Origin: "https://booking.example.com", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.suggest.mockResolvedValue({
    background: "#F6F3EC",
    surface: "#F6F3EC",
    text: "#292923",
    accent: "#176B68",
    headingFont: "serif",
    websiteUrl: "https://example.com/",
  });
});
describe("website palette endpoint", () => {
  it("requires an authenticated session", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and bearer requests before reading a website", async () => {
    expect((await POST(request(undefined, { Origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request(undefined, { Authorization: "Bearer not-a-session" }))).status).toBe(403);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it("returns suggestions without caching or changing settings", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toHaveProperty("appearance.accent", "#176B68");
    expect(mocks.suggest).toHaveBeenCalledWith("https://example.com");
  });
  it("returns a bounded error rather than upstream content", async () => {
    mocks.suggest.mockRejectedValue(new Error("private upstream diagnostic"));
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private upstream diagnostic");
  });
  it("limits repeated imports per account", async () => {
    mocks.session.mockResolvedValue({ user: { id: 99 } });
    for (let i = 0; i < 6; i++) expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(429);
    expect(mocks.suggest).toHaveBeenCalledTimes(6);
  });
});
