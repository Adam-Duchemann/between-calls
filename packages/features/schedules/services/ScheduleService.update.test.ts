import type { PrismaClient } from "@calcom/prisma";
import type { User } from "@calcom/prisma/client";
import { expect, it } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { ScheduleService } from "./ScheduleService";

const owner = { id: 1, defaultScheduleId: 4, timeZone: "UTC" };
const work = { id: 4, userId: owner.id, name: "Work", timeZone: owner.timeZone };
const morning = {
  start: new Date("2026-11-16T09:00Z"),
  end: new Date("2026-11-16T12:00Z"),
};
const closed = new Date("2026-11-16T00:00Z");

function setup() {
  const prisma = mockDeep<PrismaClient>();
  const updated = { ...work, availability: [], eventType: [] };
  prisma.schedule.findUnique.mockResolvedValue(work);
  prisma.schedule.update.mockResolvedValue(updated);
  prisma.user.update.mockResolvedValue(mockDeep<User>({ defaultScheduleId: work.id }));
  prisma.$transaction.mockResolvedValue([updated, { defaultScheduleId: work.id }]);
  return { prisma, service: new ScheduleService(prisma) };
}

it("renames a schedule without replacing either availability section", async () => {
  const { prisma, service } = setup();
  await service.update({ input: { scheduleId: work.id, name: "Calls" }, user: owner });
  expect(prisma.schedule.update.mock.calls[0]?.[0].data).toEqual({
    name: "Calls",
    timeZone: undefined,
  });
});

it("replaces weekly hours independently of dated overrides", async () => {
  const { prisma, service } = setup();
  await service.update({
    input: { scheduleId: work.id, schedule: [[], [morning], [], [], [], [], []] },
    user: owner,
  });
  expect(prisma.schedule.update.mock.calls[0]?.[0].data.availability).toEqual({
    deleteMany: [{ date: null }],
    createMany: { data: [{ days: [1], startTime: morning.start, endTime: morning.end }] },
  });
});

it("stores a closed date exactly once while leaving weekly hours intact", async () => {
  const { prisma, service } = setup();
  await service.update({
    input: { scheduleId: work.id, name: work.name, dateOverrides: [{ start: closed, end: closed }] },
    user: owner,
  });
  expect(prisma.schedule.update.mock.calls[0]?.[0].data.availability).toEqual({
    deleteMany: [{ date: { not: null } }],
    createMany: { data: [{ date: closed, startTime: closed, endTime: closed }] },
  });
});

it("clears dated overrides explicitly while preserving weekly hours", async () => {
  const { prisma, service } = setup();
  await service.update({ input: { scheduleId: work.id, dateOverrides: [] }, user: owner });
  expect(prisma.schedule.update.mock.calls[0]?.[0].data.availability).toEqual({
    deleteMany: [{ date: { not: null } }],
    createMany: { data: [] },
  });
});

it("commits the default selection and edited hours in the same serializable transaction", async () => {
  const { prisma, service } = setup();
  const result = await service.update({
    input: { scheduleId: work.id, name: "Calls", isDefault: true, dateOverrides: [] },
    user: { ...owner, defaultScheduleId: null },
  });
  expect(prisma.$transaction).toHaveBeenCalledWith(
    [expect.anything(), prisma.user.update.mock.results[0]?.value],
    { isolationLevel: "Serializable" }
  );
  expect(result).toMatchObject({ isDefault: true, prevDefaultId: null, currentDefaultId: work.id });
});
