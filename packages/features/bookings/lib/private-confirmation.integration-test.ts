// @vitest-environment node
import { randomUUID } from "node:crypto";
import process from "node:process";
import { getTranslation } from "@calcom/i18n/server";
import prisma from "@calcom/prisma";
import { beforeAll, expect, it, vi } from "vitest";
import { handleConfirmation } from "./handleConfirmation";

const effects = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ results: [], referencesToCreate: [] }),
  email: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./EventManager", () => ({
  default: class {
    create = effects.create;
  },
}));
vi.mock("@calcom/emails/email-manager", () => ({ sendScheduledEmailsAndSMS: effects.email }));
vi.mock("@calcom/features/webhooks/lib/getWebhooks", () => ({ default: vi.fn().mockResolvedValue([]) }));
vi.mock("./handleNewBooking/scheduleNoShowTriggers", () => ({ scheduleNoShowTriggers: vi.fn() }));

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !(url.port === "55432" || (url.port === "55433" && url.pathname.startsWith("/cal_native_restore_")))
  )
    throw new Error("Use an isolated CAL loopback test database.");
});

type Confirmation = Parameters<typeof handleConfirmation>[0];
async function withScenario(
  run: (context: {
    userId: number;
    eventTypeId: number;
    pending: (offset: number) => Promise<Confirmation>;
  }) => Promise<void>
): Promise<void> {
  vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
  vi.clearAllMocks();
  const email = `cal-confirm-${randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: { email, timeZone: "Indian/Reunion" },
    select: { id: true },
  });
  try {
    const event = await prisma.eventType.create({
      data: {
        userId: user.id,
        users: { connect: { id: user.id } },
        slug: "confirm",
        title: "Confirm",
        length: 30,
        requiresConfirmation: true,
      },
      select: { id: true },
    });
    const language = { locale: "en", translate: await getTranslation("en", "common") };
    const pending = async (offset: number): Promise<Confirmation> => {
      const startTime = new Date(Date.parse("2099-11-17T06:00:00Z") + offset * 60000);
      const endTime = new Date(startTime.valueOf() + 30 * 60000);
      const booking = await prisma.booking.create({
        data: {
          uid: randomUUID(),
          userId: user.id,
          eventTypeId: event.id,
          title: "Confirm",
          status: "PENDING",
          startTime,
          endTime,
        },
        select: {
          id: true,
          uid: true,
          startTime: true,
          status: true,
          metadata: true,
          eventTypeId: true,
          userId: true,
          location: true,
          smsReminderNumber: true,
          eventType: {
            select: {
              id: true,
              title: true,
              currency: true,
              description: true,
              length: true,
              price: true,
              requiresConfirmation: true,
            },
          },
        },
      });
      return {
        prisma,
        bookingId: booking.id,
        booking,
        user: { username: null, destinationCalendar: null, credentials: [] },
        evt: {
          type: "Confirm",
          title: "Confirm",
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          organizer: { id: user.id, name: "Fixture", email, timeZone: "Indian/Reunion", language },
          attendees: [],
        },
        traceContext: { traceId: "private-confirmation-test", spanId: "test", operation: "test" },
      };
    };
    await run({ userId: user.id, eventTypeId: event.id, pending });
  } finally {
    await prisma.booking.deleteMany({ where: { userId: user.id } });
    await prisma.eventType.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id, email } });
    vi.unstubAllEnvs();
  }
}

it.each([
  "overlap",
  "count",
  "duration",
])("claims only one pending booking before provider effects when constrained by %s", async (constraint) => {
  await withScenario(async ({ pending, userId, eventTypeId }) => {
    if (constraint !== "overlap")
      await prisma.eventType.update({
        where: { id: eventTypeId },
        data:
          constraint === "count" ? { bookingLimits: { PER_DAY: 1 } } : { durationLimits: { PER_DAY: 45 } },
      });
    const first = await pending(0);
    const second = await pending(constraint === "overlap" ? 15 : 60);
    const results = await Promise.allSettled([handleConfirmation(first), handleConfirmation(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.booking.count({ where: { userId, status: "ACCEPTED" } })).toBe(1);
    expect(effects.create).toHaveBeenCalledTimes(1);
    expect(effects.email).toHaveBeenCalledTimes(1);
  });
}, 60000);

it("does not create duplicate events or emails for concurrent confirmation of one request", async () => {
  await withScenario(async ({ pending }) => {
    const request = await pending(0);
    const results = await Promise.allSettled([handleConfirmation(request), handleConfirmation(request)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(effects.create).toHaveBeenCalledTimes(1);
    expect(effects.email).toHaveBeenCalledTimes(1);
  });
}, 60000);

it.each([
  "CANCELLED",
  "REJECTED",
] as const)("does not revive a request that became %s after validation", async (status) => {
  await withScenario(async ({ pending }) => {
    const request = await pending(0);
    await prisma.booking.update({ where: { id: request.bookingId }, data: { status } });
    await expect(handleConfirmation(request)).rejects.toThrow();
    expect(effects.create).not.toHaveBeenCalled();
    expect(effects.email).not.toHaveBeenCalled();
  });
}, 60000);

it("allows confirmation of a pending booking that blocks its own slot", async () => {
  await withScenario(async ({ pending, eventTypeId }) => {
    await prisma.eventType.update({
      where: { id: eventTypeId },
      data: { requiresConfirmationWillBlockSlot: true },
    });
    const request = await pending(0);
    await handleConfirmation(request);
    expect(
      await prisma.booking.findUnique({ where: { id: request.bookingId }, select: { status: true } })
    ).toEqual({ status: "ACCEPTED" });
    expect(effects.create).toHaveBeenCalledTimes(1);
  });
}, 60000);

it("does not revive or send confirmation for a cancellation during provider work", async () => {
  await withScenario(async ({ pending }) => {
    const request = await pending(0);
    effects.create.mockImplementationOnce(async () => {
      await prisma.booking.update({ where: { id: request.bookingId }, data: { status: "CANCELLED" } });
      return { results: [], referencesToCreate: [] };
    });
    await expect(handleConfirmation(request)).rejects.toThrow();
    expect(
      await prisma.booking.findUnique({ where: { id: request.bookingId }, select: { status: true } })
    ).toEqual({ status: "CANCELLED" });
    expect(effects.email).not.toHaveBeenCalled();
  });
}, 60000);

it("does not retry a claimed confirmation after an uncertain provider failure", async () => {
  await withScenario(async ({ pending }) => {
    const request = await pending(0);
    effects.create.mockRejectedValueOnce(new Error("Provider response lost"));
    await expect(handleConfirmation(request)).rejects.toThrow("Provider response lost");
    await expect(handleConfirmation(request)).rejects.toThrow();
    expect(effects.create).toHaveBeenCalledTimes(1);
    expect(effects.email).not.toHaveBeenCalled();
    expect(
      await prisma.booking.findUnique({ where: { id: request.bookingId }, select: { status: true } })
    ).toEqual({ status: "ACCEPTED" });
  });
}, 60000);
