"use client";

import { APP_NAME } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { useState } from "react";
import { ChangeDetails } from "./ChangeDetails";
import type { ProposalService } from "./ProposalService";

export type ReviewData = Omit<Awaited<ReturnType<ProposalService["review"]>>, "expiresAt"> & {
  expiresAt: string;
};
export function ReviewView({
  review,
  accountEmail,
  timeZone,
}: {
  review?: ReviewData;
  accountEmail?: string;
  timeZone: string;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<"SUCCEEDED" | "DECLINED" | null>(null);
  const [failed, setFailed] = useState(false);
  const status = decided ?? review?.status;
  const expired = !!review && Date.parse(review.expiresAt) <= Date.now();
  const canDecide = !!review?.confirmationToken && status === "PENDING" && !expired && !failed;
  async function decide(decision: "approve" | "decline") {
    if (!review || !canDecide || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/mcp/proposals", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: review.id,
          confirmationToken: review.confirmationToken,
          decision,
        }),
      });
      if (!response.ok) throw new Error("Change was not completed");
      setDecided(decision === "approve" ? "SUCCEEDED" : "DECLINED");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="text-default mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <p className="font-cal text-emphasis mb-8 text-2xl font-semibold">{APP_NAME}</p>
      <h1 className="text-emphasis text-2xl font-semibold tracking-tight">{t("mcp_review_title")}</h1>
      <p className="text-subtle mt-2 text-sm">{accountEmail}</p>
      {!review ? (
        <p role="alert" className="mt-6 text-sm">
          {t("mcp_request_failed")}
        </p>
      ) : (
        <>
          <section className="bg-default border-subtle mt-6 rounded-xl border p-5 sm:p-6">
            <p className="text-emphasis text-sm leading-relaxed">{review.payload.summary}</p>
            <div className="mt-3">
              <ChangeDetails action={review.payload.action} timeZone={timeZone} />
            </div>
          </section>
          <p className="text-subtle mt-4 text-xs">
            {t("mcp_review_expires", {
              time: new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone,
              }).format(new Date(review.expiresAt)),
              timeZone,
              interpolation: { escapeValue: false },
            })}
          </p>
          {failed || status === "FAILED" ? (
            <p role="alert" className="border-subtle mt-5 rounded-lg border p-4 text-sm">
              {t("mcp_review_failed")}
            </p>
          ) : null}
          {status === "SUCCEEDED" ||
          status === "DECLINED" ||
          status === "EXECUTING" ||
          (expired && status === "PENDING") ? (
            <p role="status" className="bg-muted mt-5 rounded-lg p-4 text-sm">
              {t(
                status === "SUCCEEDED"
                  ? "mcp_review_succeeded"
                  : status === "DECLINED"
                    ? "mcp_review_declined"
                    : status === "EXECUTING"
                      ? "mcp_review_executing"
                      : "mcp_review_expired"
              )}
            </p>
          ) : null}
          {canDecide ? (
            <>
              <p className="mt-5 text-sm">{t("mcp_review_commit_notice")}</p>
              <div className="mt-6 flex justify-end gap-3">
                <Button color="secondary" disabled={busy} onClick={() => decide("decline")}>
                  {t("mcp_decline_change")}
                </Button>
                <Button disabled={busy} onClick={() => decide("approve")}>
                  {t(busy ? "mcp_review_working" : "mcp_approve_change")}
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
      <div className="mt-8">
        <Button color="minimal" href="/bookings/upcoming">
          {t("mcp_open_bookings")}
        </Button>
      </div>
    </main>
  );
}
