import type { IGetAvailableSlots } from "@calcom/features/bookings/Booker/hooks/useAvailableTimeSlots";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { LookBusyPolicy } from "@calcom/prisma/lookBusySchema";

export async function ensureOfferedTime({
  policy,
  ownerId,
  viewerId,
  start,
  getSlots,
}: {
  policy?: LookBusyPolicy;
  ownerId: number | null;
  viewerId?: number;
  start: string;
  getSlots: () => Promise<IGetAvailableSlots>;
}): Promise<void> {
  if (!policy || policy.mode === "off" || (viewerId !== undefined && viewerId === ownerId)) return;
  const result = await getSlots();
  const isOffered = Object.values(result.slots)
    .flat()
    .some((slot) => Date.parse(slot.time) === Date.parse(start));
  if (!isOffered)
    throw new ErrorWithCode(
      ErrorCode.BookingConflict,
      "This time is no longer offered. Choose another available time."
    );
}
