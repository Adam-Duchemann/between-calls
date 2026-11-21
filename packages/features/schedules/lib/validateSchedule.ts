import type { TimeRange } from "@calcom/types/schedule";
import { z } from "zod";

const rangeSchema = z.object({ start: z.date(), end: z.date() });
const clock = (date: Date) =>
  date.getUTCHours() * 3600000 +
  date.getUTCMinutes() * 60000 +
  date.getUTCSeconds() * 1000 +
  date.getUTCMilliseconds();

function validateDay(ranges: TimeRange[], ctx: z.RefinementCtx, allowClosed = false) {
  const sorted = [...ranges].sort((a, b) => clock(a.start) - clock(b.start));
  for (let index = 0; index < sorted.length; index++) {
    const { start, end } = sorted[index];
    if (allowClosed && sorted.length === 1 && clock(start) === 0 && clock(end) === 0) continue;
    if (clock(start) >= clock(end) || (index > 0 && clock(start) < clock(sorted[index - 1].end))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Availability times must be ordered and must not overlap.",
      });
    }
  }
}

export const weeklyScheduleSchema = z
  .array(z.array(rangeSchema).superRefine((ranges, ctx) => validateDay(ranges, ctx)))
  .length(7);

export const dateOverridesSchema = z.array(rangeSchema).superRefine((ranges, ctx) => {
  const dates = new Map<string, TimeRange[]>();
  for (const range of ranges) {
    const date = range.start.toISOString().slice(0, 10);
    if (date !== range.end.toISOString().slice(0, 10)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each date override must start and end on the same date.",
      });
    }
    dates.set(date, [...(dates.get(date) ?? []), range]);
  }
  for (const day of Array.from(dates.values())) validateDay(day, ctx, true);
});
