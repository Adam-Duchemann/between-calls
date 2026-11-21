import type { CreateBookingMeta, CreateRegularBookingData } from "@calcom/features/bookings/lib/dto/types";
import type { CancelBookingInput } from "@calcom/features/bookings/lib/handleCancelBooking";
import type { GetScheduleOptions } from "@calcom/trpc/server/routers/viewer/slots/types";

export type BookingInput = {
  bookingData: CreateRegularBookingData & { responses: Record<string, unknown> };
  bookingMeta: CreateBookingMeta;
};
export type BookingOperations = {
  slots: (input: GetScheduleOptions) => Promise<{ slots: Record<string, { time: string }[]> }>;
  create: (input: BookingInput) => Promise<unknown>;
  reschedule: (input: BookingInput) => Promise<unknown>;
  cancel: (input: CancelBookingInput) => Promise<unknown>;
};

export const nativeBookingOperations: BookingOperations = {
  slots: async (input) => {
    const { getAvailableSlotsService } = await import("@calcom/features/di/containers/AvailableSlots");
    return getAvailableSlotsService().getAvailableSlots(input);
  },
  create: async (input) => {
    const { getRegularBookingService } = await import(
      "@calcom/features/bookings/di/RegularBookingService.container"
    );
    return getRegularBookingService().createBooking(input);
  },
  reschedule: async (input) => {
    const { getRegularBookingService } = await import(
      "@calcom/features/bookings/di/RegularBookingService.container"
    );
    return getRegularBookingService().rescheduleBooking(input);
  },
  cancel: async (input) => {
    const { default: cancel } = await import("@calcom/features/bookings/lib/handleCancelBooking");
    return cancel(input);
  },
};
