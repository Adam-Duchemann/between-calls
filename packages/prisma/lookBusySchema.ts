import { z } from "zod";

export const lookBusySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("off") }),
  z.object({ mode: z.literal("day"), count: z.number().int().min(1).max(1000) }),
  z.object({ mode: z.literal("week"), count: z.number().int().min(1).max(1000) }),
  z.object({
    mode: z.literal("percentage"),
    percentage: z.union([z.literal(10), z.literal(20), z.literal(33), z.literal(66)]),
  }),
]);

export type LookBusyPolicy = z.infer<typeof lookBusySchema>;
