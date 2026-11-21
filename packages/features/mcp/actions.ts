import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";
import { lookBusySchema } from "@calcom/prisma/lookBusySchema";
import { z } from "zod";
import { durationSchema } from "./bookingDuration";

const id = z.number().int().positive();
const instant = z.string().datetime({ offset: true });
const uid = z.string().min(1).max(100);
const title = z.string().trim().min(1).max(200);
const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const length = durationSchema;
const description = z.string().max(4000);
const buffer = z.number().int().min(0).max(1440);
const nonempty = (value: object) => Object.keys(value).length > 0;
const ranges = z
  .array(
    z
      .object({
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
      })
      .strict()
  )
  .max(48)
  .refine((values) => {
    const ordered = [...values].sort((a, b) => a.start - b.start);
    return ordered.every(
      (range, index) => range.start < range.end && (index === 0 || ordered[index - 1].end <= range.start)
    );
  }, "Ranges must have positive duration and must not overlap.");
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => {
    const value = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === date;
  }, "Invalid calendar date.");

export const actionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("booking_create"),
      eventTypeId: id,
      start: instant,
      duration: durationSchema.optional(),
      attendee: z
        .object({ name: title, email: z.string().email().max(254), timeZone: timeZoneSchema })
        .strict(),
      notes: description.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("booking_reschedule"), bookingUid: uid, start: instant }).strict(),
  z.object({ kind: z.literal("booking_cancel"), bookingUid: uid, reason: z.string().max(1000) }).strict(),
  z
    .object({
      kind: z.literal("event_type_create"),
      title,
      slug,
      length,
      description: description.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("event_type_update"),
      eventTypeId: id,
      changes: z
        .object({
          title: title.optional(),
          slug: slug.optional(),
          length: length.optional(),
          description: description.optional(),
          minimumBookingNotice: z.number().int().min(0).max(525600).optional(),
          beforeEventBuffer: buffer.optional(),
          afterEventBuffer: buffer.optional(),
          hidden: z.boolean().optional(),
          lookBusy: lookBusySchema.optional(),
        })
        .strict()
        .refine(nonempty, "At least one change is required."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("availability_update"),
      scheduleId: id,
      changes: z
        .object({
          name: title.optional(),
          timeZone: timeZoneSchema.optional(),
          weekly: z.array(ranges).length(7).optional(),
          overrides: z
            .array(z.object({ date: calendarDate, ranges }).strict())
            .max(366)
            .refine(
              (values) => new Set(values.map((value) => value.date)).size === values.length,
              "Duplicate date overrides."
            )
            .optional(),
        })
        .strict()
        .refine(nonempty, "At least one change is required."),
    })
    .strict(),
]);

export type McpAction = z.infer<typeof actionSchema>;
