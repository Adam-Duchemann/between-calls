import { describe, expect, it } from "vitest";
import { actionSchema } from "./actions";
import { canonicalHash } from "./integrity";

describe("MCP proposed actions", () => {
  it("rejects model confirmation and owner spoofing instead of silently discarding them", () => {
    const action = { kind: "booking_cancel", bookingUid: "booking-1", reason: "Unavailable" };
    expect(actionSchema.parse(action)).toEqual(action);
    expect(actionSchema.safeParse({ ...action, confirmed: true }).success).toBe(false);
    expect(actionSchema.safeParse({ ...action, userId: 42 }).success).toBe(false);
  });

  it("requires explicit timezone instants and limits personal booking inputs", () => {
    const action = {
      kind: "booking_create",
      eventTypeId: 1,
      start: "2026-11-17T10:30:00Z",
      attendee: { name: "Guest", email: "guest@example.test", timeZone: "Indian/Reunion" },
    };
    expect(actionSchema.safeParse(action).success).toBe(true);
    expect(actionSchema.safeParse({ ...action, start: "2026-11-17T10:30:00" }).success).toBe(false);
    expect(
      actionSchema.safeParse({ ...action, attendee: { ...action.attendee, timeZone: "not/a-zone" } }).success
    ).toBe(false);
    expect(actionSchema.safeParse({ ...action, guests: ["hidden@example.test"] }).success).toBe(false);
  });

  it("validates full weekly ranges and explicit closed date overrides", () => {
    const action = {
      kind: "availability_update",
      scheduleId: 1,
      changes: {
        weekly: [[], [{ start: 540, end: 1020 }], [], [], [], [], []],
        overrides: [{ date: "2026-11-17", ranges: [] }],
      },
    };
    expect(actionSchema.safeParse(action).success).toBe(true);
    expect(actionSchema.safeParse({ ...action, changes: { weekly: [[]] } }).success).toBe(false);
    expect(
      actionSchema.safeParse({ ...action, changes: { overrides: [{ date: "2026-02-30", ranges: [] }] } })
        .success
    ).toBe(false);
    expect(
      actionSchema.safeParse({
        ...action,
        changes: {
          weekly: [
            [],
            [
              { start: 540, end: 720 },
              { start: 600, end: 780 },
            ],
            [],
            [],
            [],
            [],
            [],
          ],
        },
      }).success
    ).toBe(false);
    expect(actionSchema.safeParse({ ...action, changes: {} }).success).toBe(false);
  });

  it("exposes a constrained set of editable event fields", () => {
    expect(
      actionSchema.safeParse({
        kind: "event_type_update",
        eventTypeId: 1,
        changes: { lookBusy: { mode: "week", count: 3 } },
      }).success
    ).toBe(true);
    expect(
      actionSchema.safeParse({ kind: "event_type_update", eventTypeId: 1, changes: { teamId: 7 } }).success
    ).toBe(false);
    expect(
      actionSchema.safeParse({ kind: "event_type_create", title: "Call", slug: "call", length: 0 }).success
    ).toBe(false);
  });

  it("binds every nested value independent of JSON key ordering", () => {
    expect(canonicalHash({ b: 2, a: { y: [1, 2], x: "a" } })).toBe(
      canonicalHash({ a: { x: "a", y: [1, 2] }, b: 2 })
    );
    expect(canonicalHash({ times: [1, 2] })).not.toBe(canonicalHash({ times: [2, 1] }));
  });
});
