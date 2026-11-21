// @vitest-environment node
import type { PrismaClient } from "@calcom/prisma";
import type { Booking, EventType, User } from "@calcom/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { McpAction } from "./actions";
import { BookingChanges } from "./BookingChanges";

const start = "2026-11-18T06:00:00Z";
const action: McpAction = {
  kind: "booking_create",
  eventTypeId: 1,
  start,
  attendee: { name: "Guest", email: "guest@example.test", timeZone: "Indian/Reunion" },
  notes: "Discuss CAL",
};
function setup() {
  const db = mockDeep<PrismaClient>();
  db.user.findFirst.mockResolvedValue(
    mockDeep<User>({
      id: 1,
      email: "owner@example.test",
      timeZone: "Indian/Reunion",
      defaultScheduleId: 1,
      organizationId: null,
    })
  );
  const eventFixture = {
    ...mockDeep<EventType>({
      id: 1,
      title: "Intro",
      length: 30,
      updatedAt: new Date("2026-11-01"),
      scheduleId: 1,
      recurringEvent: null,
      seatsPerTimeSlot: null,
      price: 0,
      bookingFields: null,
      disableGuests: true,
    }),
    customInputs: [],
    metadata: {},
    locations: [{ type: "inPerson", address: "Office" }],
  };
  db.eventType.findFirst.mockResolvedValue(eventFixture);
  const booking = {
    ...mockDeep<Booking>({
      id: 2,
      uid: "old",
      eventTypeId: 1,
      status: "ACCEPTED",
      startTime: new Date("2026-11-17T06:00:00Z"),
      endTime: new Date("2026-11-17T06:30:00Z"),
      updatedAt: new Date("2026-11-01"),
      recurringEventId: null,
      paid: false,
    }),
    attendees: [{ name: "Guest", email: "guest@example.test", timeZone: "Indian/Reunion" }],
    payment: [],
    responses: {
      name: "Guest",
      email: "guest@example.test",
      notes: "Original notes",
      location: { value: "inPerson", optionValue: "" },
    },
  };
  db.booking.findFirst.mockResolvedValue(booking);
  db.schedule.findFirst.mockResolvedValue(null);
  const slots = vi.fn().mockResolvedValue({ slots: { "2026-11-18": [{ time: start }] } });
  const create = vi.fn().mockResolvedValue({
    uid: "new",
    status: "ACCEPTED",
    startTime: new Date(start),
    endTime: new Date("2026-11-18T06:30:00Z"),
  });
  const reschedule = vi.fn().mockImplementation(create);
  const cancel = vi.fn().mockResolvedValue({});
  return {
    db,
    slots,
    create,
    reschedule,
    cancel,
    service: new BookingChanges(db, { slots, create, reschedule, cancel }),
  };
}

