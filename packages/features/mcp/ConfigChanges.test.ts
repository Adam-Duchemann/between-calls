import type { PrismaClient } from "@calcom/prisma";
import type { EventType, Schedule, User } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { ConfigChanges } from "./ConfigChanges";

function setup() {
  const db = mockDeep<PrismaClient>();
  db.user.findFirst.mockResolvedValue(
    mockDeep<User>({ id: 1, organizationId: null, timeZone: "Indian/Reunion", defaultScheduleId: 1 })
  );
  db.eventType.findFirst.mockResolvedValue(null);
  const schedule = {
    ...mockDeep<Schedule>({ id: 1, userId: 1, name: "Week", timeZone: "Indian/Reunion" }),
    availability: [
      {
        days: [1],
        startTime: new Date("1970-01-01T09:00:00Z"),
        endTime: new Date("1970-01-01T17:00:00Z"),
        date: null,
      },
      {
        days: [],
        startTime: new Date("1970-01-01T00:00:00Z"),
        endTime: new Date("1970-01-01T00:00:00Z"),
        date: new Date("2026-11-17T00:00:00Z"),
      },
    ],
  };
  db.schedule.findFirst.mockResolvedValue(schedule);
  return { db, service: new ConfigChanges(db) };
}

describe("MCP configuration changes", () => {
  it("requires an owner match before preparing a change", async () => {
    const { db, service } = setup();
    await expect(
      service.prepare(2, { kind: "event_type_update", eventTypeId: 1, changes: { title: "Private" } })
    ).rejects.toThrow();
    expect(db.eventType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1, userId: 2, teamId: null, parentId: null } })
    );
    expect(db.eventType.updateMany).not.toHaveBeenCalled();
  });

  it("creates personal event types with the agreed defaults", async () => {
    const { db, service } = setup();
    const change = await service.prepare(1, {
      kind: "event_type_create",
      title: "Intro",
      slug: "intro",
      length: 30,
    });
    db.eventType.create.mockResolvedValue(mockDeep<EventType>({ id: 10, slug: "intro" }));
    await service.apply(1, change);
    expect(db.eventType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          owner: { connect: { id: 1 } },
          users: { connect: { id: 1 } },
          schedule: { connect: { id: 1 } },
          afterEventBuffer: 15,
          minimumBookingNotice: 240,
          periodDays: 30,
          bookingLimits: { PER_DAY: 4 },
          locations: [{ type: "integrations:google:meet" }],
          requiresConfirmation: false,
        }),
      })
    );
    expect(change.summary).toContain("Google Meet");
  });

  it("renames a schedule without wiping weekly hours or a closed-date override", async () => {
    const { db, service } = setup();
    const change = await service.prepare(1, {
      kind: "availability_update",
      scheduleId: 1,
      changes: { name: "Work" },
    });
    db.schedule.update.mockResolvedValue(mockDeep<Schedule>({ id: 1 }));
    await service.apply(1, change);
    const data = db.schedule.update.mock.calls[0][0].data;
    expect(data.name).toBe("Work");
    expect(data.availability).toMatchObject({
      create: [
        { days: [1], startTime: new Date("1970-01-01T09:00:00Z"), endTime: new Date("1970-01-01T17:00:00Z") },
        {
          days: [],
          date: new Date("2026-11-17T00:00:00Z"),
          startTime: new Date("1970-01-01T00:00:00Z"),
          endTime: new Date("1970-01-01T00:00:00Z"),
        },
      ],
    });
  });

  it("rejects a stale schedule instead of replacing newer changes", async () => {
    const { db, service } = setup();
    const change = await service.prepare(1, {
      kind: "availability_update",
      scheduleId: 1,
      changes: { name: "Work" },
    });
    const changed = {
      ...mockDeep<Schedule>({ id: 1, userId: 1, name: "Changed", timeZone: "UTC" }),
      availability: [],
    };
    db.schedule.findFirst.mockResolvedValue(changed);
    await expect(service.apply(1, change)).rejects.toThrow();
    expect(db.schedule.update).not.toHaveBeenCalled();
  });

  it("changes look-busy policy without losing unrelated metadata", async () => {
    const { db, service } = setup();
    db.eventType.findFirst.mockResolvedValue({
      ...mockDeep<EventType>({ id: 1, title: "Intro", updatedAt: new Date("2026-11-01") }),
      metadata: { unrelated: { enabled: true } },
    });
    db.eventType.updateMany.mockResolvedValue({ count: 1 });
    const change = await service.prepare(1, {
      kind: "event_type_update",
      eventTypeId: 1,
      changes: { lookBusy: { mode: "week", count: 3 } },
    });
    await service.apply(1, change);
    expect(db.eventType.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, userId: 1, teamId: null, parentId: null }),
        data: { metadata: { unrelated: { enabled: true }, lookBusy: { mode: "week", count: 3 } } },
      })
    );
  });

  it("refuses organization-managed accounts in the personal v1 mutation path", async () => {
    const { db, service } = setup();
    db.user.findFirst.mockResolvedValue(mockDeep<User>({ id: 1, organizationId: 5 }));
    await expect(
      service.prepare(1, { kind: "event_type_create", title: "Intro", slug: "intro", length: 30 })
    ).rejects.toThrow();
    expect(db.eventType.create).not.toHaveBeenCalled();
  });
});
