import type { PrismaClient } from "@calcom/prisma";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { updateHandler } from "./update.handler";
import type { TUpdateInputSchema } from "./update.schema";

vi.mock("@calcom/features/hashedLink/lib/repository/HashedLinkRepository", () => ({
  HashedLinkRepository: { create: () => ({ findLinksByEventTypeId: async () => [] }) },
}));
vi.mock("@calcom/features/hashedLink/lib/service/HashedLinkService", () => ({
  HashedLinkService: class {
    handleMultiplePrivateLinks = vi.fn();
  },
}));

function createContext() {
  const prisma = mockDeep<PrismaClient>();
  prisma.eventType.findUniqueOrThrow.mockResolvedValue({
    title: "Intro",
    teamId: null,
    parentId: null,
    schedulingType: null,
    recurringEvent: null,
    seatsPerTimeSlot: null,
    calVideoSettings: null,
    hostGroups: [],
    fieldTranslations: [],
  } as Awaited<ReturnType<PrismaClient["eventType"]["findUniqueOrThrow"]>>);
  prisma.eventType.update.mockResolvedValue(
    mockDeep<Awaited<ReturnType<PrismaClient["eventType"]["update"]>>>({ slug: "intro" })
  );
  prisma.hostGroup.findMany.mockResolvedValue([]);
  return {
    prisma,
    user: {
      id: 7,
      username: "owner",
      profile: { id: null },
      userLevelSelectedCalendars: [],
      organizationId: null,
      email: "owner@example.test",
      locale: "en",
    },
  };
}

describe("private event type updates", () => {
  beforeEach(() => vi.stubEnv("CAL_PRIVATE_INSTANCE", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it.each<Partial<TUpdateInputSchema>>([
    { teamId: 42 },
    { schedulingType: "ROUND_ROBIN" },
    { parentId: 42 },
    { profileId: 42 },
    { assignAllTeamMembers: true },
  ])("rejects team or organization routing fields before saving", async (changes) => {
    const ctx = createContext();
    await expect(updateHandler({ ctx, input: { id: 1, ...changes } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(ctx.prisma.eventType.update).not.toHaveBeenCalled();
  });

  it.each<Partial<TUpdateInputSchema>>([
    { schedule: 99 },
    { scheduleId: 99 },
    { instantMeetingSchedule: 99 },
    { instantMeetingScheduleId: 99 },
    { restrictionScheduleId: 99 },
  ])("rejects a foreign schedule through either accepted field name", async (changes) => {
    const ctx = createContext();
    ctx.prisma.schedule.findMany.mockResolvedValue([]);
    await expect(updateHandler({ ctx, input: { id: 1, ...changes } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(ctx.prisma.eventType.update).not.toHaveBeenCalled();
  });

  it("saves a named schedule and look-busy settings through the normal personal editor", async () => {
    const ctx = createContext();
    ctx.prisma.schedule.findMany.mockResolvedValue([
      mockDeep<Awaited<ReturnType<PrismaClient["schedule"]["findMany"]>>[number]>({ id: 12 }),
    ]);
    await updateHandler({
      ctx,
      input: {
        id: 1,
        title: "Updated intro",
        schedule: 12,
        users: [7],
        schedulingType: null,
        hostGroups: [],
        hosts: [],
        children: [],
        assignAllTeamMembers: false,
        metadata: { lookBusy: { mode: "day", count: 5 } },
      },
    });
    expect(ctx.prisma.schedule.findMany).toHaveBeenCalledWith({
      where: { id: { in: [12] }, userId: 7 },
      select: { id: true },
    });
    expect(ctx.prisma.eventType.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          title: "Updated intro",
          schedule: { connect: { id: 12 } },
          metadata: { lookBusy: { mode: "day", count: 5 } },
        }),
      })
    );
  });
});
