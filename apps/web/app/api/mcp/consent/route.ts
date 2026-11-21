import { assertBrowserMutation, readMcpBody } from "@calcom/features/mcp/http";
import { cookieUser, limitMcpTraffic, mcpResponse, mcpServices } from "app/api/mcp/_shared";
import { z } from "zod";

export const runtime = "nodejs";
const inputSchema = z.object({ decision: z.enum(["approve", "decline"]), review: z.unknown() }).strict();

export async function POST(request: Request) {
  return mcpResponse(async () => {
    const services = mcpServices();
    assertBrowserMutation(request, services.origin);
    const userId = await cookieUser();
    limitMcpTraffic(`consent:${userId}`, 20);
    const input = inputSchema.parse(await readMcpBody(request));
    const redirect =
      input.decision === "approve"
        ? await services.consent.approve(userId, input.review)
        : await services.consent.decline(userId, input.review);
    return { redirect };
  });
}
