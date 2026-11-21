import { describe, expect, it, vi } from "vitest";
import { getOfferedSlots } from "./getOfferedSlots";

const eligible = {
  slots: Object.fromEntries(
    [16, 17, 18, 19, 20].map((day) => [
      `2026-11-${day}`,
      Array.from({ length: 8 }, (_, i) => ({
        time: `2026-11-${day}T${String(5 + i).padStart(2, "0")}:00:00.000Z`,
      })),
    ])
  ),
};
const config = {
  id: 7,
  ownerId: 12,
  timeZone: "Indian/Reunion",
  policy: { mode: "week", count: 3 } as const,
};
const input = {
  startTime: "2026-11-15T20:00:00Z",
  endTime: "2026-11-22T19:59:59Z",
  timeZone: "Indian/Reunion",
};

describe("offered availability pipeline", () => {
  it("expands a daily query to the full host week before selection", async () => {
    const fetchEligible = vi.fn().mockResolvedValue(eligible);
    await getOfferedSlots({
      config,
      input: {
        ...input,
        startTime: "2026-11-17T00:00:00Z",
        endTime: "2026-11-17T23:59:59Z",
        timeZone: "UTC",
      },
      fetchEligible,
      secret: "test-secret",
    });
    expect(fetchEligible).toHaveBeenCalledWith({
      startTime: "2026-11-15T20:00:00.000Z",
      endTime: "2026-11-22T19:59:59.999Z",
      timeZone: "Indian/Reunion",
    });
  });

  it("returns the same weekly choices when queried as separate days", async () => {
    const fetchEligible = vi.fn().mockResolvedValue(eligible);
    const whole = await getOfferedSlots({ config, input, fetchEligible, secret: "test-secret" });
    const daily = await Promise.all(
      [16, 17, 18, 19, 20].map((day) =>
        getOfferedSlots({
          config,
          input: {
            startTime: `2026-11-${day}T00:00:00Z`,
            endTime: `2026-11-${day}T23:59:59.999Z`,
            timeZone: "UTC",
          },
          fetchEligible,
          secret: "test-secret",
        })
      )
    );
    expect(daily.flatMap((result) => Object.values(result.slots).flat())).toEqual(
      Object.values(whole.slots).flat()
    );
    expect(Object.values(whole.slots).flat()).toHaveLength(3);
  });

  it("only bypasses the artificial restriction for the authenticated owner", async () => {
    const fetchEligible = vi.fn().mockResolvedValue(eligible);
    const own = await getOfferedSlots({ config, input, fetchEligible, viewerId: 12, secret: "test-secret" });
    expect(own).toEqual(eligible);
    expect(fetchEligible).toHaveBeenCalledWith(input);
    const other = await getOfferedSlots({
      config,
      input,
      fetchEligible,
      viewerId: 13,
      secret: "test-secret",
    });
    expect(Object.values(other.slots).flat()).toHaveLength(3);
  });

  it("never returns excluded times or extra days and preserves slot details", async () => {
    const slot = { time: "2026-11-17T10:00:00.000Z", attendees: 2, bookingUid: "existing-seat" };
    const result = await getOfferedSlots({
      config,
      input: { startTime: "2026-11-17T09:00:00Z", endTime: "2026-11-17T11:00:00Z", timeZone: "UTC" },
      secret: "test-secret",
      fetchEligible: async () => ({
        slots: { "2026-11-17": [slot], "2026-11-18": [{ time: "2026-11-18T10:00:00Z" }] },
      }),
    });
    expect(result.slots).toEqual({ "2026-11-17": [slot] });
  });

  it("keeps UTC instants identical when the guest changes timezone", async () => {
    const fetchEligible = vi.fn().mockResolvedValue(eligible);
    const run = (timeZone: string) =>
      getOfferedSlots({ config, input: { ...input, timeZone }, fetchEligible, secret: "test-secret" });
    expect(Object.values((await run("Pacific/Honolulu")).slots).flat()).toEqual(
      Object.values((await run("Asia/Tokyo")).slots).flat()
    );
  });
});
