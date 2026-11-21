import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@calcom/prisma";
import { createHandler } from "./create.handler";

const mocks = vi.hoisted(() => ({ create: vi.fn(), defaultLocations: vi.fn() }));
vi.mock("@calcom/features/eventtypes/repositories/eventTypeRepository", () => ({
  EventTypeRepository: class {
    create = mocks.create;
  },
}));
vi.mock("@calcom/app-store/_utils/getDefaultLocations", () => ({
  getDefaultLocations: mocks.defaultLocations,
}));
beforeEach(() => {
  vi.stubEnv("CAL_PRIVATE_INSTANCE", "true");
  mocks.create.mockReset().mockResolvedValue({ id: 2 });
  mocks.defaultLocations.mockReset().mockResolvedValue([{ type: "inPerson", address: "Office" }]);
});
afterEach(() => vi.unstubAllEnvs());
function context() {
  return {
    prisma: mockDeep<PrismaClient>(),
    user: {
      id: 7,
      role: "USER" as const,
      organizationId: null,
      organization: { isOrgAdmin: false },
      profile: { id: null },
      metadata: {},
      email: "owner@example.test",
    },
  };
}
const input = { title: "Intro", slug: "intro", length: 30 };
describe("private event creation", () => {
  it("applies CAL defaults to types created from the website", async () => {
    await createHandler({ ctx: context(), input });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumBookingNotice: 240,
        afterEventBuffer: 15,
        beforeEventBuffer: 0,
        periodType: "ROLLING",
        periodDays: 30,
        periodCountCalendarDays: true,
        bookingLimits: { PER_DAY: 4 },
        requiresConfirmation: false,
        disableGuests: true,
        locations: [{ type: "integrations:google:meet" }],
        metadata: { lookBusy: { mode: "off" } },
        owner: { connect: { id: 7 } },
        users: { connect: { id: 7 } },
      })
    );
  });
  it("preserves explicit settings when creating another meeting type", async () => {
    await createHandler({
      ctx: context(),
      input: {
        ...input,
        afterEventBuffer: 0,
        locations: [{ type: "inPerson", address: "Office" }],
        metadata: { lookBusy: { mode: "percentage", percentage: 66 } },
      },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        afterEventBuffer: 0,
        locations: [{ type: "inPerson", address: "Office" }],
        metadata: { lookBusy: { mode: "percentage", percentage: 66 } },
      })
    );
  });
  it("rejects another account's schedule", async () => {
    const ctx = context();
    ctx.prisma.schedule.findFirst.mockResolvedValue(null);
    await expect(createHandler({ ctx, input: { ...input, scheduleId: 99 } })).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps team creation unavailable in private v1", async () => {
    await expect(
      createHandler({ ctx: context(), input: { ...input, teamId: 99, schedulingType: "ROUND_ROBIN" } })
    ).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
