// @vitest-environment node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { ProposalService } from "./ProposalService";
import type { ReadService } from "./ReadService";
import { handleMcpRequest } from "./server";

function setup(scopes = ["cal:read", "cal:propose"]) {
  const reads = mockDeep<ReadService>();
  const proposals = mockDeep<ProposalService>();
  const principal = { userId: 7, grantId: "grant", scopes };
  const send = async (method: string, params?: unknown) => {
    const body = { jsonrpc: "2.0", id: 1, method, params };
    const response = await handleMcpRequest(
      new Request("https://cal.example.test/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
        },
        body: JSON.stringify(body),
      }),
      body,
      principal,
      "https://cal.example.test",
      { reads, proposals }
    );
    return { response, body: await response.json() };
  };
  return { reads, proposals, send };
}

describe("CAL MCP transport", () => {
  it("supports the SDK client's initialize, list and call lifecycle", async () => {
    const reads = mockDeep<ReadService>();
    reads.eventTypes.mockResolvedValue({ items: [], nextCursor: null });
    const client = new Client({ name: "CAL acceptance", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("https://cal.example.test/api/mcp"), {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method !== "POST") return new Response(null, { status: 405 });
        return handleMcpRequest(
          request,
          await request.clone().json(),
          { userId: 7, grantId: "grant", scopes: ["cal:read"] },
          "https://cal.example.test",
          { reads, proposals: mockDeep<ProposalService>() }
        );
      },
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(5);
      expect((await client.callTool({ name: "cal_event_types", arguments: {} })).isError).not.toBe(true);
      expect(reads.eventTypes).toHaveBeenCalledWith(7, {});
    } finally {
      await client.close();
    }
  });
  it("negotiates a stateless JSON connection", async () => {
    const { send } = setup();
    const { response, body } = await send("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "Test", version: "1" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(body.result.serverInfo.name).toBe("CAL");
    expect(body.result.capabilities.tools).toBeTruthy();
  });
  it("lists only granted tools and never offers an approval tool", async () => {
    const { send } = setup(["cal:read"]);
    const { body } = await send("tools/list");
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "cal_profile",
      "cal_event_types",
      "cal_bookings",
      "cal_schedules",
      "cal_availability",
    ]);
    const all = await setup().send("tools/list");
    expect(JSON.stringify(all.body.result.tools.map((tool: { name: string }) => tool.name))).not.toMatch(
      /approve|confirm/
    );
  });
  it("announces only the OAuth scope each listed tool requires", async () => {
    const read = { type: "oauth2", scopes: ["cal:read"] };
    const propose = { type: "oauth2", scopes: ["cal:propose"] };
    const { body } = await setup().send("tools/list");
    expect(body.result.tools).toMatchObject([
      { name: "cal_profile", _meta: { securitySchemes: [read] } },
      { name: "cal_event_types", _meta: { securitySchemes: [read] } },
      { name: "cal_bookings", _meta: { securitySchemes: [read] } },
      { name: "cal_schedules", _meta: { securitySchemes: [read] } },
      { name: "cal_availability", _meta: { securitySchemes: [read] } },
      { name: "cal_propose_change", _meta: { securitySchemes: [propose] } },
      { name: "cal_change_status", _meta: { securitySchemes: [propose] } },
    ]);
  });
  it("challenges a missing tool scope without running the action or finding hidden tools", async () => {
    const { send, proposals } = setup(["cal:read"]);
    const denied = await send("tools/call", {
      name: "cal_propose_change",
      arguments: { action: { kind: "booking_cancel", bookingUid: "booking" } },
    });
    expect(denied.body.result).toMatchObject({
      isError: true,
      _meta: {
        "mcp/www_authenticate": [
          'Bearer resource_metadata="https://cal.example.test/.well-known/oauth-protected-resource/api/mcp", error="insufficient_scope", error_description="This tool requires additional CAL permissions.", scope="cal:propose"',
        ],
      },
    });
    expect(proposals.propose).not.toHaveBeenCalled();
    const unknown = await send("tools/call", { name: "cal_approve_change" });
    expect(unknown.body.result.isError).toBe(true);
    expect(unknown.body.result._meta).toBeUndefined();
  });
  it("binds reads to the authenticated account and rejects injected owners", async () => {
    const { send, reads } = setup();
    reads.eventTypes.mockResolvedValue({ items: [], nextCursor: null });
    const result = await send("tools/call", { name: "cal_event_types", arguments: {} });
    expect(result.body.result.isError).not.toBe(true);
    expect(reads.eventTypes).toHaveBeenCalledWith(7, {});
    reads.eventTypes.mockClear();
    const denied = await send("tools/call", { name: "cal_event_types", arguments: { userId: 99 } });
    expect(denied.body.result.isError).toBe(true);
    expect(reads.eventTypes).not.toHaveBeenCalled();
  });
  it("returns a review URL without a confirmation secret or an executed change", async () => {
    const { send, proposals } = setup();
    proposals.propose.mockResolvedValue({
      id: "8499cc1d-9962-42d3-944e-8047ea970e29",
      expiresAt: new Date("2026-11-18"),
    });
    const { body } = await send("tools/call", {
      name: "cal_propose_change",
      arguments: { action: { kind: "booking_cancel", bookingUid: "booking", reason: "Unavailable" } },
    });
    expect(body.result.content[0].text).toContain(
      "https://cal.example.test/auth/mcp/review/8499cc1d-9962-42d3-944e-8047ea970e29"
    );
    expect(body.result.content[0].text).not.toContain("confirmationToken");
    expect(proposals.confirm).not.toHaveBeenCalled();
  });
  it("redacts unexpected service errors", async () => {
    const { send, reads } = setup();
    reads.profile.mockRejectedValue(new Error("private database credentials"));
    const { body } = await send("tools/call", { name: "cal_profile", arguments: {} });
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain("credentials");
  });
});
