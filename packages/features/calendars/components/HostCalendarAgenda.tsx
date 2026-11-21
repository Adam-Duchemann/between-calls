import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { HostCalendarEntry } from "../lib/mergeHostCalendar";

export function HostCalendarAgenda({
  entries,
  timeZone,
}: {
  entries: HostCalendarEntry[];
  timeZone: string;
}) {
  const { t, i18n } = useLocale();
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value)
    );
  return (
    <ul className="border-subtle mb-3 divide-y rounded-md border text-sm">
      {entries.map((entry) => (
        <li key={entry.key} className="p-3">
          <strong>{entry.title || t("host_calendar_private_event")}</strong>
          <p className="text-subtle">
            {date(entry.start)} ·{" "}
            {entry.allDay ? t("host_calendar_all_day") : `${time(entry.start)}–${time(entry.end)}`}
            {date(entry.start) !== date(new Date(new Date(entry.end).valueOf() - 1).toISOString()) &&
              ` · ${date(new Date(new Date(entry.end).valueOf() - 1).toISOString())}`}
            {entry.isFree && ` · ${t("host_calendar_free")}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
