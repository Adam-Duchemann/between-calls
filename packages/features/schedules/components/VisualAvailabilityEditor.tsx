"use client";

import { HostCalendarAgenda } from "@calcom/features/calendars/components/HostCalendarAgenda";
import { HostCalendarLayers } from "@calcom/features/calendars/components/HostCalendarLayers";
import { calendarOverlaySegments } from "@calcom/features/calendars/lib/calendarOverlaySegments";
import { hostCalendarRange } from "@calcom/features/calendars/lib/hostCalendarRange";
import { calendarSourceId, mergeHostCalendar } from "@calcom/features/calendars/lib/mergeHostCalendar";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
  type MinuteRange,
  readDay,
  restoreWeekly,
  type ScheduleDraft,
  writeDay,
} from "../lib/visualAvailability";
import { AvailabilityGrid, clockLabel, type RangeSelection } from "./AvailabilityGrid";

export function VisualAvailabilityEditor({
  children,
  weekStart,
  timeZone,
}: {
  children: ReactNode;
  weekStart: number;
  timeZone: string;
}) {
  const { t, i18n } = useLocale();
  const form = useFormContext<ScheduleDraft>();
  useWatch({ control: form.control });
  const draft = form.getValues();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  useEffect(() => {
    if (window.innerWidth < 640) setView("list");
  }, []);
  const [mode, setMode] = useState<"weekly" | "dates">("weekly");
  const [anchor, setAnchor] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date()
    )
  );
  const [selected, setSelected] = useState<RangeSelection | null>(null);
  const [remove, setRemove] = useState<RangeSelection | null>(null);
  const [undo, setUndo] = useState<ScheduleDraft | null>(null);
  const first = new Date(`${anchor}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() - weekStart + 7) % 7));
  const dates = Array.from({ length: 7 }, (_, index) => new Date(first.valueOf() + index * 86400000));
  const keys = dates.map((date) => (mode === "weekly" ? date.getUTCDay() : date.toISOString().slice(0, 10)));
  // An in-flight gesture indexes the days rendered when it started.
  const gridContext = `${timeZone}:${keys[0]}`;
  useEffect(() => {
    setSelected(null);
    setRemove(null);
  }, [gridContext]);
  const labels = dates.map((date) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: "short",
      ...(mode === "dates" ? ({ month: "short", day: "numeric" } as const) : {}),
      timeZone: "UTC",
    }).format(date)
  );
  const days = keys.map((key) => readDay(draft, key));
  const [hidden, setHidden] = useState<string[]>([]);
  const hostCalendar = trpc.viewer.calendars.hostCalendar.useQuery(
    hostCalendarRange(first.toISOString().slice(0, 10), timeZone),
    { enabled: mode === "dates" && view === "calendar" }
  );
  const entries = mergeHostCalendar(
    hidden.includes("bookings") ? [] : (hostCalendar.data?.bookings ?? []),
    (hostCalendar.data?.externalEvents ?? []).filter(
      (event) => !hidden.includes(calendarSourceId(event.credentialId, event.calendarId))
    )
  );
  const overlays =
    mode === "dates"
      ? calendarOverlaySegments(
          entries,
          dates.map((date) => date.toISOString().slice(0, 10)),
          timeZone
        )
      : [];
  const update = (next: ScheduleDraft) => {
    form.setValue("schedule", next.schedule, { shouldDirty: true });
    form.setValue("dateOverrides", next.dateOverrides, { shouldDirty: true });
  };
  const change = (values: MinuteRange[][]) => {
    let next = draft;
    values.forEach((ranges, day) => {
      if (JSON.stringify(ranges) !== JSON.stringify(days[day])) next = writeDay(next, keys[day], ranges);
    });
    update(next);
  };
  const current = selected ? days[selected.day]?.[selected.index] : null;
  const fieldClass = "border-default bg-default rounded-md border px-2 py-1 text-sm";
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["weekly", "dates"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              color={mode === value ? "primary" : "secondary"}
              onClick={() => {
                setMode(value);
                setSelected(null);
              }}>
              {t(value === "weekly" ? "availability_weekly" : "availability_specific_dates")}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {(["list", "calendar"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              color={view === value ? "primary" : "secondary"}
              onClick={() => setView(value)}>
              {t(`${value}_view`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-subtle mb-3 text-sm">
        {t("availability_editor_help")} · {timeZone}
      </p>
      {view === "list" ? (
        <>
          {children}
          <p className="text-subtle mt-2 text-sm">{t("availability_date_list_help")}</p>
        </>
      ) : (
        <>
          {mode === "dates" && (
            <div className="mb-3 flex items-center gap-2">
              <Button
                type="button"
                color="secondary"
                aria-label={t("previous_week")}
                onClick={() =>
                  setAnchor(new Date(first.valueOf() - 7 * 86400000).toISOString().slice(0, 10))
                }>
                ←
              </Button>
              <input
                className={fieldClass}
                aria-label={t("availability_week_of")}
                type="date"
                value={anchor}
                onChange={(event) => {
                  if (event.target.value) {
                    setAnchor(event.target.value);
                    setSelected(null);
                  }
                }}
              />
              <Button
                type="button"
                color="secondary"
                aria-label={t("next_week")}
                onClick={() =>
                  setAnchor(new Date(first.valueOf() + 7 * 86400000).toISOString().slice(0, 10))
                }>
                →
              </Button>
            </div>
          )}
          {mode === "dates" && (
            <>
              <HostCalendarLayers
                sources={hostCalendar.data?.sources ?? []}
                hidden={hidden}
                onToggle={(id) =>
                  setHidden((values) =>
                    values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
                  )
                }
                onRetry={() => {
                  void hostCalendar.refetch();
                }}
                loading={hostCalendar.isFetching}
                error={hostCalendar.isError}
              />
              <p className="text-subtle mb-2 text-sm">{t("host_calendar_overlay_help")}</p>
              {entries.some((entry) => entry.allDay) && (
                <HostCalendarAgenda entries={entries.filter((entry) => entry.allDay)} timeZone={timeZone} />
              )}
            </>
          )}
          <AvailabilityGrid
            key={gridContext}
            overlays={overlays}
            days={days}
            labels={labels}
            selected={selected}
            onSelect={setSelected}
            onChange={change}
            onRemove={setRemove}
          />
          {mode === "dates" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {keys.map((key, day) => (
                <Button
                  key={key}
                  type="button"
                  color="minimal"
                  onClick={() => {
                    setUndo(draft);
                    update(restoreWeekly(draft, String(key)));
                    setSelected(null);
                  }}>
                  {t("availability_restore_weekly", { day: labels[day] })}
                </Button>
              ))}
            </div>
          )}
          {selected && current && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              {(["start", "end"] as const).map((edge) => (
                <label key={edge} className="text-sm">
                  {t(`${edge}_time`)}
                  <input
                    className={`${fieldClass} ml-2`}
                    type="time"
                    step="60"
                    value={clockLabel(current[edge] === 1440 ? 1439 : current[edge])}
                    onChange={(event) => {
                      const [hour, minute] = event.target.value.split(":").map(Number);
                      const range = { ...current, [edge]: hour * 60 + minute };
                      if (!Number.isFinite(range[edge]) || range.start >= range.end) return;
                      const next = days.map((ranges, day) =>
                        day === selected.day
                          ? ranges.map((item, index) => (index === selected.index ? range : item))
                          : ranges
                      );
                      change(next);
                    }}
                  />
                </label>
              ))}
              <Button type="button" color="secondary" onClick={() => setRemove(selected)}>
                {t("availability_remove_range")}
              </Button>
            </div>
          )}
        </>
      )}
      {remove && (
        <div
          role="alertdialog"
          aria-label={t("availability_remove_range")}
          className="border-subtle mt-3 rounded border p-3"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setRemove(null);
            }
          }}>
          <p className="mb-2 text-sm">
            {t("availability_remove_confirm", {
              day: labels[remove.day],
              start: clockLabel(days[remove.day][remove.index].start),
              end: clockLabel(days[remove.day][remove.index].end),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              autoFocus
              onClick={() => {
                setUndo(draft);
                change(
                  days.map((ranges, day) =>
                    day === remove.day ? ranges.filter((_, index) => index !== remove.index) : ranges
                  )
                );
                setRemove(null);
                setSelected(null);
              }}>
              {t("confirm")}
            </Button>
            <Button type="button" color="secondary" onClick={() => setRemove(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {undo && (
        <div role="status" className="mt-3 flex items-center gap-2 text-sm">
          {t("availability_draft_updated")}
          <Button
            type="button"
            color="secondary"
            onClick={() => {
              update(undo);
              setUndo(null);
            }}>
            {t("undo")}
          </Button>
        </div>
      )}
    </div>
  );
}
