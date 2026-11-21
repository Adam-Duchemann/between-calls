import { EventEmitter } from "node:events";
import type { IncomingMessage, RequestOptions } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPublicWebsite } from "./readPublicWebsite";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup, default: { lookup: mocks.lookup } }));
vi.mock("node:https", () => ({ request: mocks.request, default: { request: mocks.request } }));
function reply(status: number, headers: Record<string, string>, body = "<style>body{color:#123456}</style>") {
  return (_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = Object.assign(new EventEmitter(), { statusCode: status, headers, destroy: vi.fn() });
    const req = Object.assign(new EventEmitter(), {
      end: () =>
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          response.emit("data", Buffer.from(body));
          response.emit("end");
          req.emit("close");
        }),
      destroy: (error: Error) => {
        queueMicrotask(() => {
          req.emit("error", error);
          req.emit("close");
        });
        return req;
      },
    });
    return req;
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.request.mockImplementation(reply(200, { "content-type": "text/html" }));
});
describe("bounded public website reader", () => {
  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://169.254.169.254",
    "https://224.0.0.1",
    "https://example.com:8443",
  ])("rejects unsafe target %s before connecting", async (url) => {
    await expect(readPublicWebsite(url, "html")).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("blocks a public hostname when any DNS answer points to an internal network", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(readPublicWebsite("https://example.com", "html")).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("pins the validated address and does not send credentials or reuse connections", async () => {
    await expect(readPublicWebsite("https://example.com/page", "html")).resolves.toMatchObject({
      url: "https://example.com/page",
    });
    const options = mocks.request.mock.calls[0][1];
    expect(options).toMatchObject({ agent: false, autoSelectFamily: false });
    const callback = vi.fn();
    options.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(options.headers).not.toHaveProperty("Cookie");
    expect(options.headers).not.toHaveProperty("Authorization");
  });
  it("validates redirect targets before another request", async () => {
    mocks.request.mockImplementationOnce(reply(302, { location: "https://127.0.0.1/admin" }));
    await expect(readPublicWebsite("https://example.com", "html")).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("bounds redirects", async () => {
    mocks.request.mockImplementation(reply(302, { location: "/again" }));
    await expect(readPublicWebsite("https://example.com", "html")).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(4);
  });
  it("rejects oversized bodies and unexpected content types", async () => {
    mocks.request.mockImplementationOnce(
      reply(200, { "content-type": "text/html" }, "x".repeat(1024 * 1024 + 1))
    );
    await expect(readPublicWebsite("https://example.com", "html")).rejects.toThrow();
    mocks.request.mockImplementationOnce(reply(200, { "content-type": "application/javascript" }));
    await expect(readPublicWebsite("https://example.com", "css")).rejects.toThrow();
  });
});
