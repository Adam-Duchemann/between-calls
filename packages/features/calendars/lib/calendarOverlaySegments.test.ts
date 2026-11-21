import { expect, it } from "vitest";
import { calendarOverlaySegments } from "./calendarOverlaySegments";
import type { HostCalendarEntry } from "./mergeHostCalendar";

it("clips multi-day events to the visible host date and excludes midnight from the next day", () => {
  const event: HostCalendarEntry = {
    key: "one",
    kind: "external",
    title: "Overnight",
    start: "2026-11-16T19:00:00Z",
    end: "2026-11-17T20:00:00Z",
    allDay: false,
    isFree: false,
    sourceIds: [],
  };
  expect(
    calendarOverlaySegments([event], ["2026-11-16", "2026-11-17", "2026-11-18"], "Indian/Reunion").map(
      (day) => day.map(({ start, end }) => [start, end])
    )
  ).toEqual([[[1380, 1440]], [[0, 1440]], []]);
});

it("retains the full wall-clock day across a 23-hour DST date", () => {
  const event: HostCalendarEntry = {
    key: "all",
    kind: "external",
    title: null,
    start: "2026-03-08T05:00:00Z",
    end: "2026-03-09T04:00:00Z",
    allDay: true,
    isFree: false,
    sourceIds: [],
  };
  expect(calendarOverlaySegments([event], ["2026-03-08"], "America/New_York")[0][0]).toMatchObject({
    start: 0,
    end: 1440,
  });
});
