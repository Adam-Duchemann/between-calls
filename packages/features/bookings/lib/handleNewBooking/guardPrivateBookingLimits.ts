import dayjs from "@calcom/dayjs";
import { detectEventTypeScheduleForUser } from "@calcom/features/availability/lib/detectEventTypeScheduleForUser";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ascendingLimitKeys, intervalLimitKeyToUnit } from "@calcom/lib/intervalLimits/intervalLimit";
import { parseBookingLimit } from "@calcom/lib/intervalLimits/isBookingLimits";
import type { PrismaTransaction } from "@calcom/prisma";

// The caller must hold the owner's row lock until the booking is persisted.
export async function guardPrivateBookingLimits(
  tx: PrismaTransaction,
  input: { userId: number; eventTypeId: number; start: Date; end: Date; excludedUid?: string }
): Promise<void> {
  const { userId, eventTypeId, start, end, excludedUid } = input;
  const event = await tx.eventType.findUniqueOrThrow({
    where: { id: eventTypeId },
    select: {
      bookingLimits: true,
      durationLimits: true,
      timeZone: true,
      schedule: { select: { id: true, timeZone: true } },
    },
  });
  const bookingLimits = parseBookingLimit(event.bookingLimits);
  const durationLimits = parseBookingLimit(event.durationLimits);
  if (!bookingLimits && !durationLimits) return;

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      timeZone: true,
      defaultScheduleId: true,
      schedules: { select: { id: true, timeZone: true } },
    },
  });
  const { schedule } = detectEventTypeScheduleForUser({
    eventType: { ...event, hosts: [] },
    user: { ...user, schedules: user.schedules.map((schedule) => ({ ...schedule, availability: [] })) },
  });
  const localStart = dayjs(start).tz(schedule.timeZone);
  const duration = (end.valueOf() - start.valueOf()) / 60000;

  for (const key of ascendingLimitKeys) {
    const countLimit = bookingLimits?.[key];
    const durationLimit = durationLimits?.[key];
    if (!countLimit && !durationLimit) continue;
    const unit = intervalLimitKeyToUnit(key);
    const periodStart = localStart.startOf(unit).toDate();
    const periodEnd = localStart.endOf(unit).toDate();
    // Native limits count accepted bookings by their start in the host's period.
    const [totals] = await tx.$queryRaw<{ count: number; minutes: number }[]>`
      SELECT COUNT(*)::integer AS count,
        COALESCE(SUM(EXTRACT(EPOCH FROM ("endTime" - "startTime")) / 60), 0)::float8 AS minutes
      FROM "Booking"
      WHERE "userId" = ${userId} AND "eventTypeId" = ${eventTypeId} AND status = 'accepted'
        AND "startTime" >= ${periodStart} AND "startTime" <= ${periodEnd}
        AND (${excludedUid ?? null}::text IS NULL OR uid <> ${excludedUid ?? null})`;
    if (
      (countLimit && totals.count >= countLimit) ||
      (durationLimit && totals.minutes + duration > durationLimit)
    )
      throw new ErrorWithCode(ErrorCode.BookingConflict, ErrorCode.BookingConflict);
  }
}
