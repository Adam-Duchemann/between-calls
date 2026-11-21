import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";

export function HostCalendarLayers({
  sources,
  hidden,
  onToggle,
  onRetry,
  loading,
  error,
}: {
  sources: { id: string; externalId: string; status: "ok" | "error" | "reconnect" }[];
  hidden: string[];
  onToggle: (id: string) => void;
  onRetry: () => void;
  loading: boolean;
  error: boolean;
}) {
  const { t } = useLocale();
  const failed = error || sources.some((source) => source.status !== "ok");
  return (
    <fieldset className="border-subtle mb-4 rounded-md border p-3">
      <legend className="text-subtle px-1 text-sm">{t("host_calendar_layers")}</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        {[{ id: "bookings", externalId: t("bookings"), status: "ok" as const }, ...sources].map((source) => (
          <label key={source.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!hidden.includes(source.id)}
              onChange={() => onToggle(source.id)}
            />
            {source.externalId}
            {source.status !== "ok" && (
              <span className="text-error" role="status">
                {t(source.status === "reconnect" ? "host_calendar_reconnect" : "host_calendar_source_error")}
              </span>
            )}
          </label>
        ))}
      </div>
      {loading && (
        <p role="status" className="text-subtle mt-2 text-sm">
          {t("host_calendar_loading")}
        </p>
      )}
      {failed && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span>{t("host_calendar_incomplete")}</span>
          <Button type="button" color="secondary" onClick={onRetry}>
            {t("retry")}
          </Button>
          <a className="underline" href="/settings/my-account/calendars">
            {t("host_calendar_manage")}
          </a>
        </div>
      )}
    </fieldset>
  );
}
