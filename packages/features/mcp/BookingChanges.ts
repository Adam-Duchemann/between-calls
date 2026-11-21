import { getBookingFieldsWithSystemFields } from "@calcom/features/bookings/lib/getBookingFields";
import getBookingResponsesSchema from "@calcom/features/bookings/lib/getBookingResponsesSchema";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma } from "@calcom/prisma/client";
import { z } from "zod";
import type { McpAction } from "./actions";
import { existingBookingDuration, offeredDuration } from "./bookingDuration";
import { type BookingInput, type BookingOperations, nativeBookingOperations } from "./BookingOperations";
import { canonicalHash } from "./integrity";
import type { PreparedChange } from "./ProposalService";
import { hoursSelect } from "./ReadService";
import { scheduleTimes } from "./scheduleTimes";

export type BookingAction = Extract<
  McpAction,
  { kind: "booking_create" | "booking_reschedule" | "booking_cancel" }
>;
type Database = Pick<Prisma.TransactionClient, "user" | "eventType" | "booking" | "schedule">;
const deny = () => new ErrorWithCode(ErrorCode.Forbidden, "mcp_booking_unavailable");
const unsupported = () =>
  new ErrorWithCode(ErrorCode.BadRequest, "Use CAL directly for this booking's additional requirements.");
const stateHash = (value: unknown) => canonicalHash(JSON.parse(JSON.stringify(value)));
const appsSchema = z.object({
  apps: z.record(z.object({ enabled: z.boolean().optional(), price: z.number().nullish() })).optional(),
});

export class BookingChanges {
  constructor(
    private readonly db: Database,
    private readonly operations: BookingOperations = nativeBookingOperations
  ) {}

  private async state(userId: number, action: BookingAction) {
    const user = await this.db.user.findFirst({
      where: { id: userId, locked: false, emailVerified: { not: null } },
      select: { id: true, email: true, timeZone: true, organizationId: true, defaultScheduleId: true },
    });
    if (!user || user.organizationId !== null) throw deny();
    const booking =
      action.kind !== "booking_create"
        ? await this.db.booking.findFirst({
            where: { uid: action.bookingUid, userId, eventType: { userId, teamId: null, parentId: null } },
            select: {
              id: true,
              uid: true,
              eventTypeId: true,
              startTime: true,
              endTime: true,
              updatedAt: true,
              status: true,
              recurringEventId: true,
              paid: true,
              responses: true,
              attendees: { select: { name: true, email: true, timeZone: true }, orderBy: { id: "asc" } },
              payment: { select: { id: true }, take: 1 },
            },
          })
        : null;
    if (action.kind !== "booking_create" && (!booking || !["ACCEPTED", "PENDING"].includes(booking.status)))
      throw deny();
    if (booking && (booking.recurringEventId || booking.paid || booking.payment.length)) throw unsupported();
    const eventTypeId = action.kind === "booking_create" ? action.eventTypeId : booking?.eventTypeId;
    if (!eventTypeId) throw deny();
    const event = await this.db.eventType.findFirst({
      where: { id: eventTypeId, userId, teamId: null, parentId: null },
      select: {
        id: true,
        title: true,
        slug: true,
        length: true,
        updatedAt: true,
        locations: true,
        bookingFields: true,
        disableGuests: true,
        customInputs: {
          select: {
            id: true,
            eventTypeId: true,
            label: true,
            type: true,
            options: true,
            required: true,
            placeholder: true,
          },
        },
        metadata: true,
        scheduleId: true,
        price: true,
        recurringEvent: true,
        seatsPerTimeSlot: true,
      },
    });
    if (!event) throw deny();
    const apps = appsSchema.parse(event.metadata ?? {}).apps ?? {};
    if (
      event.recurringEvent ||
      event.seatsPerTimeSlot ||
      event.price > 0 ||
      Object.values(apps).some((app) => app.enabled && app.price)
    )
      throw unsupported();
    const schedule = await this.db.schedule.findFirst({
      where: { id: event.scheduleId ?? user.defaultScheduleId ?? -1, userId },
      select: { id: true, timeZone: true, availability: { select: hoursSelect } },
    });
    return {
      user,
      booking,
      event,
      schedule: schedule
        ? { id: schedule.id, timeZone: schedule.timeZone, ...scheduleTimes(schedule.availability) }
        : null,
    };
  }

