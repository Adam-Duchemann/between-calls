import type { UserFromSession } from "@calcom/features/auth/lib/userFromSessionUtils";
import { getAvailabilityFromSchedule } from "@calcom/lib/availability";
import { timeZoneSchema } from "@calcom/lib/dayjs/timeZone.schema";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { hasEditPermissionForUserID } from "@calcom/lib/hasEditPermissionForUser";
import { transformScheduleToAvailabilityForAtom } from "@calcom/lib/schedules/transformers/for-atom";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { z } from "zod";
import { dateOverridesSchema, weeklyScheduleSchema } from "../lib/validateSchedule";
import { ScheduleRepository } from "../repositories/ScheduleRepository";

export const ZUpdateInputSchema = z.object({
  scheduleId: z.number(),
  timeZone: timeZoneSchema.optional(),
  name: z.string().trim().min(1, "Schedule name cannot be empty").optional(),
  isDefault: z.boolean().optional(),
  schedule: weeklyScheduleSchema.optional(),
  dateOverrides: dateOverridesSchema.optional(),
});

export type TUpdateInputSchema = z.infer<typeof ZUpdateInputSchema>;

interface IUpdateScheduleOptions {
  input: TUpdateInputSchema;
  user: Pick<NonNullable<UserFromSession>, "id" | "defaultScheduleId" | "timeZone">;
}

export type UpdateScheduleResponse = Awaited<ReturnType<ScheduleService["update"]>>;

export class ScheduleService {
  constructor(private prisma: PrismaClient) {}

  async update({ input, user }: IUpdateScheduleOptions) {
    // Not able to update the schedule with userId where clause, so fetch schedule separately and then validate
    // Bug: https://github.com/prisma/prisma/issues/7290
    const userSchedule = await this.prisma.schedule.findUnique({
      where: {
        id: input.scheduleId,
      },
      select: {
        userId: true,
        name: true,
        id: true,
      },
    });

    if (!userSchedule) {
      throw new ErrorWithCode(ErrorCode.Forbidden, "Unauthorized");
    }

    if (userSchedule?.userId !== user.id) {
      const hasEditPermission = await hasEditPermissionForUserID({
        ctx: {
          user,
        },
        input: { memberId: userSchedule.userId },
      });
      if (!hasEditPermission) {
        throw new ErrorWithCode(ErrorCode.Forbidden, "Unauthorized");
      }
    }

    const setDefault = input.isDefault
      ? new ScheduleRepository(this.prisma).setupDefaultSchedule(user.id, input.scheduleId)
      : undefined;
    const { name, timeZone, schedule: weeklyHours, dateOverrides } = input;
    if (
      name === undefined &&
      timeZone === undefined &&
      weeklyHours === undefined &&
      dateOverrides === undefined
    ) {
      const updatedUser = await setDefault;
      return {
        schedule: userSchedule,
        isDefault: (updatedUser?.defaultScheduleId ?? user.defaultScheduleId) === input.scheduleId,
      };
    }

    const replaced: Prisma.AvailabilityScalarWhereInput[] = [];
    if (weeklyHours !== undefined) replaced.push({ date: null });
    if (dateOverrides !== undefined) replaced.push({ date: { not: null } });
    const availability = replaced.length
      ? {
          deleteMany: replaced,
          createMany: {
            data: [
              ...(weeklyHours ? getAvailabilityFromSchedule(weeklyHours) : []),
              ...(dateOverrides ?? []).map(({ start, end }) => ({
                date: start,
                startTime: start,
                endTime: end,
              })),
            ],
          },
        }
      : undefined;

    const editSchedule = this.prisma.schedule.update({
      where: {
        id: input.scheduleId,
      },
      data: {
        timeZone,
        name,
        ...(availability && { availability }),
      },
      select: {
        id: true,
        userId: true,
        name: true,
        availability: true,
        timeZone: true,
        eventType: {
          select: {
            id: true,
            eventName: true,
          },
        },
      },
    });
    const [schedule, updatedUser] = await this.prisma.$transaction(
      [editSchedule, ...(setDefault ? [setDefault] : [])],
      { isolationLevel: "Serializable" }
    );

    const userAvailability = transformScheduleToAvailabilityForAtom(schedule);

    return {
      schedule,
      availability: userAvailability,
      timeZone: schedule.timeZone || user.timeZone,
      isDefault: updatedUser
        ? updatedUser.defaultScheduleId === schedule.id
        : user.defaultScheduleId === schedule.id,
      prevDefaultId: user.defaultScheduleId,
      currentDefaultId: updatedUser ? updatedUser.defaultScheduleId : user.defaultScheduleId,
    };
  }
}

export const updateSchedule = async ({
  input,
  user,
  prisma,
}: IUpdateScheduleOptions & { prisma: PrismaClient }) => {
  const service = new ScheduleService(prisma);
  return service.update({ input, user });
};
