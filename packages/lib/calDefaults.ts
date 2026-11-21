import type { Prisma } from "@calcom/prisma/client";

export const CAL_DEFAULT_TIME_ZONE = "UTC";

export function getCalEventDefaults() {
  return {
    length: 30,
    locations: [{ type: "integrations:google:meet" }],
    minimumBookingNotice: 240,
    beforeEventBuffer: 0,
    afterEventBuffer: 15,
    periodType: "ROLLING",
    periodDays: 30,
    periodCountCalendarDays: true,
    bookingLimits: { PER_DAY: 4 },
    requiresConfirmation: false,
    disableGuests: true,
    metadata: { lookBusy: { mode: "off" } },
  } satisfies Partial<Prisma.EventTypeCreateInput>;
}