  private async checkTime(action: BookingAction, state: Awaited<ReturnType<BookingChanges["state"]>>) {
    if (action.kind === "booking_cancel" && state.booking) return existingBookingDuration(state.booking);
    if (action.kind === "booking_cancel") throw deny();
    const duration = offeredDuration(
      state.event,
      action.kind === "booking_create" ? action.duration : undefined,
      state.booking ?? undefined
    );
    const start = Date.parse(action.start);
    const result = await this.operations.slots({
      ctx: { bypassSlotsCache: true },
      input: {
        eventTypeId: state.event.id,
        startTime: new Date(start - 86400000).toISOString(),
        endTime: new Date(start + 86400000).toISOString(),
        timeZone: state.user.timeZone,
        isTeamEvent: false,
        duration,
        ...(action.kind === "booking_reschedule" ? { rescheduleUid: action.bookingUid } : {}),
      },
    });
    if (
      !Object.values(result.slots)
        .flat()
        .some((slot) => Date.parse(slot.time) === start)
    ) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        "This time is no longer offered. Choose another available time."
      );
    }
    return duration;
  }

  async prepare(userId: number, action: BookingAction): Promise<PreparedChange> {
    const state = await this.state(userId, action);
    if (action.kind === "booking_create") await this.newResponses(state.event, action);
    const duration = await this.checkTime(action, state);
    const guests =
      action.kind === "booking_create"
        ? `${action.attendee.name} <${action.attendee.email}>`
        : state.booking?.attendees.map((person) => `${person.name} <${person.email}>`).join(", ");
    const start = action.kind === "booking_cancel" ? state.booking?.startTime.toISOString() : action.start;
    const formatted = start
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: state.user.timeZone,
        }).format(new Date(start))
      : "";
    const verb =
      action.kind === "booking_create"
        ? "Book"
        : action.kind === "booking_reschedule"
          ? "Reschedule"
          : "Cancel";
    return {
      action,
      expectedState: stateHash(state),
      summary: `${verb} “${state.event.title}” for ${guests}, ${formatted} (${state.user.timeZone}). This updates connected calendars and sends the normal booking emails. Duration: ${duration} minutes.`,
    };
  }

  private async newResponses(
    event: Awaited<ReturnType<BookingChanges["state"]>>["event"],
    action: Extract<BookingAction, { kind: "booking_create" }>
  ) {
    const locations = z.array(z.object({ type: z.string() })).parse(event.locations ?? []);
    if (locations.length !== 1 || ["phone", "attendeeInPerson", "somewhereElse"].includes(locations[0].type))
      throw unsupported();
    const responses = {
      name: action.attendee.name,
      email: action.attendee.email,
      notes: action.notes ?? "",
      guests: [],
      location: { value: locations[0].type, optionValue: "" },
    };
    const bookingFields = getBookingFieldsWithSystemFields(event);
    if (
      !(await getBookingResponsesSchema({ bookingFields, view: "booking" }).safeParseAsync(responses)).success
    )
      throw unsupported();
    return responses;
  }

  async apply(userId: number, change: PreparedChange, proposalId: string): Promise<Prisma.InputJsonObject> {
    const action = change.action;
    if (
      action.kind !== "booking_create" &&
      action.kind !== "booking_reschedule" &&
      action.kind !== "booking_cancel"
    )
      throw deny();
    const state = await this.state(userId, action);
    if (stateHash(state) !== change.expectedState)
      throw new ErrorWithCode(ErrorCode.BadRequest, "mcp_change_stale");
    const duration = await this.checkTime(action, state);
    if (action.kind === "booking_cancel") {
      await this.operations.cancel({
        userId,
        bookingData: {
          uid: action.bookingUid,
          cancellationReason: action.reason,
          cancelledBy: state.user.email,
        },
      });
      return { uid: action.bookingUid, status: "CANCELLED" };
    }
    const person = action.kind === "booking_create" ? action.attendee : state.booking?.attendees[0];
    if (!person) throw unsupported();
    let responses: Record<string, unknown>;
    if (action.kind === "booking_reschedule") {
      responses = z.record(z.unknown()).parse(state.booking?.responses);
    } else {
      responses = await this.newResponses(state.event, action);
    }
    const input: BookingInput = {
      bookingMeta: { userId },
      bookingData: {
        eventTypeId: state.event.id,
        start: action.start,
        end: new Date(Date.parse(action.start) + duration * 60_000).toISOString(),
        timeZone: person.timeZone,
        language: "en",
        metadata: { calMcpProposalId: proposalId },
        responses,
        ...(action.kind === "booking_reschedule"
          ? { rescheduleUid: action.bookingUid, rescheduledBy: state.user.email }
          : {}),
      },
    };
    const result = await (action.kind === "booking_create"
      ? this.operations.create(input)
      : this.operations.reschedule(input));
    const booking = z
      .object({ uid: z.string(), status: z.string(), startTime: z.coerce.date(), endTime: z.coerce.date() })
      .parse(result);
    return {
      uid: booking.uid,
      status: booking.status,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
    };
  }
}
