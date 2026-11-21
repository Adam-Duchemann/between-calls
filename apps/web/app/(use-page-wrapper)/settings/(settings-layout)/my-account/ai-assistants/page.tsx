import { ConnectionsView } from "@calcom/features/mcp/ConnectionsView";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { _generateMetadata } from "app/_utils";
import { cookieUser, mcpServices } from "app/api/mcp/_shared";
import { redirect } from "next/navigation";

export const generateMetadata = () =>
  _generateMetadata(
    (t) => t("mcp_connections_title"),
    (t) => t("mcp_connections_description")
  );
export default async function Page() {
  let userId: number;
  try {
    userId = await cookieUser();
  } catch (error) {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.Unauthorized)
      redirect("/auth/login?callbackUrl=/settings/my-account/ai-assistants");
    throw error;
  }
  const services = mcpServices();
  return (
    <ConnectionsView endpoint={services.resource} initial={await services.tokens.connections(userId, {})} />
  );
}
