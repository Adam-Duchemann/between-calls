import { z } from "zod";

export const hostCalendarSchema = z
  .object({
    dateFrom: z.string().datetime({ offset: true }),
    dateTo: z.string().datetime({ offset: true }),
    calendars: z
      .array(z.object({ credentialId: z.number().int().positive(), externalId: z.string().min(1).max(1024) }))
      .max(32)
      .optional(),
  })
  .refine(({ dateFrom, dateTo }) => {
    const duration = new Date(dateTo).valueOf() - new Date(dateFrom).valueOf();
    return duration > 0 && duration <= 35 * 86400000;
  }, "Request a calendar range of at most 35 days.");

export type HostCalendarInput = z.infer<typeof hostCalendarSchema>;
