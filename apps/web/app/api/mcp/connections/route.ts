import { assertBrowserMutation, assertMcpOrigin, readMcpBody } from "@calcom/features/mcp/http";
import { cookieUser, limitMcpTraffic, mcpResponse, mcpServices } from "app/api/mcp/_shared";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return mcpResponse(async () => {
    const services = mcpServices();
    assertMcpOrigin(request, services.origin);
    const userId = await cookieUser();
    limitMcpTraffic(`connections:${userId}`, 60);
    return services.tokens.connections(userId, Object.fromEntries(new URL(request.url).searchParams));
  });
}

export async function POST(request: Request) {
  return mcpResponse(async () => {
    const services = mcpServices();
    assertBrowserMutation(request, services.origin);
    const userId = await cookieUser();
    limitMcpTraffic(`disconnect:${userId}`, 30);
    const input = z
      .object({ grantId: z.string().uuid() })
      .strict()
      .parse(await readMcpBody(request));
    await services.tokens.revokeForOwner(userId, input.grantId);
    return {};
  });
}
