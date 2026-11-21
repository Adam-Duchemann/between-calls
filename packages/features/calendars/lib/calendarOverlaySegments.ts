import dayjs from "@calcom/dayjs";
import { getEventSegmentForDay } from "../weeklyview/utils/index";
import type { HostCalendarEntry } from "./mergeHostCalendar";

export type CalendarOverlaySegment = {
  key: string;
  title: string | null;
  start: number;
  end: number;
  isFree: boolean;
};

export function calendarOverlaySegments(
  entries: HostCalendarEntry[],
  dates: string[],
  timeZone: string
): CalendarOverlaySegment[][] {
  return dates.map((date) =>
    entries.flatMap((entry) => {
      const segment = getEventSegmentForDay(entry, dayjs(date), timeZone);
      if (!segment || !segment.end.isAfter(segment.start)) return [];
      const start = segment.start.hour() * 60 + segment.start.minute();
      let end =
        segment.end.format("YYYY-MM-DD") !== date ? 1440 : segment.end.hour() * 60 + segment.end.minute();
      // A repeated autumn hour can have an earlier clock end; retain its elapsed duration visibly.
      if (end <= start) end = Math.min(1440, start + segment.end.diff(segment.start, "minutes"));
      return [{ key: entry.key, title: entry.title, start, end, isFree: entry.isFree }];
    })
  );
}
