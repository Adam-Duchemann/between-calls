import type { PrismaClient } from "@calcom/prisma";
import type { Booking, EventType } from "@calcom/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { ReadService } from "./ReadService";
import { scheduleTimes } from "./scheduleTimes";

const range = { dateFrom: "2026-11-16T00:00:00Z", dateTo: "2026-11-22T23:59:59Z" };
function setup() {
  const prisma = mockDeep<PrismaClient>();
  const slots = vi.fn().mockResolvedValue({
    slots: { "2026-11-17": [{ time: "2026-11-17T10:00:00Z", reason: "private note" }] },
    troubleshooter: { private: true },
  });
  return { prisma, slots, service: new ReadService(prisma, slots) };
}

describe("account-scoped MCP reads", () => {
  it("restricts event and booking lists to the owner with bounded pagination", async () => {
    const { service, prisma } = setup();
    prisma.eventType.findMany.mockResolvedValue([]);
    prisma.booking.findMany.mockResolvedValue([]);
    await service.eventTypes(1, { afterId: 5 });
    expect(prisma.eventType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, teamId: null, id: { gt: 5 } }, take: 101 })
    );
    await service.bookings(1, range);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1 }), take: 101 })
    );
    const selected = JSON.stringify(prisma.booking.findMany.mock.calls[0]);
    expect(selected).not.toContain("credential");
    expect(selected).not.toContain("references");
  });

  it("lists booking durations with a default for fixed-length meeting types", async () => {
    const { service, prisma } = setup();
    prisma.eventType.findMany.mockResolvedValue([
      mockDeep<EventType>({ id: 1, length: 30, metadata: { multipleDuration: [30, 45, 60] } }),
      mockDeep<EventType>({ id: 2, length: 20, metadata: null }),
    ]);
    expect(await service.eventTypes(1, {})).toMatchObject({
      items: [
        { id: 1, length: 30, durationOptions: [30, 45, 60] },
        { id: 2, length: 20, durationOptions: [20] },
      ],
    });
  });

  it("refuses another account's event before asking for availability", async () => {
    const { service, prisma, slots } = setup();
    prisma.eventType.findFirst.mockResolvedValue(null);
    await expect(service.availability(2, { eventTypeId: 1, ...range, timeZone: "UTC" })).rejects.toThrow();
    expect(slots).not.toHaveBeenCalled();
    expect(prisma.eventType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, userId: 2, teamId: null } })
    );
  });

  it("reads the same public offerings without an owner bypass and returns only times", async () => {
    const { service, prisma, slots } = setup();
    prisma.eventType.findFirst.mockResolvedValue(mockDeep<EventType>({ id: 1, userId: 1, length: 30 }));
    expect(await service.availability(1, { eventTypeId: 1, ...range, timeZone: "UTC" })).toEqual({
      eventTypeId: 1,
      timeZone: "UTC",
      duration: 30,
      slots: { "2026-11-17": ["2026-11-17T10:00:00Z"] },
    });
    expect(slots).toHaveBeenCalledWith({
      ctx: { bypassSlotsCache: true },
      input: {
        eventTypeId: 1,
        startTime: range.dateFrom,
        endTime: range.dateTo,
        timeZone: "UTC",
        isTeamEvent: false,
        duration: 30,
      },
    });
  });

  it("uses the owned active booking when reading reschedule offerings", async () => {
    const { service, prisma, slots } = setup();
    prisma.eventType.findFirst.mockResolvedValue(
      mockDeep<EventType>({ id: 1, length: 30, metadata: { multipleDuration: [30, 45, 60] } })
    );
    prisma.booking.findFirst.mockResolvedValue(
      mockDeep<Booking>({
        uid: "owned-booking",
        startTime: new Date("2026-11-17T10:00:00Z"),
        endTime: new Date("2026-11-17T10:45:00Z"),
      })
    );
    await service.availability(1, {
      eventTypeId: 1,
      ...range,
      timeZone: "UTC",
      rescheduleUid: "owned-booking",
    });
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { uid: "owned-booking", userId: 1, eventTypeId: 1, status: { in: ["ACCEPTED", "PENDING"] } },
      select: { startTime: true, endTime: true },
    });
    expect(slots).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ rescheduleUid: "owned-booking", duration: 45 }),
      })
    );
  });

  it("reports and checks the requested configured duration for new bookings", async () => {
    const { service, prisma, slots } = setup();
    prisma.eventType.findFirst.mockResolvedValue(
      mockDeep<EventType>({ id: 1, length: 30, metadata: { multipleDuration: [30, 45, 60] } })
    );
    const input = { eventTypeId: 1, ...range, timeZone: "UTC" };
    await expect(service.availability(1, { ...input, duration: 45 })).resolves.toMatchObject({
      duration: 45,
    });
    expect(slots).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ duration: 45 }) })
    );
    slots.mockClear();
    await expect(service.availability(1, { ...input, duration: 40 })).rejects.toThrow("duration");
    expect(slots).not.toHaveBeenCalled();
  });

  it("refuses unavailable reschedule bookings before querying slots", async () => {
    const { service, prisma, slots } = setup();
    prisma.eventType.findFirst.mockResolvedValue(mockDeep<EventType>({ id: 1 }));
    prisma.booking.findFirst.mockResolvedValue(null);
    await expect(
      service.availability(1, {
        eventTypeId: 1,
        ...range,
        timeZone: "UTC",
        rescheduleUid: "other-booking",
      })
    ).rejects.toThrow("mcp_resource_not_found");
    expect(prisma.booking.findFirst).toHaveBeenCalled();
    expect(slots).not.toHaveBeenCalled();
  });

  it("rejects invalid or oversized ranges before querying data", async () => {
    const { service, prisma } = setup();
    await expect(service.bookings(1, { ...range, dateTo: range.dateFrom })).rejects.toThrow();
    await expect(service.bookings(1, { ...range, dateTo: "2027-11-20T00:00:00Z" })).rejects.toThrow();
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("filters profiles and schedules by the active owner", async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.profile(2)).rejects.toThrow();
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2, locked: false } })
    );
    prisma.schedule.findMany.mockResolvedValue([]);
    await service.schedules(2, {});
    expect(prisma.schedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 2 }, take: 101 })
    );
  });

  it("preserves local-clock hours, closed dates and past overrides in schedule reads", () => {
    const at = (time: string) => new Date(`1970-01-01T${time}:00Z`);
    const times = scheduleTimes([
      { days: [1, 2], startTime: at("09:15"), endTime: at("17:15"), date: null },
      { days: [], startTime: at("00:00"), endTime: at("00:00"), date: new Date("2026-11-17T00:00:00Z") },
      { days: [], startTime: at("12:00"), endTime: at("13:00"), date: new Date("2020-01-01T00:00:00Z") },
    ]);
    expect(times.weekly[1]).toEqual([{ start: 555, end: 1035 }]);
    expect(times.weekly[0]).toEqual([]);
    expect(times.overrides).toEqual([
      { date: "2020-01-01", ranges: [{ start: 720, end: 780 }] },
      { date: "2026-11-17", ranges: [] },
    ]);
  });
});