describe("MCP booking changes", () => {
  it("allows a normal meeting with a disabled app's nullable price", async () => {
    const { db, service, create } = setup();
    const event = await db.eventType.findFirst();
    if (!event) throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({
      ...event,
      metadata: { apps: { giphy: { enabled: false, price: null, currency: "usd" } } },
      locations: [{ type: "integrations:google:meet", credentialId: 2 }],
    });
    await expect(service.prepare(1, action)).resolves.toMatchObject({ action });
    expect(create).not.toHaveBeenCalled();
  });

  it("continues to reject an enabled paid app", async () => {
    const { db, service, create } = setup();
    const event = await db.eventType.findFirst();
    if (!event) throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({
      ...event,
      metadata: { apps: { stripe: { enabled: true, price: 1000 } } },
    });
    await expect(service.prepare(1, action)).rejects.toThrow("additional requirements");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a missing required answer before offering an approval", async () => {
    const { db, service, create } = setup();
    const event = await db.eventType.findFirst();
    if (!event) throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({
      ...event,
      bookingFields: [{ name: "company", type: "text", label: "Company", required: true }],
    });
    await expect(service.prepare(1, action)).rejects.toThrow("additional requirements");
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects locations requiring guest input before offering an approval", async () => {
    const { db, service } = setup();
    const event = await db.eventType.findFirst();
    if (!event) throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({ ...event, locations: [{ type: "phone" }] });
    await expect(service.prepare(1, action)).rejects.toThrow("additional requirements");
  });
  it("prepares without creating a booking or sending email", async () => {
    const { service, create, slots } = setup();
    const change = await service.prepare(1, action);
    expect(change.summary).toContain("guest@example.test");
    expect(change.summary).toContain("Indian/Reunion");
    expect(create).not.toHaveBeenCalled();
    expect(slots).toHaveBeenCalledWith(expect.objectContaining({ ctx: { bypassSlotsCache: true } }));
  });
  it("refuses someone else's event or booking before provider calls", async () => {
    const { db, service, slots, cancel } = setup();
    db.eventType.findFirst.mockResolvedValue(null);
    await expect(service.prepare(2, action)).rejects.toThrow();
    db.booking.findFirst.mockResolvedValue(null);
    await expect(
      service.prepare(2, { kind: "booking_cancel", bookingUid: "old", reason: "Changed plans" })
    ).rejects.toThrow();
    expect(slots).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 2, uid: "old" }) })
    );
  });
  it("rechecks availability before executing and rejects a no-longer-offered slot", async () => {
    const { service, slots, create } = setup();
    const change = await service.prepare(1, action);
    slots.mockResolvedValue({ slots: {} });
    await expect(service.apply(1, change, "proposal")).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("uses native booking defaults without skip-check or no-email flags", async () => {
    const { service, create } = setup();
    await service.apply(1, await service.prepare(1, action), "proposal");
    const input = create.mock.calls[0][0];
    expect(input.bookingMeta).toEqual({ userId: 1 });
    expect(input.bookingData).toMatchObject({
      eventTypeId: 1,
      start,
      metadata: { calMcpProposalId: "proposal" },
      responses: { name: "Guest", email: "guest@example.test", notes: "Discuss CAL" },
    });
    expect(JSON.stringify(input)).not.toContain("skip");
    expect(JSON.stringify(input)).not.toContain("noEmail");
  });
  it("reschedules through the native service while preserving booking responses", async () => {
    const { service, reschedule } = setup();
    const change = await service.prepare(1, { kind: "booking_reschedule", bookingUid: "old", start });
    await service.apply(1, change, "proposal");
    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingData: expect.objectContaining({
          rescheduleUid: "old",
          rescheduledBy: "owner@example.test",
          responses: expect.objectContaining({ notes: "Original notes" }),
        }),
      })
    );
  });
  it("previews, checks and books the chosen duration instead of the event type default", async () => {
    const { db, service, slots, create } = setup();
    const event = await db.eventType.findFirst();
    if (!event || action.kind !== "booking_create") throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({ ...event, metadata: { multipleDuration: [30, 45, 60] } });
    const change = await service.prepare(1, { ...action, duration: 45 });
    expect(change.summary).toContain("Duration: 45 minutes");
    await service.apply(1, change, "proposal");
    expect(slots.mock.calls.map(([query]) => query.input.duration)).toEqual([45, 45]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ bookingData: expect.objectContaining({ end: "2026-11-18T06:45:00.000Z" }) })
    );
  });

  it("rejects unsupported durations and preserves a longer existing meeting on reschedule", async () => {
    const { db, service, slots, reschedule } = setup();
    const event = await db.eventType.findFirst();
    const booking = await db.booking.findFirst();
    if (!event || !booking || action.kind !== "booking_create") throw new Error("Missing fixture");
    db.eventType.findFirst.mockResolvedValue({ ...event, metadata: { multipleDuration: [30, 45, 60] } });
    db.booking.findFirst.mockResolvedValue({ ...booking, endTime: new Date("2026-11-17T06:45:00Z") });
    await expect(service.prepare(1, { ...action, duration: 40 })).rejects.toThrow("duration");
    expect(slots).not.toHaveBeenCalled();
    const change = await service.prepare(1, { kind: "booking_reschedule", bookingUid: "old", start });
    expect(change.summary).toContain("Duration: 45 minutes");
    await service.apply(1, change, "proposal");
    expect(slots.mock.calls.map(([query]) => query.input.duration)).toEqual([45, 45]);
    expect(reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ bookingData: expect.objectContaining({ end: "2026-11-18T06:45:00.000Z" }) })
    );
  });

  it("cancels only the reviewed booking and preserves the cancellation reason", async () => {
    const { service, cancel } = setup();
    const change = await service.prepare(1, {
      kind: "booking_cancel",
      bookingUid: "old",
      reason: "Changed plans",
    });
    await service.apply(1, change, "proposal");
    expect(cancel).toHaveBeenCalledWith({
      userId: 1,
      bookingData: { uid: "old", cancellationReason: "Changed plans", cancelledBy: "owner@example.test" },
    });
  });
});
