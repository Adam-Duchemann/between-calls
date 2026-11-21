// @vitest-environment node
import { randomUUID } from "node:crypto";
import process from "node:process";
import { getPaymentAppData } from "@calcom/app-store/_utils/payments/getPaymentAppData";
import { getTranslation } from "@calcom/i18n/server";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import prisma from "@calcom/prisma";
import short from "short-uuid";
import { beforeAll, expect, it, vi } from "vitest";
import { type Booking, createBooking } from "./createBooking";
import { getEventTypesFromDB } from "./getEventTypesFromDB";
import {
  getOriginalRescheduledBooking,
  type OriginalRescheduledBooking,
} from "./originalRescheduledBookingUtils";

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const isolatedPort =
    url.port === "55432" || (url.port === "55433" && url.pathname.startsWith("/cal_native_restore_"));
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !isolatedPort)
    throw new Error("Use an isolated CAL loopback test database.");
});

type Scenario = {
  userId: number;
  eventTypeId: number;
  book: (offset: number, original?: OriginalRescheduledBooking, eventTypeId?: number) => Promise<Booking>;
};

async function withScenario(
  run: (scenario: Scenario) => Promise<void>,
  before = 0,
  after = 0
): Promise<void> {
  vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
  const suffix = randomUUID();
  const email = `cal-race-${suffix}@example.test`;
  const user = await prisma.user.create({
    data: { email, username: `cal-race-${suffix}`, name: "Race fixture", timeZone: "Indian/Reunion" },
    select: { id: true, username: true },
  });
  try {
    const stored = await prisma.eventType.create({
      data: {
        userId: user.id,
        users: { connect: { id: user.id } },
        title: "Race fixture",
        slug: "race",
        length: 30,
        slotInterval: 15,
        beforeEventBuffer: before,
        afterEventBuffer: after,
      },
      select: { id: true },
    });
    const language = { locale: "en", translate: await getTranslation("en", "common") };
    const book: Scenario["book"] = async (offset, original = null, eventTypeId = stored.id) => {
      const event = await getEventTypesFromDB(eventTypeId);
      const guestEmail = `guest-${randomUUID()}@example.test`;
      return createBooking({
        uid: short.generate(),
        rescheduledBy: undefined,
        reqBody: { user: user.username ?? "", metadata: {}, recurringEventId: undefined },
        eventType: {
          eventTypeData: event,
          id: event.id,
          slug: event.slug,
          organizerUser: event.users[0],
          isConfirmedByDefault: true,
          paymentAppData: getPaymentAppData(event),
        },
        input: {
          bookerEmail: guestEmail,
          responses: null,
          rescheduleReason: undefined,
          smsReminderNumber: undefined,
        },
        evt: {
          type: event.title,
          title: event.title,
          startTime: new Date(Date.parse("2099-11-17T06:00:00Z") + offset * 60000).toISOString(),
          endTime: new Date(Date.parse("2099-11-17T06:30:00Z") + offset * 60000).toISOString(),
          organizer: { id: user.id, name: "Race fixture", email, timeZone: "Indian/Reunion", language },
          attendees: [{ name: "Guest", email: guestEmail, timeZone: "UTC", language }],
        },
        originalRescheduledBooking: original,
      });
    };
    await run({ book, userId: user.id, eventTypeId: stored.id });
  } finally {
    await prisma.booking.deleteMany({ where: { userId: user.id } });
    await prisma.eventType.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id, email } });
    vi.unstubAllEnvs();
  }
}

function expectSuccesses(results: PromiseSettledResult<Booking>[], count: number): void {
  const rejected = results.filter((result) => result.status === "rejected");
  expect(
    results.filter((result) => result.status === "fulfilled"),
    rejected.map((result) => String(result.reason)).join("\n")
  ).toHaveLength(count);
  expect(rejected).toHaveLength(results.length - count);
  for (const result of rejected) expect(getServerErrorFromUnknown(result.reason).statusCode).toBe(409);
}

it.each([
  { offset: 0, before: 0, after: 0, accepted: 1 },
  { offset: 15, before: 0, after: 0, accepted: 1 },
  { offset: 30, before: 0, after: 0, accepted: 2 },
  { offset: 30, before: 0, after: 15, accepted: 1 },
  { offset: 45, before: 0, after: 15, accepted: 2 },
  { offset: 45, before: 15, after: 15, accepted: 1 },
  { offset: 60, before: 15, after: 15, accepted: 2 },
])("persists $accepted bookings at offset $offset with buffers $before/$after", async ({
  offset,
  before,
  after,
  accepted,
}) => {
  await withScenario(
    async ({ book, userId }) => {
      expectSuccesses(await Promise.allSettled([book(0), book(offset)]), accepted);
      expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(accepted);
    },
    before,
    after
  );
}, 60000);

