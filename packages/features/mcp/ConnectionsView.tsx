"use client";

import SettingsHeader from "@calcom/features/settings/appDir/SettingsHeader";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { useState } from "react";
import type { TokenService } from "./TokenService";

type ConnectionList = Awaited<ReturnType<TokenService["connections"]>>;
export function ConnectionsView({ endpoint, initial }: { endpoint: string; initial: ConnectionList }) {
  const { t } = useLocale();
  const [connections, setConnections] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  async function disconnect(id: string) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/mcp/connections", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId: id }),
      });
      if (!response.ok) throw new Error("Disconnect failed");
      setConnections((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
      setSelected(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function load(more = false) {
    setBusy(true);
    setFailed(false);
    try {
      const query =
        more && connections.nextCursor ? `?afterId=${encodeURIComponent(connections.nextCursor)}` : "";
      const response = await fetch(`/api/mcp/connections${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Loading connections failed");
      const next: ConnectionList = await response.json();
      setConnections((current) => ({
        ...next,
        items: more ? [...current.items, ...next.items] : next.items,
      }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }
  return (
    <SettingsHeader
      title={t("mcp_connections_title")}
      description={t("mcp_connections_description")}
      borderInShellHeader>
      <div className="border-subtle space-y-6 rounded-b-xl border-x border-b px-4 py-6 sm:px-6">
        <section>
          <h2 className="text-emphasis text-sm font-semibold">{t("mcp_server_url")}</h2>
          <p className="text-subtle mb-3 mt-1 text-sm">{t("mcp_connect_instructions")}</p>
          <div className="border-subtle flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <code className="break-all text-sm">{endpoint}</code>
            <Button color="secondary" size="sm" onClick={copy}>
              {t(copied ? "copied" : "copy")}
            </Button>
          </div>
          <p className="text-subtle mt-3 text-xs">{t("mcp_confirmation_required")}</p>
        </section>
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-emphasis text-sm font-semibold">{t("mcp_connected_assistants")}</h2>
            <Button color="minimal" size="sm" disabled={busy} onClick={() => load()}>
              {t("mcp_refresh_connections")}
            </Button>
          </div>
          {failed ? (
            <p role="alert" className="mb-4 text-sm">
              {t("mcp_connections_failed")}
            </p>
          ) : null}
          {connections.items.length === 0 ? (
            <p className="text-subtle border-subtle rounded-lg border p-5 text-sm">
              {t("mcp_no_connections")}
            </p>
          ) : (
            <ul className="space-y-3">
              {connections.items.map((connection) => (
                <li key={connection.id} className="border-subtle rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-emphasis break-words text-sm font-medium">
                        {connection.clientName}
                      </h3>
                      <p className="text-subtle mt-1 text-xs">
                        {t(Date.parse(connection.expiresAt) <= Date.now() ? "expired" : "mcp_connected")}
                      </p>
                    </div>
                    <Button
                      color="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => setSelected(connection.id)}>
                      {t("mcp_disconnect")}
                    </Button>
                  </div>
                  <ul className="text-subtle mt-3 space-y-1 text-sm">
                    {connection.scopes.includes("cal:read") ? <li>{t("mcp_permission_read")}</li> : null}
                    {connection.scopes.includes("cal:propose") ? (
                      <li>{t("mcp_permission_propose")}</li>
                    ) : null}
                  </ul>
                  {selected === connection.id ? (
                    <form
                      aria-label={connection.clientName}
                      className="bg-muted mt-4 rounded-lg p-4"
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !busy) setSelected(null);
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        disconnect(connection.id);
                      }}>
                      <p className="text-sm">{t("mcp_disconnect_effect", { name: connection.clientName })}</p>
                      <div className="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          color="minimal"
                          size="sm"
                          disabled={busy}
                          onClick={() => setSelected(null)}>
                          {t("cancel")}
                        </Button>
                        <Button color="destructive" type="submit" size="sm" autoFocus disabled={busy}>
                          {t("mcp_confirm_disconnect")}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {connections.nextCursor ? (
            <div className="mt-4">
              <Button color="secondary" disabled={busy} onClick={() => load(true)}>
                {t("load_more")}
              </Button>
            </div>
          ) : null}
          <p className="text-subtle mt-4 text-xs">{t("mcp_client_name_note")}</p>
        </section>
      </div>
    </SettingsHeader>
  );
}
