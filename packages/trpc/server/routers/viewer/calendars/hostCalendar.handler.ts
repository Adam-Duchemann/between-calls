import { createGoogleCalendarServiceWithGoogleType } from "@calcom/app-store/googlecalendar/lib/CalendarService";
import { calendarSourceId, type HostExternalEvent } from "@calcom/features/calendars/lib/mergeHostCalendar";
import { prisma } from "@calcom/prisma";
import { credentialForCalendarServiceSelect } from "@calcom/prisma/selects/credential";
import { TRPCError } from "@trpc/server";
import type { HostCalendarInput } from "./hostCalendar.schema";

export async function hostCalendarHandler({
  ctx,
  input,
}: {
  ctx: { user: { id: number } };
  input: HostCalendarInput;
}) {
  const userId = ctx.user.id;
  const [selected, credentials, bookings] = await Promise.all([
    prisma.selectedCalendar.findMany({
      where: { userId, integration: "google_calendar" },
      select: { credentialId: true, externalId: true },
    }),
    prisma.credential.findMany({
      where: { userId, type: "google_calendar" },
      select: credentialForCalendarServiceSelect,
    }),
    prisma.booking.findMany({
      where: {
        userId,
        status: { in: ["ACCEPTED", "PENDING"] },
        startTime: { lt: new Date(input.dateTo) },
        endTime: { gt: new Date(input.dateFrom) },
      },
      select: {
        uid: true,
        title: true,
        startTime: true,
        endTime: true,
        iCalUID: true,
        references: {
          where: { type: "google_calendar", OR: [{ deleted: false }, { deleted: null }] },
          select: { uid: true, credentialId: true, externalCalendarId: true },
        },
      },
    }),
  ]);
  const calendars =
    input.calendars ??
    selected.filter(
      (calendar): calendar is { credentialId: number; externalId: string } => calendar.credentialId !== null
    );
  if (calendars.length > 32)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select up to 32 calendars." });
  if (
    calendars.some((calendar) => !credentials.some((credential) => credential.id === calendar.credentialId))
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "These calendar connections do not belong to you." });
  }
  const unique = Array.from(
    new Map(
      calendars.map((calendar) => [calendarSourceId(calendar.credentialId, calendar.externalId), calendar])
    ).values()
  );
  const sources = await Promise.all(
    unique.map(async ({ credentialId, externalId }) => {
      const credential = credentials.find((candidate) => candidate.id === credentialId);
      const base = { id: calendarSourceId(credentialId, externalId), credentialId, externalId };
      if (!credential || credential.invalid)
        return { ...base, status: "reconnect" as const, events: [] as HostExternalEvent[] };
      try {
        const service = createGoogleCalendarServiceWithGoogleType({ ...credential, delegatedTo: null });
        const events = await service.getCalendarEvents({
          calendarId: externalId,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        });
        return {
          ...base,
          status: "ok" as const,
          events: events.map((event) => ({ ...event, credentialId })),
        };
      } catch (error: unknown) {
        const reconnect =
          typeof error === "object" && error !== null && "code" in error && error.code === 401;
        return {
          ...base,
          status: reconnect ? ("reconnect" as const) : ("error" as const),
          events: [] as HostExternalEvent[],
        };
      }
    })
  );
  return {
    bookings,
    sources: sources.map(({ events: _events, ...source }) => source),
    externalEvents: sources.flatMap((source) => source.events),
  };
}
