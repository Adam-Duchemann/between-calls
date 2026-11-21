import { assertMcpOrigin, readMcpBody } from "@calcom/features/mcp/http";
import { resourceMetadataUrl } from "@calcom/features/mcp/oauthPolicy";
import { handleMcpRequest } from "@calcom/features/mcp/server";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { limitMcpTraffic, mcpConfig, mcpResponse, mcpServices, PRIVATE_HEADERS } from "app/api/mcp/_shared";
import { schedulingServices } from "./_scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cors(response: Response, origin: string | null) {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

async function handle(request: Request) {
  let corsOrigin: string | null = null;
  let origin = "";
  try {
    const services = mcpServices();
    origin = services.origin;
    assertMcpOrigin(request, origin, services.allowedOrigins);
    corsOrigin = request.headers.get("origin");
    const token = /^Bearer ([A-Za-z0-9_-]{1,200})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!token) throw new ErrorWithCode(ErrorCode.Unauthorized, "invalid_token");
    const principal = await services.tokens.authenticate(token);
    limitMcpTraffic(`rpc:${principal.grantId}`, 120);
    if (request.method !== "POST")
      return cors(new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } }), corsOrigin);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
      throw new ErrorWithCode(ErrorCode.BadRequest, "invalid_request");
    const parsedBody = await readMcpBody(request);
    return cors(
      await handleMcpRequest(request, parsedBody, principal, origin, schedulingServices()),
      corsOrigin
    );
  } catch (error) {
    const response = await mcpResponse(async () => {
      throw error;
    });
    if (response.status === 401 && origin)
      response.headers.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(origin)}", scope="cal:read cal:propose"`
      );
    return cors(response, corsOrigin);
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export async function OPTIONS(request: Request) {
  let corsOrigin: string | null = null;
  const response = await mcpResponse(async () => {
    const config = mcpConfig();
    assertMcpOrigin(request, config.origin, config.allowedOrigins);
    corsOrigin = request.headers.get("origin");
    return {};
  });
  if (response.ok) {
    response.headers.set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, MCP-Protocol-Version"
    );
  }
  return cors(response, corsOrigin);
}
