import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import type { IAvailableSlotsService } from "./util";
import { AvailableSlotsService } from "./util";

const input = {
  eventTypeId: 1,
  startTime: "2026-11-16T00:00:00Z",
  endTime: "2026-11-16T23:59:59Z",
  timeZone: "UTC",
  isTeamEvent: false,
};

function setup() {
  const redisClient = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) };
  const service = new AvailableSlotsService({
    redisClient,
    eventTypeRepo: {
      findForSlots: vi.fn().mockResolvedValue({ id: 1, userId: 12, metadata: { lookBusy: { mode: "off" } } }),
    },
  } as unknown as IAvailableSlotsService);
  const calculate = vi
    .spyOn(service, "_getAvailableSlots")
    .mockResolvedValue({ slots: { "2026-11-16": [{ time: "2026-11-16T05:00:00Z" }] } });
  return { service, redisClient, calculate };
}

describe("slot cache isolation", () => {
  it.each([
    "_enableTroubleshooter",
    "_bypassCalendarBusyTimes",
    "_silentCalendarFailures",
  ] as const)("rejects public or unrelated viewers requesting %s", async (flag) => {
    const { service, calculate, redisClient } = setup();
    for (const viewerId of [undefined, 99]) {
      const session = viewerId ? ({ user: { id: viewerId } } as Session) : null;
      await expect(
        service.getAvailableSlots({ input: { ...input, [flag]: true }, ctx: { session } })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(calculate).not.toHaveBeenCalled();
    expect(redisClient.get).not.toHaveBeenCalled();
  });

  it("uses the owner's default schedule timezone when the event has no explicit schedule", async () => {
    const { service, calculate } = setup();
    const eventType = {
      id: 1,
      userId: 12,
      timeZone: null,
      schedule: null,
      hosts: [],
      metadata: { lookBusy: { mode: "week", count: 3 } },
      users: [
        {
          id: 12,
          timeZone: "UTC",
          defaultScheduleId: 4,
          schedules: [{ id: 4, timeZone: "Indian/Reunion", availability: [] }],
        },
      ],
    };
    vi.mocked(service.dependencies.eventTypeRepo.findForSlots).mockResolvedValue(
      eventType as unknown as Awaited<ReturnType<IAvailableSlotsService["eventTypeRepo"]["findForSlots"]>>
    );
    await service.getAvailableSlots({ input });
    expect(calculate).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ timeZone: "Indian/Reunion" }) })
    );
  });

  it("keeps an authenticated owner's response out of the public cache", async () => {
    const { service, redisClient, calculate } = setup();
    const session = { user: { id: 12 }, expires: "2026-12-01T00:00:00Z" } as Session;
    await service.getAvailableSlots({ input, ctx: { session } });
    expect(calculate).toHaveBeenCalledOnce();
    expect(redisClient.get).not.toHaveBeenCalled();
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("does not cache reservation-specific or booking-validation results", async () => {
    const { service, redisClient, calculate } = setup();
    await service.getAvailableSlots({ input, ctx: { bookerClientUid: "own-reservation" } });
    await service.getAvailableSlots({ input, ctx: { bypassSlotsCache: true } });
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(redisClient.get).not.toHaveBeenCalled();
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it("still caches unpersonalized anonymous availability", async () => {
    const { service, redisClient } = setup();
    await service.getAvailableSlots({ input });
    expect(redisClient.get).toHaveBeenCalledOnce();
    expect(redisClient.set).toHaveBeenCalledOnce();
  });
});
