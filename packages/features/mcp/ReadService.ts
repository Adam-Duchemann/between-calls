import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { lookBusySchema } from "@calcom/prisma/lookBusySchema";
import type { GetScheduleOptions } from "@calcom/trpc/server/routers/viewer/slots/types";
import { z } from "zod";
import { durationOptions, durationSchema, offeredDuration } from "./bookingDuration";
import { scheduleTimes } from "./scheduleTimes";

export const pageSchema = z.object({ afterId: z.number().int().positive().optional() }).strict();
export const dateRangeSchema = z.object({
  dateFrom: z.string().datetime({ offset: true }),
  dateTo: z.string().datetime({ offset: true }),
});
export const bookingReadSchema = dateRangeSchema.extend(pageSchema.shape).strict();
export const availabilityReadSchema = dateRangeSchema
  .extend({
    eventTypeId: z.number().int().positive(),
    duration: durationSchema.optional(),
    rescheduleUid: z.string().min(1).max(128).optional(),
    timeZone: timeZoneSchema,
  })
  .strict();
export const hoursSelect = { days: true, startTime: true, endTime: true, date: true } as const;
const notFound = () => new ErrorWithCode(ErrorCode.NotFound, "mcp_resource_not_found");
const cursor = (afterId?: number) => (afterId ? { id: { gt: afterId } } : {});
const page = <T extends { id: number }>(rows: T[]) => ({
  items: rows.slice(0, 100),
  nextCursor: rows.length > 100 ? rows[99].id : null,
});
function checkRange(input: z.infer<typeof dateRangeSchema>) {
  const milliseconds = Date.parse(input.dateTo) - Date.parse(input.dateFrom);
  if (milliseconds <= 0 || milliseconds > 35 * 86400000) {
    throw new ErrorWithCode(ErrorCode.BadRequest, "Request a positive date range of at most 35 days.");
  }
}
type GetSlots = (options: GetScheduleOptions) => Promise<{ slots: Record<string, { time: string }[]> }>;
const defaultSlots: GetSlots = async (options) => {
  const { getAvailableSlotsService } = await import("@calcom/features/di/containers/AvailableSlots");
  return getAvailableSlotsService().getAvailableSlots(options);
};

export class ReadService {
  constructor(
    private readonly prisma: Pick<PrismaClient, "user" | "eventType" | "booking" | "schedule">,
    private readonly getSlots: GetSlots = defaultSlots
  ) {}

  async profile(userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, locked: false },
      select: { id: true, name: true, email: true, username: true, timeZone: true, defaultScheduleId: true },
    });
    if (!user) throw notFound();
    return { ...user, currentTime: new Date().toISOString() };
  }

  async eventTypes(userId: number, input: unknown) {
    const { afterId } = pageSchema.parse(input);
    const rows = await this.prisma.eventType.findMany({
      where: { userId, teamId: null, ...cursor(afterId) },
      orderBy: { id: "asc" },
      take: 101,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        length: true,
        hidden: true,
        scheduleId: true,
        minimumBookingNotice: true,
        beforeEventBuffer: true,
        afterEventBuffer: true,
        metadata: true,
      },
    });
    return page(
      rows.map(({ metadata, ...event }) => {
        const policy = z.object({ lookBusy: lookBusySchema.optional() }).safeParse(metadata);
        return {
          ...event,
          durationOptions: durationOptions({ ...event, metadata }),
          lookBusy: policy.success
            ? (policy.data.lookBusy ?? { mode: "off" as const })
            : { mode: "off" as const },
        };
      })
    );
  }

  async bookings(userId: number, input: unknown) {
    const parsed = bookingReadSchema.parse(input);
    checkRange(parsed);
    return page(
      await this.prisma.booking.findMany({
        where: {
          userId,
          ...cursor(parsed.afterId),
          startTime: { lt: new Date(parsed.dateTo) },
          endTime: { gt: new Date(parsed.dateFrom) },
        },
        orderBy: { id: "asc" },
        take: 101,
        select: {
          id: true,
          uid: true,
          title: true,
          eventTypeId: true,
          startTime: true,
          endTime: true,
          status: true,
          rescheduled: true,
          attendees: { select: { name: true, email: true, timeZone: true } },
        },
      })
    );
  }

  async schedules(userId: number, input: unknown) {
    const { afterId } = pageSchema.parse(input);
    const rows = await this.prisma.schedule.findMany({
      where: { userId, ...cursor(afterId) },
      orderBy: { id: "asc" },
      take: 101,
      select: { id: true, name: true, timeZone: true, availability: { select: hoursSelect } },
    });
    return page(
      rows.map(({ availability, ...schedule }) => ({ ...schedule, ...scheduleTimes(availability) }))
    );
  }

  async availability(userId: number, input: unknown) {
    const parsed = availabilityReadSchema.parse(input);
    checkRange(parsed);
    const event = await this.prisma.eventType.findFirst({
      where: { id: parsed.eventTypeId, userId, teamId: null },
      select: { id: true, length: true, metadata: true },
    });
    if (!event) throw notFound();
    let booking: { startTime: Date; endTime: Date } | undefined;
    if (parsed.rescheduleUid) {
      const original = await this.prisma.booking.findFirst({
        where: {
          uid: parsed.rescheduleUid,
          userId,
          eventTypeId: parsed.eventTypeId,
          status: { in: ["ACCEPTED", "PENDING"] },
        },
        select: { startTime: true, endTime: true },
      });
      if (!original) throw notFound();
      booking = original;
    }
    const duration = offeredDuration(event, parsed.duration, booking);
    const result = await this.getSlots({
      ctx: { bypassSlotsCache: true },
      input: {
        eventTypeId: parsed.eventTypeId,
        startTime: parsed.dateFrom,
        endTime: parsed.dateTo,
        timeZone: parsed.timeZone,
        isTeamEvent: false,
        duration,
        ...(parsed.rescheduleUid ? { rescheduleUid: parsed.rescheduleUid } : {}),
      },
    });
    return {
      eventTypeId: parsed.eventTypeId,
      timeZone: parsed.timeZone,
      duration,
      slots: Object.fromEntries(
        Object.entries(result.slots).map(([day, slots]) => [day, slots.map(({ time }) => time)])
      ),
    };
  }
}
