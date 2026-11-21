import { ConsentView } from "@calcom/features/mcp/ConsentView";
import { authorizationSchema } from "@calcom/features/mcp/oauthPolicy";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import prisma from "@calcom/prisma";
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { cookieUser, mcpServices } from "app/api/mcp/_shared";
import { redirect } from "next/navigation";

export const generateMetadata = () =>
  _generateMetadata(
    (t) => t("mcp_connect_title"),
    (t) => t("mcp_connect_description")
  );

export default async function Page({ searchParams }: PageProps) {
  const parsed = authorizationSchema.safeParse(await searchParams);
  if (!parsed.success) return <ConsentView />;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) if (value !== undefined) query.set(key, value);
  let userId: number;
  try {
    userId = await cookieUser();
  } catch (error) {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.Unauthorized) {
      redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/auth/mcp/authorize?${query.toString()}`)}`);
    }
    return <ConsentView />;
  }
  try {
    const review = await mcpServices().consent.preview(userId, parsed.data);
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return account ? <ConsentView review={review} accountEmail={account.email} /> : <ConsentView />;
  } catch {
    return <ConsentView />;
  }
}
