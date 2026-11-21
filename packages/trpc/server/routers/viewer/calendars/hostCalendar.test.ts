import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostCalendarHandler } from "./hostCalendar.handler";
import { hostCalendarSchema } from "./hostCalendar.schema";

const mocks = vi.hoisted(() => ({
  selected: vi.fn(),
  credentials: vi.fn(),
  bookings: vi.fn(),
  events: vi.fn(),
}));
vi.mock("@calcom/prisma", () => ({
  prisma: {
    selectedCalendar: { findMany: mocks.selected },
    credential: { findMany: mocks.credentials },
    booking: { findMany: mocks.bookings },
  },
}));
vi.mock("@calcom/app-store/googlecalendar/lib/CalendarService", () => ({
  createGoogleCalendarServiceWithGoogleType: () => ({ getCalendarEvents: mocks.events }),
}));
const input = { dateFrom: "2026-11-16T00:00:00Z", dateTo: "2026-11-23T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selected.mockResolvedValue([{ credentialId: 1, externalId: "work" }]);
  mocks.credentials.mockResolvedValue([
    {
      id: 1,
      invalid: false,
      key: { access_token: "PRIVATE_TEST_TOKEN" },
      user: { email: "owner@example.test" },
    },
  ]);
  mocks.bookings.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
});

describe("private host calendar", () => {
  it("scopes every database read to the authenticated owner and never returns credentials", async () => {
    const result = await hostCalendarHandler({ ctx: { user: { id: 7 } }, input });
    expect(mocks.selected).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 7 }) })
    );
    expect(mocks.credentials).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 7 }) })
    );
    expect(mocks.bookings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 7,
          startTime: { lt: new Date(input.dateTo) },
          endTime: { gt: new Date(input.dateFrom) },
        }),
      })
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST_TOKEN");
    expect(result.sources[0]).toMatchObject({ status: "ok", externalId: "work" });
  });
  it("rejects credentials outside the owner before any provider request", async () => {
    await expect(
      hostCalendarHandler({
        ctx: { user: { id: 7 } },
        input: { ...input, calendars: [{ credentialId: 99, externalId: "private" }] },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.events).not.toHaveBeenCalled();
  });
  it("keeps provider failures visible while returning unaffected sources", async () => {
    mocks.selected.mockResolvedValue([
      { credentialId: 1, externalId: "broken" },
      { credentialId: 1, externalId: "work" },
    ]);
    mocks.events.mockImplementation(async ({ calendarId }) => {
      if (calendarId === "broken") throw new Error("Provider error with private data");
      return [];
    });
    const result = await hostCalendarHandler({ ctx: { user: { id: 7 } }, input });
    expect(result.sources.map((source) => source.status)).toEqual(["error", "ok"]);
    expect(JSON.stringify(result)).not.toContain("private data");
  });
  it("bounds date ranges and explicit calendar selection", () => {
    expect(hostCalendarSchema.safeParse(input).success).toBe(true);
    expect(hostCalendarSchema.safeParse({ ...input, dateTo: input.dateFrom }).success).toBe(false);
    expect(hostCalendarSchema.safeParse({ ...input, dateTo: "2027-11-23T00:00:00Z" }).success).toBe(false);
    expect(
      hostCalendarSchema.safeParse({
        ...input,
        calendars: Array.from({ length: 33 }, () => ({ credentialId: 1, externalId: "work" })),
      }).success
    ).toBe(false);
  });
});
