// @vitest-environment node
import { randomUUID } from "node:crypto";
import prisma from "@calcom/prisma";
import { expect, it } from "vitest";
import { createInitialAdmin } from "./createInitialAdmin";

it("commits only one complete private owner when setup requests race", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    !url.pathname.startsWith("/cal_bootstrap_test_")
  )
    throw new Error("Use a fresh, migrated cal_bootstrap_test_* database on the isolated loopback server.");
  expect(await prisma.user.count()).toBe(0);
  const input = {
    username: "setup-test-owner",
    email: `setup-${randomUUID()}@example.test`,
    name: "Setup test owner",
    passwordHash: "not-a-real-login-hash",
    privateInstance: true,
  };
  const results = await Promise.allSettled(
    [0, 1].map((attempt) =>
      prisma.$transaction(
        (tx) =>
          createInitialAdmin(tx, {
            ...input,
            username: `${input.username}-${attempt}`,
            email: `${attempt}-${input.email}`,
          }),
        { isolationLevel: "Serializable", timeout: 15000 }
      )
    )
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await prisma.user.count()).toBe(1);
  const owner = await prisma.user.findFirstOrThrow({
    select: { id: true, timeZone: true, defaultScheduleId: true },
  });
  expect(owner.timeZone).toBe("UTC");
  const schedule = await prisma.schedule.findUniqueOrThrow({
    where: { id: owner.defaultScheduleId! },
    select: {
      userId: true,
      timeZone: true,
      availability: { select: { days: true, startTime: true, endTime: true } },
    },
  });
  expect(schedule.userId).toBe(owner.id);
  expect(schedule.availability).toEqual([
    {
      days: [1, 2, 3, 4, 5],
      startTime: new Date("1970-01-01T09:00:00Z"),
      endTime: new Date("1970-01-01T17:00:00Z"),
    },
  ]);
  expect(
    await prisma.eventType.findMany({
      select: { userId: true, scheduleId: true, length: true, bookingLimits: true },
    })
  ).toEqual([
    { userId: owner.id, scheduleId: owner.defaultScheduleId, length: 30, bookingLimits: { PER_DAY: 4 } },
  ]);
});
