// @vitest-environment node
import { randomUUID } from "node:crypto";
import process from "node:process";
import { getEventType } from "@calcom/features/bookings/lib/handleNewBooking/getEventType";
import { getPublicEvent } from "@calcom/features/eventtypes/lib/getPublicEvent";
import prisma from "@calcom/prisma";
import { getScheduleHandler } from "./getSchedule.handler";
import { isAvailableHandler } from "./isAvailable.handler";
import { reserveSlotHandler } from "./reserveSlot.handler";
import dayjs from "@calcom/dayjs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const fixture = `cal-rr-${randomUUID()}`;
const userNames = [`${fixture}-one`, `${fixture}-two`];
let initialized = false;

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const isFixture = url.port === "55437" && url.pathname.startsWith("/cal_private_event_surface_");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || (url.port !== "55432" && !isFixture)) {
    throw new Error("Use an isolated CAL test database.");
  }
  initialized = true;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (initialized) {
    await prisma.team.deleteMany({ where: { slug: fixture } });
    await prisma.user.deleteMany({ where: { username: { in: userNames } } });
  }
  await prisma.$disconnect();
});

it("only exposes bookable personal events in private mode and keeps future round-robin availability", async () => {
  const hosts = await Promise.all(
    userNames.map(async (username) => {
      const user = await prisma.user.create({
        data: {
          name: "Round robin fixture",
          email: `${username}@example.invalid`,
          username,
          timeZone: "Etc/UTC",
        },
        select: { id: true },
      });
      const schedule = await prisma.schedule.create({
        data: {
          name: "Fixture hours",
          timeZone: "Etc/UTC",
          userId: user.id,
          availability: {
            create: [
              {
                days: [0, 1, 2, 3, 4, 5, 6],
                startTime: new Date("1970-01-01T09:00:00Z"),
                endTime: new Date("1970-01-01T12:00:00Z"),
              },
            ],
          },
        },
        select: { id: true },
      });
      await prisma.user.update({ where: { id: user.id }, data: { defaultScheduleId: schedule.id } });
      return { id: user.id, username: username, scheduleId: schedule.id };
    })
  );
  const [owner, teammate] = hosts;
  const teamSlug = fixture;
  const team = await prisma.team.create({
    data: {
      name: "Isolated future team",
      slug: teamSlug,
      members: {
        create: [
          { userId: owner.id, accepted: true, role: "OWNER" },
          { userId: teammate.id, accepted: true, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });
  const roundRobin = await prisma.eventType.create({
    data: {
      title: "Future round robin",
      slug: "round-robin",
      length: 30,
      teamId: team.id,
      minimumBookingNotice: 0,
      schedulingType: "ROUND_ROBIN",
      users: { connect: { id: owner.id } },
      hosts: { create: hosts.map((user) => ({ userId: user.id, scheduleId: user.scheduleId })) },
    },
    select: { id: true, slug: true },
  });
  const personal = await prisma.eventType.create({
    data: {
      title: "Personal meeting",
      slug: "personal",
      length: 30,
      userId: owner.id,
      minimumBookingNotice: 0,
      users: { connect: { id: owner.id } },
      scheduleId: owner.scheduleId,
    },
    select: { id: true, slug: true },
  });
  const day = dayjs.utc().add(2, "day").startOf("day");
  const startTime = day.toISOString();
  const endTime = day.endOf("day").toISOString();
  const slotStart = day.add(9, "hour").toISOString();
  const slotEnd = day.add(9, "hour").add(30, "minute").toISOString();
  const slotInput = { startTime, endTime, timeZone: "Etc/UTC", isTeamEvent: false };
  const getSlots = (eventTypeId: number, isTeamEvent = false) =>
    getScheduleHandler({ input: { ...slotInput, eventTypeId, isTeamEvent } });
  const reserve = (eventTypeId: number) =>
    reserveSlotHandler({
      ctx: { prisma },
      input: {
        eventTypeId,
        slotUtcStartDate: slotStart,
        slotUtcEndDate: slotEnd,
        _isDryRun: false,
      },
    });
  const status = (eventTypeId: number) =>
    isAvailableHandler({
      ctx: { prisma },
      input: { eventTypeId, slots: [{ utcStartIso: slotStart, utcEndIso: slotEnd }] },
    });

  vi.stubEnv("CAL_PRIVATE_INSTANCE", "false");
  const teamEvent = await getPublicEvent(teamSlug, roundRobin.slug, true, null, prisma, false);
  expect(teamEvent?.subsetOfUsers).toHaveLength(2);
  const teamSlots = await getSlots(roundRobin.id, true);
  const teamSlotCount = Object.values(teamSlots.slots).flat().length;
  expect(teamSlotCount).toBe(6);

  vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
  const allowed = await getPublicEvent(owner.username, personal.slug, false, null, prisma, false);
  expect(allowed?.id).toBe(personal.id);
  const personalSlots = await getSlots(personal.id);
  expect(Object.values(personalSlots.slots).flat()).toHaveLength(6);
  await expect(status(personal.id)).resolves.toMatchObject({ slots: [{ status: "available" }] });
  await expect(reserve(personal.id)).resolves.toHaveProperty("uid");

  const attempts = await Promise.allSettled([
    getPublicEvent(teamSlug, roundRobin.slug, true, null, prisma, false),
    getPublicEvent(owner.username + "+" + teammate.username, "30min", false, null, prisma, false),
    getSlots(roundRobin.id, true),
    getSlots(roundRobin.id, false),
    getScheduleHandler({
      input: { ...slotInput, usernameList: [owner.username, teammate.username], eventTypeSlug: "30min" },
    }),
    status(roundRobin.id),
    reserve(roundRobin.id),
    getEventType({ eventTypeId: roundRobin.id }),
    getEventType({ eventTypeId: 0, eventTypeSlug: "30min" }),
  ]);
  const holds = await prisma.selectedSlots.count({ where: { eventTypeId: roundRobin.id } });
  const blocked = attempts.map((result) =>
    result.status === "fulfilled"
      ? result.value === null
      : result.reason?.code === "NOT_FOUND" ||
        result.reason?.code === "P2025" ||
        result.reason?.statusCode === 404
  );
  expect(blocked).toEqual([true, true, true, true, true, true, true, true, true]);
  expect(holds).toBe(0);
}, 24_000);
