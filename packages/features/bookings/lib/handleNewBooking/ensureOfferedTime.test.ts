import { describe, expect, it, vi } from "vitest";
import { ensureOfferedTime } from "./ensureOfferedTime";

const request = { start: "2026-11-17T05:00:00Z", ownerId: 12, policy: { mode: "day", count: 3 } as const };

describe("Look busy booking enforcement", () => {
  it("rejects a direct booking of a hidden time", async () => {
    const getSlots = vi
      .fn()
      .mockResolvedValue({ slots: { "2026-11-17": [{ time: "2026-11-17T08:00:00Z" }] } });
    await expect(ensureOfferedTime({ ...request, getSlots })).rejects.toMatchObject({
      code: "booking_conflict_error",
    });
  });

  it("allows the same offered instant with a different timezone representation", async () => {
    await expect(
      ensureOfferedTime({
        ...request,
        getSlots: async () => ({ slots: { "2026-11-17": [{ time: "2026-11-17T09:00:00+04:00" }] } }),
      })
    ).resolves.toBeUndefined();
  });

  it("permits an authenticated owner bypass but not an unrelated user", async () => {
    const getSlots = vi.fn().mockResolvedValue({ slots: {} });
    await expect(ensureOfferedTime({ ...request, viewerId: 12, getSlots })).resolves.toBeUndefined();
    expect(getSlots).not.toHaveBeenCalled();
    await expect(ensureOfferedTime({ ...request, viewerId: 13, getSlots })).rejects.toMatchObject({
      code: "booking_conflict_error",
    });
  });

  it("adds no availability lookup when the policy is off or missing", async () => {
    const getSlots = vi.fn();
    await ensureOfferedTime({ ...request, policy: undefined, getSlots });
    await ensureOfferedTime({ ...request, policy: { mode: "off" }, getSlots });
    expect(getSlots).not.toHaveBeenCalled();
  });

  it("does not silently allow bookings when availability lookup fails", async () => {
    await expect(
      ensureOfferedTime({
        ...request,
        getSlots: async () => {
          throw new Error("calendar unavailable");
        },
      })
    ).rejects.toThrow("calendar unavailable");
  });
});
