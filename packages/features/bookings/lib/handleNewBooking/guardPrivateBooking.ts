import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaTransaction } from "@calcom/prisma";
import type { BookingStatus } from "@calcom/prisma/enums";
import { guardPrivateBookingLimits } from "./guardPrivateBookingLimits";

type PrivateBookingInput = {
  userId: number;
  eventTypeId?: number;
  startTime: Date | string;
  endTime: Date | string;
  status?: BookingStatus;
  rescheduleUid?: string;
  confirmingUid?: string;
};

export async function guardPrivateBooking(tx: PrismaTransaction, input: PrivateBookingInput): Promise<void> {
  if (process.env.CAL_PRIVATE_INSTANCE !== "true") return;
  const { userId, eventTypeId, rescheduleUid } = input;
  const excludedUid = rescheduleUid ?? input.confirmingUid;
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  if (!eventTypeId || !Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start >= end)
    throw new ErrorWithCode(ErrorCode.BadRequest, ErrorCode.BadRequest);

  // Availability can be stale by the time two requests reach persistence.
  // Keep this lock and the fresh conflict check in the transaction that saves the booking.
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const event = await tx.eventType.findUnique({
    where: { id: eventTypeId },
    select: {
      userId: true,
      users: { select: { id: true } },
      teamId: true,
      schedulingType: true,
      seatsPerTimeSlot: true,
      beforeEventBuffer: true,
      afterEventBuffer: true,
      requiresConfirmationWillBlockSlot: true,
    },
  });
  if (
    !event ||
    (event.userId !== userId && !event.users.some((user) => user.id === userId)) ||
    event.teamId ||
    event.schedulingType ||
    event.seatsPerTimeSlot
  )
    throw new ErrorWithCode(ErrorCode.Forbidden, ErrorCode.Forbidden);

  if (rescheduleUid) {
    const originals = await tx.$queryRaw<{ status: string; rescheduled: boolean | null }[]>`
      SELECT status::text, rescheduled FROM "Booking"
      WHERE uid = ${rescheduleUid} AND "userId" = ${userId} FOR UPDATE`;
    const original = originals[0];
    const replacement = await tx.booking.findFirst({
      where: { fromReschedule: rescheduleUid },
      select: { id: true },
    });
    if (!original || (original.status === "cancelled" && !original.rescheduled) || replacement)
      throw new ErrorWithCode(ErrorCode.BookingConflict, ErrorCode.BookingConflict);
  }

  if (input.status === "PENDING" && !event.requiresConfirmationWillBlockSlot) return;
  const conflicts = await tx.$queryRaw<{ id: number }[]>`
    SELECT b.id FROM "Booking" b
    LEFT JOIN "EventType" e ON e.id = b."eventTypeId"
    WHERE b."userId" = ${userId}
      AND (${excludedUid ?? null}::text IS NULL OR b.uid <> ${excludedUid ?? null})
      AND (b.status = 'accepted' OR
        (b.status = 'pending' AND b."eventTypeId" = ${eventTypeId} AND e."requiresConfirmationWillBlockSlot"))
      AND b."startTime" - (COALESCE(e."beforeEventBuffer", 0) + ${event.afterEventBuffer}) * INTERVAL '1 minute' < ${end}
      AND b."endTime" + (COALESCE(e."afterEventBuffer", 0) + ${event.beforeEventBuffer}) * INTERVAL '1 minute' > ${start}
    LIMIT 1`;
  if (conflicts.length) throw new ErrorWithCode(ErrorCode.BookingConflict, ErrorCode.BookingConflict);
  await guardPrivateBookingLimits(tx, { userId, eventTypeId, start, end, excludedUid });
}
