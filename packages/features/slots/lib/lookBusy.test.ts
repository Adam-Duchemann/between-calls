import { lookBusySchema } from "@calcom/prisma/lookBusySchema";
import { describe, expect, it } from "vitest";
import { getLookBusyRange, selectLookBusySlots } from "./lookBusy";

const times = (date: string, count = 16) =>
  Array.from({ length: count }, (_, index) => ({
    time: `${date}T${String(5 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00.000Z`,
    attendees: 0,
  }));
const options = { timeZone: "Indian/Reunion", eventTypeId: 7, ownerId: 12, secret: "test-only-secret" };

describe("Look busy", () => {
  it("leaves genuine availability unchanged when disabled", () => {
    const slots = times("2026-11-16");
    expect(selectLookBusySlots({ ...options, slots, policy: { mode: "off" } })).toEqual(slots);
  });

  it("caps the offered choices separately for each host-local day", () => {
    const slots = [...times("2026-11-16"), ...times("2026-11-17")];
    const selected = selectLookBusySlots({ ...options, slots, policy: { mode: "day", count: 3 } });
    expect(selected).toHaveLength(6);
    expect(selected.filter((slot) => slot.time.startsWith("2026-11-16"))).toHaveLength(3);
    expect(selected.every((slot) => slots.includes(slot))).toBe(true);
  });

  it("selects up to N for the whole Monday-Sunday week, allowing empty days", () => {
    const slots = [16, 17, 18, 19, 20].flatMap((day) => times(`2026-11-${day}`));
    const selected = selectLookBusySlots({ ...options, slots, policy: { mode: "week", count: 3 } });
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((slot) => slot.time.slice(0, 10))).size).toBeLessThanOrEqual(3);
  });

  it("returns the same choices across reloads and input order changes", () => {
    const slots = times("2026-11-16");
    const request = { ...options, policy: { mode: "day", count: 4 } as const };
    const selected = selectLookBusySlots({ ...request, slots });
    expect(selectLookBusySlots({ ...request, slots: [...slots].reverse() })).toEqual(selected);
    expect(selectLookBusySlots({ ...request, slots })).toEqual(selected);
  });

  it("uses irregular choices that differ between event types and dates", () => {
    const request = { ...options, slots: times("2026-11-16"), policy: { mode: "day", count: 5 } as const };
    const selected = selectLookBusySlots(request);
    const gaps = selected.slice(1).map((slot, i) => Date.parse(slot.time) - Date.parse(selected[i].time));
    expect(new Set(gaps).size).toBeGreaterThan(1);
    expect(selectLookBusySlots({ ...request, eventTypeId: 8 })).not.toEqual(selected);
    expect(
      selectLookBusySlots({ ...request, slots: times("2026-11-17") }).map((s) => s.time.slice(11))
    ).not.toEqual(selected.map((s) => s.time.slice(11)));
  });

  it("hides about 66 percent while keeping one choice on a nonempty day", () => {
    expect(
      selectLookBusySlots({
        ...options,
        slots: times("2026-11-16", 12),
        policy: { mode: "percentage", percentage: 66 },
      })
    ).toHaveLength(4);
    expect(
      selectLookBusySlots({
        ...options,
        slots: times("2026-11-16", 1),
        policy: { mode: "percentage", percentage: 66 },
      })
    ).toHaveLength(1);
    expect(
      selectLookBusySlots({ ...options, slots: [], policy: { mode: "percentage", percentage: 66 } })
    ).toEqual([]);
  });

  it("never invents choices when fewer than the requested count remain", () => {
    const slots = times("2026-11-16", 2);
    expect(selectLookBusySlots({ ...options, slots, policy: { mode: "week", count: 20 } })).toEqual(slots);
  });

  it("removes a newly busy slot without reshuffling the remaining choices", () => {
    const request = { ...options, slots: times("2026-11-16"), policy: { mode: "day", count: 4 } as const };
    const selected = selectLookBusySlots(request);
    const remaining = selectLookBusySlots({
      ...request,
      slots: request.slots.filter((s) => s !== selected[0]),
    });
    expect(remaining).toHaveLength(4);
    expect(remaining).not.toContain(selected[0]);
    expect(selected.slice(1).every((slot) => remaining.includes(slot))).toBe(true);
  });

  it("groups by the host timezone at midnight and the week boundary", () => {
    const slots = [
      { time: "2026-11-15T19:30:00Z" },
      { time: "2026-11-15T20:00:00Z" },
      { time: "2026-11-16T05:00:00Z" },
    ];
    expect(selectLookBusySlots({ ...options, slots, policy: { mode: "week", count: 1 } })).toHaveLength(2);
  });

  it("requires a private server seed for enabled policies", () => {
    expect(() =>
      selectLookBusySlots({
        ...options,
        secret: "",
        slots: times("2026-11-16"),
        policy: { mode: "day", count: 3 },
      })
    ).toThrow();
  });
});

describe("canonical availability range", () => {
  it("fetches the same full host week for any daily query in it", () => {
    const policy = { mode: "week", count: 3 } as const;
    const getRange = (date: string) =>
      getLookBusyRange({
        startTime: `${date}T05:00:00Z`,
        endTime: `${date}T13:00:00Z`,
        timeZone: options.timeZone,
        policy,
      });
    expect(getRange("2026-11-16")).toEqual(getRange("2026-11-20"));
    expect(getRange("2026-11-16")).toEqual({
      startTime: "2026-11-15T20:00:00.000Z",
      endTime: "2026-11-22T19:59:59.999Z",
    });
  });

  it("uses the actual DST offset at both ends of a week", () => {
    expect(
      getLookBusyRange({
        startTime: "2026-03-04T12:00:00Z",
        endTime: "2026-03-04T18:00:00Z",
        timeZone: "America/New_York",
        policy: { mode: "week", count: 3 },
      })
    ).toEqual({ startTime: "2026-03-02T05:00:00.000Z", endTime: "2026-03-09T03:59:59.999Z" });
  });

  it("expands a partial day without changing the original disabled range", () => {
    const range = { startTime: "2026-11-16T09:00:00Z", endTime: "2026-11-16T10:00:00Z" };
    expect(
      getLookBusyRange({ ...range, timeZone: options.timeZone, policy: { mode: "day", count: 3 } })
    ).toEqual({ startTime: "2026-11-15T20:00:00.000Z", endTime: "2026-11-16T19:59:59.999Z" });
    expect(getLookBusyRange({ ...range, timeZone: options.timeZone, policy: { mode: "off" } })).toEqual(
      range
    );
  });
});

describe("policy validation", () => {
  it.each([0, -1, 1.5, 1001, Number.NaN])("rejects invalid count %s", (count) => {
    expect(lookBusySchema.safeParse({ mode: "day", count }).success).toBe(false);
  });
  it("accepts only supported percentage presets", () => {
    for (const percentage of [10, 20, 33, 66])
      expect(lookBusySchema.safeParse({ mode: "percentage", percentage }).success).toBe(true);
    expect(lookBusySchema.safeParse({ mode: "percentage", percentage: 100 }).success).toBe(false);
  });
});
