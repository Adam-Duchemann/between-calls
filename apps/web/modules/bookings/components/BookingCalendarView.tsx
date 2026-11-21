"use client";

import type dayjs from "@calcom/dayjs";
import { useTimePreferences } from "@calcom/features/bookings/lib";
import { HostCalendarAgenda } from "@calcom/features/calendars/components/HostCalendarAgenda";
import { HostCalendarLayers } from "@calcom/features/calendars/components/HostCalendarLayers";
import { hostCalendarRange } from "@calcom/features/calendars/lib/hostCalendarRange";
import { calendarSourceId, mergeHostCalendar } from "@calcom/features/calendars/lib/mergeHostCalendar";
import type { CalendarEvent } from "@calcom/features/calendars/weeklyview/types/events";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useGetTheme } from "@calcom/lib/hooks/useTheme";
import { trpc } from "@calcom/trpc/react";
import useMeQuery from "@calcom/trpc/react/hooks/useMeQuery";
import { Calendar } from "@calcom/web/modules/calendars/weeklyview/components/Calendar";
import { useBanners } from "@calcom/web/modules/shell/banners/useBanners";
import { useEffect, useMemo, useState } from "react";
import { useBookingDetailsSheetStore } from "../store/bookingDetailsSheetStore";
import type { BookingOutput } from "../types";

type BookingCalendarViewProps = {
  bookings: BookingOutput[];
  currentWeekStart: dayjs.Dayjs;
  onWeekStartChange: (weekStart: dayjs.Dayjs) => void;
};

export function BookingCalendarView({
  bookings,
  currentWeekStart,
  onWeekStartChange,
}: BookingCalendarViewProps) {
  const setSelectedBookingUid = useBookingDetailsSheetStore((state) => state.setSelectedBookingUid);
  const selectedBookingUid = useBookingDetailsSheetStore((state) => state.selectedBookingUid);
  const { timezone: fallbackTimezone } = useTimePreferences();
  const timezone = useMeQuery().data?.timeZone ?? fallbackTimezone;
  const { t } = useLocale();
  const [hidden, setHidden] = useState<string[]>([]);
  const range = hostCalendarRange(currentWeekStart.format("YYYY-MM-DD"), timezone);
  const hostCalendar = trpc.viewer.calendars.hostCalendar.useQuery(range);
  const { resolvedTheme, forcedTheme } = useGetTheme();
  const { bannersHeight } = useBanners();

  const startDate = useMemo(() => currentWeekStart.toDate(), [currentWeekStart]);
  const endDate = useMemo(() => currentWeekStart.add(6, "day").toDate(), [currentWeekStart]);

  // Intentionally only runs on mount to trigger the initial currentWeekStart
  useEffect(() => {
    onWeekStartChange(currentWeekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries = useMemo(() => {
    const ownBookings = new Map(hostCalendar.data?.bookings.map((booking) => [booking.uid, booking]));
    const displayedBookings = hidden.includes("bookings")
      ? []
      : bookings
          .filter(
            (booking) =>
              new Date(booking.startTime) < new Date(range.dateTo) &&
              new Date(booking.endTime) > new Date(range.dateFrom)
          )
          .map((booking) => ({
            uid: booking.uid,
            title: booking.title,
            startTime: new Date(booking.startTime),
            endTime: new Date(booking.endTime),
            iCalUID: ownBookings.get(booking.uid)?.iCalUID ?? null,
            references: ownBookings.get(booking.uid)?.references ?? [],
          }));
    const external = (hostCalendar.data?.externalEvents ?? []).filter(
      (event) => !hidden.includes(calendarSourceId(event.credentialId, event.calendarId))
    );
    return mergeHostCalendar(displayedBookings, external);
  }, [bookings, hidden, hostCalendar.data, range.dateFrom, range.dateTo]);

  const events = useMemo<CalendarEvent[]>(
    () =>
      entries.map((entry, index) => {
        const booking = bookings.find((item) => item.uid === entry.bookingUid);
        const hasDarkTheme = !forcedTheme && resolvedTheme === "dark";
        const color =
          booking?.eventType?.eventTypeColor?.[hasDarkTheme ? "darkEventTypeColor" : "lightEventTypeColor"];
        return {
          id: index,
          title: entry.title || t("host_calendar_private_event"),
          start: new Date(entry.start),
          end: new Date(entry.end),
          source: entry.kind,
          description: entry.isFree ? t("host_calendar_free") : undefined,
          options: {
            allDay: entry.allDay,
            status: booking?.status,
            bookingUid: entry.bookingUid,
            color: color || (entry.kind === "external" ? "#64748b" : undefined),
          },
        };
      }),
    [entries, bookings, resolvedTheme, forcedTheme, t]
  );

  return (
    <>
      <HostCalendarLayers
        sources={hostCalendar.data?.sources ?? []}
        hidden={hidden}
        onToggle={(id) =>
          setHidden((values) =>
            values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
          )
        }
        onRetry={() => {
          void hostCalendar.refetch();
        }}
        loading={hostCalendar.isFetching}
        error={hostCalendar.isError}
      />
      {entries.some((entry) => entry.allDay) && (
        <HostCalendarAgenda entries={entries.filter((entry) => entry.allDay)} timeZone={timezone} />
      )}
      <div
        className="border-subtle flex flex-1 flex-col overflow-y-auto overflow-x-hidden rounded-2xl border"
        style={{ height: `calc(100vh - 6rem - ${bannersHeight}px)` }}>
        <Calendar
          timezone={timezone}
          sortEvents
          startHour={0}
          endHour={23}
          events={events}
          startDate={startDate}
          endDate={endDate}
          gridCellsPerHour={4}
          hoverEventDuration={0}
          showBackgroundPattern={false}
          showBorder={false}
          borderColor="subtle"
          selectedBookingUid={selectedBookingUid}
          onEventClick={(event) => {
            const bookingUid = event.options?.bookingUid;
            if (bookingUid) {
              setSelectedBookingUid(bookingUid);
            }
          }}
          showTimezone
          hideHeader
          updateCurrentTimeOnFocus
        />
      </div>
    </>
  );
}
