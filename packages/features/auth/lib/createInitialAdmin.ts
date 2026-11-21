import { CAL_DEFAULT_TIME_ZONE, getCalEventDefaults } from "@calcom/lib/calDefaults";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma } from "@calcom/prisma/client";

// The caller holds a serializable transaction so competing first-admin requests cannot both win.
export async function createInitialAdmin(
  tx: Prisma.TransactionClient,
  input: {
    username: string;
    email: string;
    name: string;
    passwordHash: string;
    privateInstance: boolean;
  }
) {
  if ((await tx.user.count()) !== 0) throw new ErrorWithCode(ErrorCode.BadRequest, "No setup needed.");
  const user = await tx.user.create({
    data: {
      username: input.username,
      email: input.email,
      name: input.name,
      password: { create: { hash: input.passwordHash } },
      role: "ADMIN",
      emailVerified: new Date(),
      locale: "en",
      identityProvider: "CAL",
      creationSource: "WEBAPP",
      ...(input.privateInstance ? { timeZone: CAL_DEFAULT_TIME_ZONE, completedOnboarding: true } : {}),
    },
    select: { id: true },
  });
  if (!input.privateInstance) return user;
  const schedule = await tx.schedule.create({
    data: {
      userId: user.id,
      name: "Working hours",
      timeZone: CAL_DEFAULT_TIME_ZONE,
      availability: {
        create: {
          days: [1, 2, 3, 4, 5],
          startTime: new Date("1970-01-01T09:00:00Z"),
          endTime: new Date("1970-01-01T17:00:00Z"),
        },
      },
    },
    select: { id: true },
  });
  await tx.user.update({
    where: { id: user.id },
    data: { defaultScheduleId: schedule.id },
    select: { id: true },
  });
  await tx.eventType.create({
    data: {
      ...getCalEventDefaults(),
      title: "30 minute meeting",
      slug: "30min",
      userId: user.id,
      users: { connect: { id: user.id } },
      scheduleId: schedule.id,
    },
    select: { id: true },
  });
  return user;
}
