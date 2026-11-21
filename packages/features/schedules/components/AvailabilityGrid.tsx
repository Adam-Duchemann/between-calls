import type { CalendarOverlaySegment } from "@calcom/features/calendars/lib/calendarOverlaySegments";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { editGrid, type GridGesture, type MinuteRange } from "../lib/visualAvailability";

export const clockLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export type RangeSelection = { day: number; index: number };

export function AvailabilityGrid({
  days,
  labels,
  selected,
  onSelect,
  onChange,
  onRemove,
  overlays = [],
}: {
  days: MinuteRange[][];
  labels: string[];
  selected: RangeSelection | null;
  onSelect: (selection: RangeSelection | null) => void;
  onChange: (days: MinuteRange[][]) => void;
  onRemove: (selection: RangeSelection) => void;
  overlays?: CalendarOverlaySegment[][];
}) {
  const { t } = useLocale();
  const scroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ action: GridGesture; days: MinuteRange[][]; pointerId: number } | null>(null);
  const [preview, setPreview] = useState<MinuteRange[][] | null>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 8 * 48;
  }, []);
  const cancel = () => {
    gesture.current = null;
    setPreview(null);
  };
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      day: Math.max(0, Math.min(6, Math.floor((event.clientX - rect.left - 56) / ((rect.width - 56) / 7)))),
      minute: (event.clientY - rect.top) / 0.8,
    };
  };
  const displayed = preview ?? days;
  return (
    <div className="border-subtle max-w-full overflow-x-auto rounded-md border">
      <div
        className="grid text-center text-xs font-medium"
        style={{ minWidth: 560, gridTemplateColumns: "56px repeat(7,minmax(0,1fr))" }}>
        <span />
        {labels.map((label, index) => (
          <span key={index} className="border-subtle border-l px-1 py-3">
            {label}
          </span>
        ))}
      </div>
      <div ref={scroll} className="h-[480px] overflow-y-auto" style={{ minWidth: 560 }}>
        <div
          data-testid="availability-grid"
          className="relative select-none"
          style={{ height: 1152, minWidth: 560, touchAction: "pan-y" }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !(event.target instanceof HTMLElement)) return;
            const origin = point(event);
            if (event.clientX < event.currentTarget.getBoundingClientRect().left + 56) return;
            const block = event.target.closest<HTMLElement>("[data-range]");
            let action: GridGesture = { ...origin, kind: "create" };
            if (block) {
              const day = Number(block.dataset.day);
              const index = Number(block.dataset.range);
              const edge = event.target.dataset.edge;
              action = { ...origin, day, index, kind: edge === "start" || edge === "end" ? edge : "move" };
              onSelect({ day, index });
            } else onSelect(null);
            gesture.current = { action, days, pointerId: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
            setPreview(editGrid(gesture.current.days, gesture.current.action, point(event)));
          }}
          onPointerUp={(event) => {
            const current = gesture.current;
            if (!current || current.pointerId !== event.pointerId) return;
            if (preview || current.action.kind === "create")
              onChange(editGrid(current.days, current.action, point(event)));
            cancel();
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={cancel}
          onLostPointerCapture={cancel}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="border-subtle pointer-events-none absolute w-full border-t"
              style={{ top: hour * 48 }}>
              <span className="text-subtle bg-default block w-14 pr-2 text-right text-xs">
                {clockLabel(hour * 60)}
              </span>
            </div>
          ))}
          <div
            className="absolute inset-y-0 right-0 grid grid-cols-7"
            style={{ left: 56, touchAction: "none" }}>
            {displayed.map((ranges, day) => (
              <div key={day} className="border-subtle relative border-l">
                {ranges.map((range, index) => (
                  <button
                    type="button"
                    key={index}
                    data-day={day}
                    data-range={index}
                    aria-label={t("availability_range", {
                      day: labels[day],
                      start: clockLabel(range.start),
                      end: clockLabel(range.end),
                    })}
                    title={`${labels[day]} ${clockLabel(range.start)}–${clockLabel(range.end)}`}
                    aria-pressed={selected?.day === day && selected.index === index}
                    className="absolute left-0.5 right-0.5 cursor-grab overflow-hidden rounded border border-blue-500 bg-blue-100 px-1 text-left text-xs text-blue-950 focus:ring-2 focus:ring-blue-600 dark:bg-blue-950 dark:text-blue-100"
                    style={{ top: range.start * 0.8, height: (range.end - range.start) * 0.8, minHeight: 10 }}
                    onClick={() => onSelect({ day, index })}
                    onKeyDown={(event) => {
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        onRemove({ day, index });
                        return;
                      }
                      if (!event.key.startsWith("Arrow")) return;
                      event.preventDefault();
                      const nextDay = Math.max(
                        0,
                        Math.min(
                          6,
                          day + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)
                        )
                      );
                      const delta = event.key === "ArrowUp" ? -15 : event.key === "ArrowDown" ? 15 : 0;
                      onChange(
                        editGrid(
                          days,
                          { day, index, minute: range.start, kind: "move" },
                          { day: nextDay, minute: range.start + delta }
                        )
                      );
                    }}>
                    <span data-edge="start" className="absolute inset-x-0 top-0 h-2 cursor-n-resize" />
                    <span className="pointer-events-none absolute left-1 top-1">
                      {clockLabel(range.start)} – {clockLabel(range.end)}
                    </span>
                    <span data-edge="end" className="absolute inset-x-0 bottom-0 h-2 cursor-s-resize" />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 grid grid-cols-7"
            style={{ left: 56 }}>
            {overlays.map((events, day) => (
              <div key={day} className="relative">
                {events.map((event) => (
                  <div
                    key={event.key}
                    data-calendar-overlay="true"
                    className="absolute inset-x-1 overflow-hidden rounded border border-slate-500 bg-slate-200/80 px-1 text-xs text-slate-900 dark:bg-slate-800/80 dark:text-slate-100"
                    style={{
                      top: event.start * 0.8,
                      height: Math.max(12, (event.end - event.start) * 0.8),
                      borderStyle: event.isFree ? "dashed" : "solid",
                    }}>
                    {event.title || t("host_calendar_private_event")}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
