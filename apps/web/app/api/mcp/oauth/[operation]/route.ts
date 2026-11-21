import { assertMcpOrigin, readMcpBody } from "@calcom/features/mcp/http";
import { limitMcpTraffic, mcpConfig, mcpResponse, mcpServices } from "app/api/mcp/_shared";
import { z } from "zod";

export const runtime = "nodejs";
const operationSchema = z.enum(["register", "token", "revoke"]);
const revokeSchema = z
  .object({
    client_id: z.string().min(1).max(200),
    token: z.string().min(1).max(2048),
    token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation: requested } = await context.params;
  let corsOrigin: string | null = null;
  const response = await mcpResponse(
    async () => {
      const operation = operationSchema.parse(requested);
      const services = mcpServices();
      assertMcpOrigin(request, services.origin, services.allowedOrigins);
      corsOrigin = request.headers.get("origin");
      limitMcpTraffic(
        `oauth:${operation}`,
        operation === "register" ? 20 : 300,
        operation === "register" ? 3600000 : 60000
      );
      const body = await readMcpBody(request);
      if (operation === "register") return services.consent.register(body);
      if (operation === "token") return services.tokens.exchange(body);
      const revoke = revokeSchema.parse(body);
      await services.tokens.revokeToken(revoke.client_id, revoke.token);
      return {};
    },
    requested === "register" ? 201 : 200
  );
  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export async function OPTIONS(request: Request) {
  let corsOrigin: string | null = null;
  const response = await mcpResponse(async () => {
    const config = mcpConfig();
    assertMcpOrigin(request, config.origin, config.allowedOrigins);
    corsOrigin = request.headers.get("origin");
    return {};
  });
  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Vary", "Origin");
  }
  return response;
}
