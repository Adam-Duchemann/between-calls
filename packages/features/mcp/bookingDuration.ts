import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { z } from "zod";

export const durationSchema = z.number().int().min(5).max(1440);

type EventDuration = { length: number; metadata: unknown };
type BookingTimes = { startTime: Date; endTime: Date };
const metadataSchema = z.object({ multipleDuration: z.array(durationSchema).optional() });

export function durationOptions(event: EventDuration) {
  const metadata = metadataSchema.safeParse(event.metadata);
  const options = metadata.success ? metadata.data.multipleDuration : undefined;
  return options?.length ? options : [event.length];
}

export function existingBookingDuration(booking: BookingTimes) {
  return (booking.endTime.valueOf() - booking.startTime.valueOf()) / 60_000;
}

export function offeredDuration(event: EventDuration, requested?: number, booking?: BookingTimes) {
  const duration = booking ? existingBookingDuration(booking) : (requested ?? event.length);
  if ((requested !== undefined && requested !== duration) || !durationOptions(event).includes(duration)) {
    throw new ErrorWithCode(ErrorCode.BadRequest, "Choose an available duration for this meeting type.");
  }
  return duration;
}
