import { describe, expect, it } from "vitest";
import { dateOverridesSchema, weeklyScheduleSchema } from "./validateSchedule";

const r = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });
const week = (ranges: ReturnType<typeof r>[]) => [[], ranges, [], [], [], [], []];

describe("saved schedule validation", () => {
  it("requires seven days and ordered nonoverlapping wall-clock ranges", () => {
    const valid = r("2026-11-16T09:00Z", "2026-11-16T17:00Z");
    expect(weeklyScheduleSchema.safeParse(week([valid])).success).toBe(true);
    expect(weeklyScheduleSchema.safeParse([[]]).success).toBe(false);
    expect(weeklyScheduleSchema.safeParse(week([valid, valid])).success).toBe(false);
    expect(weeklyScheduleSchema.safeParse(week([r("2026-11-16T17:00Z", "2026-11-17T09:00Z")])).success).toBe(
      false
    );
  });
  it("accepts closed dates and rejects closed-plus-open or cross-date overrides", () => {
    const closed = r("2026-11-16T00:00Z", "2026-11-16T00:00Z");
    const open = r("2026-11-16T09:00Z", "2026-11-16T17:00Z");
    expect(dateOverridesSchema.safeParse([closed]).success).toBe(true);
    expect(dateOverridesSchema.safeParse([closed, open]).success).toBe(false);
    expect(dateOverridesSchema.safeParse([r("2026-11-16T09:00Z", "2026-11-17T10:00Z")]).success).toBe(false);
    expect(dateOverridesSchema.safeParse([r("2026-11-16T09:00Z", "2026-11-16T09:00Z")]).success).toBe(false);
  });
});
