import type { ExternalCalendarEvent } from "@calcom/types/Calendar";

export type HostBooking = {
  uid: string;
  title: string;
  startTime: Date;
  endTime: Date;
  iCalUID: string | null;
  references: { uid: string; credentialId: number | null; externalCalendarId: string | null }[];
};
export type HostExternalEvent = ExternalCalendarEvent & { credentialId: number };
export type HostCalendarEntry = {
  key: string;
  kind: "booking" | "external";
  bookingUid?: string;
  title: string | null;
  start: string;
  end: string;
  allDay: boolean;
  isFree: boolean;
  sourceIds: string[];
};
export const calendarSourceId = (credentialId: number, calendarId: string) =>
  JSON.stringify([credentialId, calendarId]);
const instanceKey = (uid: string, start: string, end: string) =>
  JSON.stringify([uid, new Date(start).valueOf(), new Date(end).valueOf()]);

export function mergeHostCalendar(
  bookings: HostBooking[],
  external: HostExternalEvent[]
): HostCalendarEntry[] {
  const result: HostCalendarEntry[] = bookings.map((booking) => ({
    key: `booking:${booking.uid}`,
    kind: "booking",
    bookingUid: booking.uid,
    title: booking.title,
    start: booking.startTime.toISOString(),
    end: booking.endTime.toISOString(),
    allDay: false,
    isFree: false,
    sourceIds: ["bookings"],
  }));
  const identities = new Map<string, HostCalendarEntry>();
  for (let index = 0; index < bookings.length; index++) {
    const booking = bookings[index];
    if (booking.iCalUID)
      identities.set(instanceKey(booking.iCalUID, result[index].start, result[index].end), result[index]);
  }
  for (const event of external) {
    const sourceId = calendarSourceId(event.credentialId, event.calendarId);
    const hasCanonicalCalendarId = event.calendarId !== "primary";
    const identity = event.iCalUID
      ? instanceKey(event.iCalUID, event.start, event.end)
      : JSON.stringify([
          hasCanonicalCalendarId ? event.calendarId : sourceId,
          event.id,
          Date.parse(event.start),
          Date.parse(event.end),
        ]);
    const reference = bookings.findIndex((booking) =>
      booking.references.some(
        (ref) =>
          ref.uid === event.id &&
          ((hasCanonicalCalendarId && ref.externalCalendarId === event.calendarId) ||
            (ref.credentialId === event.credentialId &&
              (!ref.externalCalendarId || ref.externalCalendarId === event.calendarId)))
      )
    );
    const duplicate = reference >= 0 ? result[reference] : identities.get(identity);
    if (duplicate) {
      identities.set(identity, duplicate);
      if (!duplicate.sourceIds.includes(sourceId)) duplicate.sourceIds.push(sourceId);
      continue;
    }
    const entry: HostCalendarEntry = {
      key: `external:${identity}`,
      kind: "external",
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      isFree: event.isFree,
      sourceIds: [sourceId],
    };
    identities.set(identity, entry);
    result.push(entry);
  }
  return result.sort((a, b) => new Date(a.start).valueOf() - new Date(b.start).valueOf());
}
