import { ReviewView } from "@calcom/features/mcp/ReviewView";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import prisma from "@calcom/prisma";
import type { PageProps } from "app/_types";
import { _generateMetadata } from "app/_utils";
import { schedulingServices } from "app/api/mcp/_scheduling";
import { cookieUser } from "app/api/mcp/_shared";
import { redirect } from "next/navigation";
import { z } from "zod";

export const generateMetadata = () =>
  _generateMetadata(
    (t) => t("mcp_review_title"),
    (t) => t("mcp_confirmation_required")
  );

export default async function Page({ params }: PageProps) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) return <ReviewView timeZone="UTC" />;
  let userId: number;
  try {
    userId = await cookieUser();
  } catch (error) {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.Unauthorized)
      redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/auth/mcp/review/${id.data}`)}`);
    return <ReviewView timeZone="UTC" />;
  }
  try {
    const review = await schedulingServices().proposals.review(userId, id.data);
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, timeZone: true },
    });
    return account ? (
      <ReviewView
        review={{ ...review, expiresAt: review.expiresAt.toISOString() }}
        accountEmail={account.email}
        timeZone={account.timeZone}
      />
    ) : (
      <ReviewView timeZone="UTC" />
    );
  } catch {
    return <ReviewView timeZone="UTC" />;
  }
}
