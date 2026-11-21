import { describe, expect, it } from "vitest";
import {
  editGrid,
  normalizeRanges,
  readDay,
  restoreWeekly,
  type ScheduleDraft,
  writeDay,
} from "./visualAvailability";

const range = (start: number, end: number) => ({ start, end });
const clock = (hour: number, date = "2026-11-16") =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
const draft = (): ScheduleDraft => ({
  schedule: [[], [{ start: clock(9), end: clock(17) }], [], [], [], [], []],
  dateOverrides: [],
});

describe("visual availability", () => {
  it("snaps drawn ranges to 15 minutes, including a backwards drag", () => {
    const days = [[], []];
    expect(editGrid(days, { kind: "create", day: 0, minute: 608 }, { day: 0, minute: 536 })[0]).toEqual([
      range(540, 615),
    ]);
  });
  it("moves across days, preserves duration and clamps at the end of the day", () => {
    const days = [[range(540, 600)], []];
    expect(editGrid(days, { kind: "move", day: 0, index: 0, minute: 570 }, { day: 1, minute: 1430 })).toEqual(
      [[], [range(1380, 1440)]]
    );
    expect(days[0]).toEqual([range(540, 600)]);
  });
  it("resizes either edge without crossing it", () => {
    const days = [[range(540, 600)]];
    expect(
      editGrid(days, { kind: "start", day: 0, index: 0, minute: 540 }, { day: 0, minute: 615 })[0]
    ).toEqual([range(585, 600)]);
    expect(
      editGrid(days, { kind: "end", day: 0, index: 0, minute: 600 }, { day: 0, minute: 690 })[0]
    ).toEqual([range(540, 690)]);
  });
  it("merges touching and overlapping ranges without changing separate windows", () => {
    expect(normalizeRanges([range(600, 660), range(540, 610), range(660, 675), range(720, 780)])).toEqual([
      range(540, 675),
      range(720, 780),
    ]);
    expect(() => normalizeRanges([range(600, 540)])).toThrow();
  });
  it("gives specific dates precedence, including an explicitly closed day", () => {
    const edited = writeDay(draft(), "2026-11-16", []);
    expect(readDay(edited, "2026-11-16")).toEqual([]);
    expect(readDay(edited, "2026-11-23")).toEqual([range(540, 1020)]);
    expect(readDay(restoreWeekly(edited, "2026-11-16"), "2026-11-16")).toEqual([range(540, 1020)]);
  });
  it("keeps multiple windows and midnight endpoints in Cal's wall-clock format", () => {
    const edited = writeDay(draft(), "2026-11-16", [range(540, 600), range(1380, 1440)]);
    expect(readDay(edited, "2026-11-16")).toEqual([range(540, 600), range(1380, 1440)]);
    expect(edited.dateOverrides[0].ranges[1].end.toISOString()).toBe("2026-11-16T23:59:59.999Z");
  });
  it.each(["2026-03-08", "2026-11-01"])("preserves wall-clock dates across a DST boundary: %s", (date) => {
    const edited = writeDay(draft(), date, [range(540, 1020)]);
    expect(readDay(edited, date)).toEqual([range(540, 1020)]);
    expect(edited.dateOverrides[0].ranges[0].start.toISOString()).toBe(`${date}T09:00:00.000Z`);
  });
});
