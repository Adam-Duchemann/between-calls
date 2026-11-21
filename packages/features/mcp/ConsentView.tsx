"use client";

import { APP_NAME } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { useState } from "react";
import type { ConsentReview } from "./ConsentService";

export function ConsentView({ review, accountEmail }: { review?: ConsentReview; accountEmail?: string }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function decide(decision: "approve" | "decline") {
    if (!review || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/mcp/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, review }),
      });
      if (!response.ok) throw new Error("Consent request failed");
      const result: { redirect?: unknown } = await response.json();
      if (typeof result.redirect !== "string") throw new Error("Missing callback");
      window.location.assign(result.redirect);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <main className="text-default mx-auto max-w-lg px-5 py-12 sm:py-20">
      <p className="font-cal text-emphasis mb-8 text-2xl font-semibold">{APP_NAME}</p>
      <h1 className="text-emphasis text-2xl font-semibold tracking-tight">{t("mcp_connect_title")}</h1>
      <p className="text-subtle mb-6 mt-2 text-sm">{t("mcp_connect_description")}</p>
      {!review || failed ? (
        <p role="alert" className="border-subtle mb-5 rounded-lg border p-4 text-sm">
          {t("mcp_request_failed")}
        </p>
      ) : null}
      {review ? (
        <>
          <dl className="border-subtle bg-default space-y-5 rounded-lg border p-5 text-sm">
            <div>
              <dt className="text-subtle">{t("mcp_assistant")}</dt>
              <dd className="text-emphasis mt-1 font-medium">{review.clientName}</dd>
              <dd className="text-subtle mt-1 text-xs">{t("mcp_client_name_note")}</dd>
            </div>
            <div>
              <dt className="text-subtle">{t("mcp_account")}</dt>
              <dd className="mt-1 break-all">{accountEmail}</dd>
            </div>
            <div>
              <dt className="text-subtle">{t("mcp_return_address")}</dt>
              <dd className="mt-1 break-all">{review.request.redirect_uri}</dd>
            </div>
          </dl>
          <h2 className="text-emphasis mb-2 mt-6 text-sm font-semibold">{t("mcp_permissions")}</h2>
          <ul className="ml-5 list-disc space-y-2 text-sm">
            {review.request.scope.split(" ").includes("cal:read") ? (
              <li>{t("mcp_permission_read")}</li>
            ) : null}
            {review.request.scope.split(" ").includes("cal:propose") ? (
              <li>{t("mcp_permission_propose")}</li>
            ) : null}
          </ul>
          <p className="bg-muted mt-5 rounded-lg p-4 text-sm">{t("mcp_confirmation_required")}</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button color="secondary" disabled={busy} onClick={() => decide("decline")}>
              {t("cancel")}
            </Button>
            <Button disabled={busy} onClick={() => decide("approve")}>
              {t("mcp_connect")}
            </Button>
          </div>
        </>
      ) : null}
    </main>
  );
}
