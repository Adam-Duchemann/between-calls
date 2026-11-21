// @vitest-environment node
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookieUser, limitMcpTraffic, mcpResponse } from "./_shared";

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(headers).mockResolvedValue(new Headers());
});

describe("MCP trusted web boundary", () => {
  it("rejects bearer-authenticated callers before looking up a browser session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ authorization: "Bearer model-token" }));
    await expect(cookieUser()).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    expect(getServerSession).not.toHaveBeenCalled();
  });

  it("requires a real session and disallows impersonation for consent", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    await expect(cookieUser()).rejects.toMatchObject({ code: ErrorCode.Unauthorized });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 1, impersonatedBy: { id: 2 } } } as Awaited<
      ReturnType<typeof getServerSession>
    >);
    await expect(cookieUser()).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 1 } } as Awaited<
      ReturnType<typeof getServerSession>
    >);
    await expect(cookieUser()).resolves.toBe(1);
  });

  it("redacts unexpected errors and prevents caching of tokens and proofs", async () => {
    const success = await mcpResponse(async () => ({ access_token: "ephemeral-test-token" }));
    expect(success.headers.get("cache-control")).toContain("no-store");
    const failure = await mcpResponse(async () => {
      throw new Error("private-provider-key");
    });
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: "server_error" });
    const denied = await mcpResponse(async () => {
      throw new ErrorWithCode(ErrorCode.Forbidden, "access_denied");
    });
    expect(denied.status).toBe(403);
  });

  it("bounds local registration bursts without requiring an external rate-limit service", () => {
    const key = `registration-test-${Date.now()}`;
    limitMcpTraffic(key, 1, 60000);
    expect(() => limitMcpTraffic(key, 1, 60000)).toThrow();
  });
});
