// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertBrowserMutation, assertMcpOrigin, readMcpBody } from "./http";

const origin = "https://cal.example.test";
const request = (headers: Record<string, string> = {}, body = "{}") =>
  new Request(`${origin}/api/mcp/confirm`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body,
  });

describe("MCP HTTP boundaries", () => {
  it("requires same-origin browser JSON and rejects bearer tokens for trusted changes", () => {
    expect(() => assertBrowserMutation(request(), origin)).not.toThrow();
    const rejectedHeaders: Record<string, string>[] = [
      { origin: "https://attacker.test" },
      { origin: "null" },
      { origin: "" },
      { "content-type": "text/plain" },
      { authorization: "Bearer model-access-token" },
    ];
    for (const headers of rejectedHeaders) {
      expect(() => assertBrowserMutation(request(headers), origin)).toThrow();
    }
    expect(() => assertBrowserMutation(new Request(`${origin}/api/mcp/confirm`), origin)).toThrow();
  });

  it("allows non-browser MCP clients but refuses untrusted browser origins", () => {
    expect(() => assertMcpOrigin(new Request(`${origin}/api/mcp`), origin)).not.toThrow();
    expect(() => assertMcpOrigin(request(), origin)).not.toThrow();
    expect(() => assertMcpOrigin(request({ origin: "https://attacker.test" }), origin)).toThrow();
    expect(() =>
      assertMcpOrigin(request({ origin: "https://allowed.test" }), origin, ["https://allowed.test"])
    ).not.toThrow();
  });

  it("bounds actual request bytes even when content-length is absent or dishonest", async () => {
    await expect(readMcpBody(request({}, '{"value":1}'))).resolves.toEqual({ value: 1 });
    await expect(readMcpBody(request({}, "x".repeat(33000)))).rejects.toThrow();
    await expect(readMcpBody(request({ "content-length": "1" }, "x".repeat(33000)))).rejects.toThrow();
    await expect(readMcpBody(request({ "content-length": "9999999" }))).rejects.toThrow();
  });

  it("accepts OAuth form bodies but rejects ambiguous duplicate parameters", async () => {
    await expect(
      readMcpBody(
        request({ "content-type": "application/x-www-form-urlencoded" }, "client_id=client&scope=cal%3Aread")
      )
    ).resolves.toEqual({ client_id: "client", scope: "cal:read" });
    await expect(
      readMcpBody(request({ "content-type": "application/x-www-form-urlencoded" }, "resource=a&resource=b"))
    ).rejects.toThrow();
    await expect(readMcpBody(request({ "content-type": "text/plain" }, "{}"))).rejects.toThrow();
  });
});
