import authedProcedure from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZConnectedCalendarsInputSchema } from "./connectedCalendars.schema";
import { hostCalendarSchema } from "./hostCalendar.schema";
import { ZSetDestinationCalendarInputSchema } from "./setDestinationCalendar.schema";
import { ZSetDestinationReminderInputSchema } from "./setDestinationReminder.schema";

export const calendarsRouter = router({
  hostCalendar: authedProcedure.input(hostCalendarSchema).query(async ({ ctx, input }) => {
    ctx.res?.setHeader("Cache-Control", "private, no-store");
    const { hostCalendarHandler } = await import("./hostCalendar.handler");
    return hostCalendarHandler({ ctx, input });
  }),
  connectedCalendars: authedProcedure.input(ZConnectedCalendarsInputSchema).query(async ({ ctx, input }) => {
    const { connectedCalendarsHandler } = await import("./connectedCalendars.handler");

    return connectedCalendarsHandler({ ctx, input });
  }),

  setDestinationCalendar: authedProcedure
    .input(ZSetDestinationCalendarInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { setDestinationCalendarHandler } = await import("./setDestinationCalendar.handler");

      return setDestinationCalendarHandler({ ctx, input });
    }),

  setDestinationReminder: authedProcedure
    .input(ZSetDestinationReminderInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { setDestinationReminderHandler } = await import("./setDestinationReminder.handler");

      return setDestinationReminderHandler({ ctx, input });
    }),
});
