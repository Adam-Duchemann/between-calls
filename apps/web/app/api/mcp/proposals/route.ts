import { assertBrowserMutation, readMcpBody } from "@calcom/features/mcp/http";
import { cookieUser, limitMcpTraffic, mcpConfig, mcpResponse } from "app/api/mcp/_shared";
import { z } from "zod";
import { schedulingServices } from "../_scheduling";

export const runtime = "nodejs";
const inputSchema = z
  .object({
    proposalId: z.string().uuid(),
    confirmationToken: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approve", "decline"]),
  })
  .strict();

export async function POST(request: Request) {
  return mcpResponse(async () => {
    assertBrowserMutation(request, mcpConfig().origin);
    const userId = await cookieUser();
    limitMcpTraffic(`decision:${userId}`, 30);
    const input = inputSchema.parse(await readMcpBody(request));
    const { proposals } = schedulingServices();
    const result =
      input.decision === "approve"
        ? await proposals.confirm(userId, input.proposalId, input.confirmationToken)
        : await proposals.decline(userId, input.proposalId, input.confirmationToken);
    return { result };
  });
}
