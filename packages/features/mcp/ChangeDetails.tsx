"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { McpAction } from "./actions";

const labels: Record<string, string> = {
  title: "title",
  slug: "url",
  length: "duration",
  description: "description",
  name: "name",
  timeZone: "timezone",
  minimumBookingNotice: "minimum_booking_notice",
  beforeEventBuffer: "mcp_before_buffer",
  afterEventBuffer: "mcp_after_buffer",
  hidden: "mcp_hidden_event",
};
const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const time = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;

export function ChangeDetails({ action, timeZone }: { action: McpAction; timeZone: string }) {
  const { t } = useLocale();
  const values: { label: string; value: string }[] = [];
  if (action.kind === "booking_create" || action.kind === "booking_reschedule") {
    values.push({
      label: t("mcp_new_time"),
      value: `${new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone }).format(new Date(action.start))} (${timeZone})`,
    });
  }
  if (action.kind === "booking_create") {
    values.push(
      { label: t("attendee"), value: `${action.attendee.name} <${action.attendee.email}>` },
      { label: t("mcp_guest_timezone"), value: action.attendee.timeZone }
    );
    if (action.notes) values.push({ label: t("notes"), value: action.notes });
  }
  if (action.kind === "booking_cancel")
    values.push({ label: t("cancellation_reason"), value: action.reason });
  if (
    action.kind === "event_type_create" ||
    action.kind === "event_type_update" ||
    action.kind === "availability_update"
  ) {
    const changes = action.kind === "event_type_create" ? action : action.changes;
    for (const [key, value] of Object.entries(changes)) {
      if (!labels[key] || value === undefined) continue;
      values.push({
        label: t(labels[key]),
        value:
          typeof value === "number"
            ? t("mcp_minutes", { count: value })
            : typeof value === "boolean"
              ? t(value ? "yes" : "no")
              : String(value),
      });
    }
  }
  if (action.kind === "event_type_update" && action.changes.lookBusy) {
    const policy = action.changes.lookBusy;
    const value =
      policy.mode === "off"
        ? t("look_busy_off")
        : policy.mode === "percentage"
          ? t("look_busy_hide_percentage", { percentage: policy.percentage })
          : t(policy.mode === "day" ? "mcp_times_per_day" : "mcp_times_per_week", { count: policy.count });
    values.push({ label: t("look_busy_title"), value });
  }
  if (action.kind === "availability_update") {
    const rangesText = (ranges: { start: number; end: number }[]) =>
      ranges.length
        ? ranges.map(({ start, end }) => `${time(start)}–${time(end)}`).join(", ")
        : t("mcp_unavailable");
    action.changes.weekly?.forEach((ranges, day) =>
      values.push({ label: t(days[day]), value: rangesText(ranges) })
    );
    if (action.changes.overrides?.length === 0)
      values.push({ label: t("mcp_date_overrides"), value: t("mcp_clear_overrides") });
    action.changes.overrides?.forEach(({ date, ranges }) =>
      values.push({ label: date, value: rangesText(ranges) })
    );
  }
  return (
    <dl className="divide-subtle divide-y text-sm">
      {values.map(({ label, value }, index) => (
        <div key={`${label}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[160px_1fr]">
          <dt className="text-subtle">{label}</dt>
          <dd className="whitespace-pre-wrap break-words">{value || t("mcp_empty_value")}</dd>
        </div>
      ))}
    </dl>
  );
}
