import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import type { GetScheduleOptions } from "./types";

export const getScheduleHandler = async ({ ctx, input }: GetScheduleOptions) => {
  const session = ctx?.session ?? (ctx?.req ? await getServerSession({ req: ctx.req }) : null);
  ctx?.res?.setHeader("Cache-Control", "private, no-store");
  const availableSlotsService = getAvailableSlotsService();
  return await availableSlotsService.getAvailableSlots({ ctx: { ...ctx, session }, input });
};
