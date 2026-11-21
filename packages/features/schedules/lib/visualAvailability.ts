import type { TimeRange } from "@calcom/types/schedule";

export type MinuteRange = { start: number; end: number };
export type ScheduleDraft = { schedule: TimeRange[][]; dateOverrides: { ranges: TimeRange[] }[] };
export type GridPoint = { day: number; minute: number };
export type GridGesture = GridPoint & { kind: "create" | "move" | "start" | "end"; index?: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snap = (minute: number) => clamp(Math.round(minute / 15) * 15, 0, 1440);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function normalizeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const result: MinuteRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.start < 0 ||
      range.end > 1440 ||
      range.start >= range.end
    ) {
      throw new Error("Invalid availability interval");
    }
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function clockMinute(date: Date): number {
  // Cal stores local clock values in UTC fields; these are not actual event instants.
  if (date.getUTCHours() === 23 && date.getUTCMinutes() === 59) return 1440;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function readDay(draft: ScheduleDraft, day: number | string): MinuteRange[] {
  const weekday = typeof day === "number" ? day : new Date(`${day}T00:00:00Z`).getUTCDay();
  const overrides =
    typeof day === "string"
      ? draft.dateOverrides.flatMap((entry) => entry.ranges).filter((range) => dateKey(range.start) === day)
      : [];
  const ranges = overrides.length ? overrides : (draft.schedule[weekday] ?? []);
  return normalizeRanges(
    ranges
      .map(({ start, end }) => ({ start: clockMinute(start), end: clockMinute(end) }))
      .filter(({ start, end }) => start !== end)
  );
}

export function restoreWeekly(draft: ScheduleDraft, day: string): ScheduleDraft {
  return {
    ...draft,
    dateOverrides: draft.dateOverrides
      .map(({ ranges }) => ({ ranges: ranges.filter((range) => dateKey(range.start) !== day) }))
      .filter(({ ranges }) => ranges.length),
  };
}

export function writeDay(draft: ScheduleDraft, day: number | string, values: MinuteRange[]): ScheduleDraft {
  const date = typeof day === "string" ? day : "2000-01-01";
  const at = (minute: number) =>
    new Date(new Date(`${date}T00:00:00Z`).valueOf() + Math.min(minute * 60000, 86400000 - 1));
  const ranges = normalizeRanges(values).map(({ start, end }) => ({ start: at(start), end: at(end) }));
  if (typeof day === "number") {
    return {
      ...draft,
      schedule: Array.from({ length: 7 }, (_, index) =>
        index === day ? ranges : (draft.schedule[index] ?? [])
      ),
    };
  }
  const next = restoreWeekly(draft, day);
  // An explicit zero-length midnight override means closed; removing it restores weekly hours.
  return {
    ...next,
    dateOverrides: [
      ...next.dateOverrides,
      { ranges: ranges.length ? ranges : [{ start: at(0), end: at(0) }] },
    ],
  };
}

export function editGrid(days: MinuteRange[][], gesture: GridGesture, point: GridPoint): MinuteRange[][] {
  const result = days.map((ranges) => ranges.map((range) => ({ ...range })));
  const minute = snap(point.minute);
  const origin = snap(gesture.minute);
  if (gesture.kind === "create") {
    const start = Math.min(origin, minute, 1425);
    result[gesture.day].push({ start, end: Math.max(start + 15, origin, minute) });
    return result;
  }
  const range = result[gesture.day][gesture.index ?? -1];
  if (!range) return result;
  if (gesture.kind === "move") {
    const duration = range.end - range.start;
    const start = clamp(range.start + minute - origin, 0, 1440 - duration);
    result[gesture.day].splice(gesture.index ?? -1, 1);
    result[point.day].push({ start, end: start + duration });
  } else if (gesture.kind === "start") range.start = Math.min(minute, range.end - 15);
  else range.end = Math.max(minute, range.start + 15);
  return result;
}
