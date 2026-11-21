import { describe, expect, it } from "vitest";
import { type HostBooking, type HostExternalEvent, mergeHostCalendar } from "./mergeHostCalendar";

const booking: HostBooking = {
  uid: "booking",
  title: "Call",
  startTime: new Date("2026-11-17T09:00Z"),
  endTime: new Date("2026-11-17T10:00Z"),
  iCalUID: "ical",
  references: [{ uid: "provider-id", credentialId: 1, externalCalendarId: "work" }],
};
const external: HostExternalEvent = {
  id: "provider-id",
  credentialId: 1,
  calendarId: "work",
  iCalUID: "ical",
  title: "Call",
  start: "2026-11-17T09:00Z",
  end: "2026-11-17T10:00Z",
  allDay: false,
  isFree: false,
};

describe("host calendar aggregation", () => {
  it("deduplicates booking references and copies across Google accounts", () => {
    const other = { ...external, id: "copied", credentialId: 2, calendarId: "personal" };
    expect(mergeHostCalendar([booking], [external, other])).toHaveLength(1);
    expect(mergeHostCalendar([], [external, other])).toHaveLength(1);
  });
  it("merges the same shared calendar event across connections without an iCalendar UID", () => {
    const first = { ...external, iCalUID: null };
    const second = { ...first, credentialId: 2 };
    const merged = mergeHostCalendar([], [second, first]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceIds).toHaveLength(2);

    const rememberedBooking = { ...booking, iCalUID: null };
    const viaSharedCalendar = mergeHostCalendar([rememberedBooking], [second]);
    expect(viaSharedCalendar).toHaveLength(1);
    expect(viaSharedCalendar[0]).toMatchObject({ kind: "booking", bookingUid: booking.uid });
  });

  it("keeps account-local primary aliases and same-event occurrences distinct", () => {
    const first = { ...external, iCalUID: null, calendarId: "primary" };
    expect(mergeHostCalendar([], [first, { ...first, credentialId: 2 }])).toHaveLength(2);
    expect(
      mergeHostCalendar(
        [],
        [
          external,
          {
            ...external,
            start: "2026-11-18T09:00Z",
            end: "2026-11-18T10:00Z",
          },
        ]
      )
    ).toHaveLength(2);
  });
  it("keeps overlapping unrelated events and distinct recurring instances", () => {
    const unrelated = { ...external, id: "unrelated", iCalUID: "different" };
    const nextInstance = {
      ...external,
      id: "recurring",
      start: "2026-11-18T09:00Z",
      end: "2026-11-18T10:00Z",
    };
    expect(mergeHostCalendar([booking], [unrelated, nextInstance])).toHaveLength(3);
  });
  it("preserves all-day/free flags and absent private titles without guessing details", () => {
    const events = mergeHostCalendar([], [{ ...external, title: null, allDay: true, isFree: true }]);
    expect(events[0]).toMatchObject({ title: null, allDay: true, isFree: true, kind: "external" });
  });
  it("does not merge equal titles and times without a provider identity match", () => {
    expect(mergeHostCalendar([booking], [{ ...external, id: "independent", iCalUID: null }])).toHaveLength(2);
  });
});
