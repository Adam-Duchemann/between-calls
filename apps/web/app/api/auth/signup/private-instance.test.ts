// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const signup = vi.hoisted(() => vi.fn());
vi.mock("./handlers/selfHostedHandler", () => ({ default: signup }));
vi.mock("./handlers/calcomSignupHandler", () => ({ default: signup }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
vi.mock("@calcom/lib/server/checkCfTurnstileToken", () => ({ checkCfTurnstileToken: vi.fn() }));
vi.mock("@calcom/features/flags/features.repository", () => ({
  FeaturesRepository: class { async checkIfFeatureIsEnabledGlobally() { return false; } },
}));
afterEach(() => vi.unstubAllEnvs());
describe("private instance signup", () => {
  it.each([undefined, "untrusted-invitation-token"])("rejects public signup with token %s", async (token) => {
    vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
    const result = await POST(new NextRequest("https://cal.test/api/auth/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guest@example.test", token }),
    }), { params: Promise.resolve({}) });
    expect(result.status).toBe(403);
    expect(signup).not.toHaveBeenCalled();
  });
});