it("protects the same owner across personal event types", async () => {
  await withScenario(async ({ book, userId }) => {
    const other = await prisma.eventType.create({
      data: { userId, users: { connect: { id: userId } }, title: "Other", slug: "other", length: 30 },
      select: { id: true },
    });
    expectSuccesses(await Promise.allSettled([book(0), book(15, null, other.id)]), 1);
  });
}, 60000);

it("releases cancelled times and excludes the booking being rescheduled", async () => {
  await withScenario(async ({ book, userId }) => {
    const first = await book(0);
    const original = await getOriginalRescheduledBooking(first.uid);
    const moved = await book(0, original);
    expect(moved.fromReschedule).toBe(first.uid);
    await prisma.booking.update({ where: { id: moved.id }, data: { status: "CANCELLED" } });
    await book(0);
    expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(1);
  });
}, 60000);

it("allows only one replacement when the same booking is rescheduled concurrently", async () => {
  await withScenario(async ({ book, userId }) => {
    const first = await book(0);
    const original = await getOriginalRescheduledBooking(first.uid);
    expectSuccesses(await Promise.allSettled([book(60, original), book(120, original)]), 1);
    expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(1);
  });
}, 60000);

it("rejects a reschedule if the original was cancelled after validation", async () => {
  await withScenario(async ({ book, userId }) => {
    const first = await book(0);
    const original = await getOriginalRescheduledBooking(first.uid);
    await prisma.booking.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
    await expect(book(60, original)).rejects.toThrow();
    expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(0);
  });
}, 60000);

it.each([
  "PER_DAY",
  "PER_WEEK",
  "PER_MONTH",
  "PER_YEAR",
])("enforces a %s booking cap when two different slots are booked concurrently", async (limit) => {
  await withScenario(async ({ book, eventTypeId, userId }) => {
    await prisma.eventType.update({ where: { id: eventTypeId }, data: { bookingLimits: { [limit]: 1 } } });
    expectSuccesses(await Promise.allSettled([book(0), book(60)]), 1);
    expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(1);
  });
}, 60000);

it.each([
  "PER_DAY",
  "PER_WEEK",
  "PER_MONTH",
  "PER_YEAR",
])("enforces a %s duration cap under concurrent bookings", async (limit) => {
  await withScenario(async ({ book, eventTypeId }) => {
    await prisma.eventType.update({ where: { id: eventTypeId }, data: { durationLimits: { [limit]: 45 } } });
    expectSuccesses(await Promise.allSettled([book(0), book(60)]), 1);
  });
}, 60000);

it("allows the exact duration limit and excludes the rescheduled booking from both caps", async () => {
  await withScenario(async ({ book, eventTypeId }) => {
    await prisma.eventType.update({
      where: { id: eventTypeId },
      data: { bookingLimits: { PER_DAY: 2 }, durationLimits: { PER_DAY: 60 } },
    });
    const first = await book(0);
    await book(60);
    await book(120, await getOriginalRescheduledBooking(first.uid));
    await expect(book(180)).rejects.toThrow();
  });
}, 60000);

it.each([
  { offsets: [13 * 60, 15 * 60], accepted: 2 },
  { offsets: [15 * 60, 18 * 60], accepted: 1 },
])("uses host calendar days across UTC midnight: $offsets", async ({ offsets, accepted }) => {
  await withScenario(async ({ book, eventTypeId }) => {
    await prisma.eventType.update({ where: { id: eventTypeId }, data: { bookingLimits: { PER_DAY: 1 } } });
    expectSuccesses(await Promise.allSettled(offsets.map((offset) => book(offset))), accepted);
  });
}, 60000);

it("uses the event schedule timezone before the owner's default schedule", async () => {
  await withScenario(async ({ book, eventTypeId, userId }) => {
    const schedule = await prisma.schedule.create({
      data: { userId, name: "Race default", timeZone: "America/New_York" },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: userId }, data: { defaultScheduleId: schedule.id } });
    await prisma.eventType.update({ where: { id: eventTypeId }, data: { bookingLimits: { PER_DAY: 1 } } });
    await book(13 * 60);
    await expect(book(15 * 60)).rejects.toThrow();
    await prisma.eventType.update({
      where: { id: eventTypeId },
      data: { schedule: { create: { userId, name: "Race event", timeZone: "Indian/Reunion" } } },
    });
    await book(15 * 60);
  });
}, 60000);

it("counts the entire host day during the spring DST change", async () => {
  await withScenario(async ({ book, eventTypeId }) => {
    await prisma.eventType.update({
      where: { id: eventTypeId },
      data: { timeZone: "America/New_York", bookingLimits: { PER_DAY: 1 } },
    });
    const offset = (date: string) => (Date.parse(date) - Date.parse("2099-11-17T06:00:00Z")) / 60000;
    await book(offset("2030-03-10T05:30:00Z"));
    await expect(book(offset("2030-03-11T03:30:00Z"))).rejects.toThrow();
    await book(offset("2030-03-11T04:00:00Z"));
  });
}, 60000);
