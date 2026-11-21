import process from "node:process";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { guardPrivateBooking } from "./handleNewBooking/guardPrivateBooking";

export async function claimPrivateConfirmation(
  prisma: PrismaClient,
  input: { bookingId: number; userId: number | null; recurringEventId?: string }
): Promise<void> {
  if (process.env.CAL_PRIVATE_INSTANCE !== "true") return;
  const { bookingId, userId } = input;
  if (!userId || input.recurringEventId) throw new ErrorWithCode(ErrorCode.Forbidden, ErrorCode.Forbidden);

  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} AND "userId" = ${userId} FOR UPDATE`;
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, userId, status: "PENDING" },
        select: {
          uid: true,
          eventTypeId: true,
          startTime: true,
          endTime: true,
          recurringEventId: true,
          payment: { select: { id: true } },
        },
      });
      if (!booking) throw new ErrorWithCode(ErrorCode.BookingConflict, ErrorCode.BookingConflict);
      if (booking.recurringEventId || booking.payment.length)
        throw new ErrorWithCode(ErrorCode.Forbidden, ErrorCode.Forbidden);
      await guardPrivateBooking(tx, {
        userId,
        eventTypeId: booking.eventTypeId ?? undefined,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: "ACCEPTED",
        confirmingUid: booking.uid,
      });
      // Claim before network effects so simultaneous confirmations cannot send duplicates.
      await tx.booking.update({
        where: { id: bookingId, status: "PENDING" },
        data: { status: "ACCEPTED" },
        select: { id: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}
