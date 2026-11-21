import { ErrorCode } from "@calcom/lib/errorCodes";
import { getCalEventDefaults } from "@calcom/lib/calDefaults";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma } from "@calcom/prisma/client";
import type { McpAction } from "./actions";
import { canonicalHash } from "./integrity";
import type { PreparedChange } from "./ProposalService";
import { hoursSelect } from "./ReadService";
import { scheduleTimes } from "./scheduleTimes";

export type ConfigAction = Extract<
  McpAction,
  { kind: "event_type_create" | "event_type_update" | "availability_update" }
>;
type Database = Pick<Prisma.TransactionClient, "user" | "eventType" | "schedule" | "eventTypeTranslation">;
const deny = () => new ErrorWithCode(ErrorCode.Forbidden, "mcp_configuration_unavailable");
const stateHash = (value: unknown) => canonicalHash(JSON.parse(JSON.stringify(value)));
const clock = (minute: number) => new Date(Date.UTC(1970, 0, 1, 0, Math.min(minute, 1439)));

export class ConfigChanges {
  constructor(private readonly db: Database) {}

  private async state(userId: number, action: ConfigAction) {
    const user = await this.db.user.findFirst({
      where: { id: userId, locked: false, emailVerified: { not: null } },
      select: { id: true, organizationId: true, timeZone: true, defaultScheduleId: true },
    });
    if (!user || user.organizationId !== null) throw deny();
    const event =
      action.kind === "event_type_update"
        ? await this.db.eventType.findFirst({
            where: { id: action.eventTypeId, userId, teamId: null, parentId: null },
            select: { id: true, title: true, updatedAt: true, metadata: true },
          })
        : null;
    if (action.kind === "event_type_update" && !event) throw deny();
    const scheduleId = action.kind === "availability_update" ? action.scheduleId : user.defaultScheduleId;
    const schedule =
      action.kind !== "event_type_update" && scheduleId
        ? await this.db.schedule.findFirst({
            where: { id: scheduleId, userId },
            select: { id: true, name: true, timeZone: true, availability: { select: hoursSelect } },
          })
        : null;
    if (action.kind !== "event_type_update" && !schedule) throw deny();
    if (action.kind === "event_type_create") {
      const collision = await this.db.eventType.findFirst({
        where: { userId, slug: action.slug },
        select: { id: true },
      });
      if (collision) throw new ErrorWithCode(ErrorCode.BadRequest, "This booking URL is already used.");
    }
    return {
      user,
      event,
      schedule: schedule
        ? {
            id: schedule.id,
            name: schedule.name,
            timeZone: schedule.timeZone,
            ...scheduleTimes(schedule.availability),
          }
        : null,
    };
  }

  async prepare(userId: number, action: ConfigAction): Promise<PreparedChange> {
    const state = await this.state(userId, action);
    let summary: string;
    if (action.kind === "event_type_create") {
      summary = `Create “${action.title}” (${action.length} minutes) at /${action.slug}. Google Meet (requires connected Google Calendar), schedule “${state.schedule?.name}”, ${state.schedule?.timeZone ?? state.user.timeZone}. Four hours' notice, 15-minute after-buffer, 30 calendar days ahead, at most four bookings per day, automatic confirmation. Look busy is off.`;
    } else if (action.kind === "event_type_update") {
      summary = `Update “${state.event?.title}” (event type ${action.eventTypeId}). Only the listed settings will change. Existing bookings stay as they are.`;
    } else {
      summary = `Update schedule “${state.schedule?.name}” (${state.schedule?.timeZone ?? state.user.timeZone}). Supplied weekly hours or date overrides replace that entire section. Omitted sections are preserved. Existing bookings stay as they are.`;
    }
    return { action, expectedState: stateHash(state), summary };
  }

  // Run inside the caller's serializable transaction so a concurrent UI edit cannot be overwritten.
  async apply(userId: number, change: PreparedChange): Promise<Prisma.InputJsonObject> {
    const action = change.action;
    if (
      action.kind !== "event_type_create" &&
      action.kind !== "event_type_update" &&
      action.kind !== "availability_update"
    )
      throw deny();
    const state = await this.state(userId, action);
    if (stateHash(state) !== change.expectedState)
      throw new ErrorWithCode(ErrorCode.BadRequest, "mcp_change_stale");
    if (action.kind === "event_type_create") {
      if (!state.schedule) throw deny();
      return this.db.eventType.create({
        data: {
          ...getCalEventDefaults(),
          title: action.title,
          slug: action.slug,
          length: action.length,
          description: action.description,
          owner: { connect: { id: userId } },
          users: { connect: { id: userId } },
          schedule: { connect: { id: state.schedule.id } },
        },
        select: { id: true, slug: true },
      });
    }
    if (action.kind === "event_type_update") {
      if (!state.event) throw deny();
      const { lookBusy, ...changes } = action.changes;
      const metadata =
        state.event.metadata &&
        typeof state.event.metadata === "object" &&
        !Array.isArray(state.event.metadata)
          ? state.event.metadata
          : {};
      const updated = await this.db.eventType.updateMany({
        where: {
          id: action.eventTypeId,
          userId,
          teamId: null,
          parentId: null,
          updatedAt: state.event.updatedAt,
        },
        data: { ...changes, ...(lookBusy ? { metadata: { ...metadata, lookBusy } } : {}) },
      });
      if (updated.count !== 1) throw deny();
      const fields: ("TITLE" | "DESCRIPTION")[] = [];
      if (changes.title !== undefined) fields.push("TITLE");
      if (changes.description !== undefined) fields.push("DESCRIPTION");
      if (fields.length)
        await this.db.eventTypeTranslation.deleteMany({
          where: { eventTypeId: action.eventTypeId, field: { in: fields } },
        });
      return { id: action.eventTypeId };
    }
    if (!state.schedule) throw deny();
    const next = { ...state.schedule, ...action.changes };
    const weekly = next.weekly.flatMap((ranges, day) =>
      ranges.map(({ start, end }) => ({
        days: [day],
        startTime: clock(start),
        endTime: clock(end),
        date: null,
      }))
    );
    const overrides = next.overrides.flatMap(({ date, ranges }) =>
      (ranges.length ? ranges : [{ start: 0, end: 0 }]).map(({ start, end }) => ({
        days: [],
        date: new Date(`${date}T00:00:00Z`),
        startTime: clock(start),
        endTime: clock(end),
      }))
    );
    return this.db.schedule.update({
      where: { id: action.scheduleId, userId },
      data: {
        name: next.name,
        timeZone: next.timeZone,
        availability: { deleteMany: {}, create: [...weekly, ...overrides] },
      },
      select: { id: true },
    });
  }
}
