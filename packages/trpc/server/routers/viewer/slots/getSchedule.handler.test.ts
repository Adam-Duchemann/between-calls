import type { IncomingMessage } from "node:http";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getAvailableSlotsService } from "@calcom/features/di/containers/AvailableSlots";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getScheduleHandler } from "./getSchedule.handler";

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("@calcom/features/di/containers/AvailableSlots", () => ({ getAvailableSlotsService: vi.fn() }));

const input = {
  eventTypeId: 1,
  startTime: "2026-11-16T00:00:00Z",
  endTime: "2026-11-16T23:59:59Z",
  isTeamEvent: false,
};
const req = { headers: {}, cookies: {} } as IncomingMessage & { cookies: Record<string, string> };

describe("public availability with an optional authenticated session", () => {
  const getAvailableSlots = vi.fn().mockResolvedValue({ slots: {} });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAvailableSlotsService).mockReturnValue({ getAvailableSlots } as unknown as ReturnType<
      typeof getAvailableSlotsService
    >);
  });

  it("loads the signed-in owner through the trusted session verifier", async () => {
    const session = { user: { id: 12 } } as NonNullable<Awaited<ReturnType<typeof getServerSession>>>;
    vi.mocked(getServerSession).mockResolvedValue(session);
    await getScheduleHandler({ input, ctx: { req, session: null } });
    expect(getServerSession).toHaveBeenCalledWith({ req });
    expect(getAvailableSlots).toHaveBeenCalledWith({ input, ctx: { req, session } });
  });

  it("allows anonymous requests without granting an owner bypass", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    await getScheduleHandler({ input, ctx: { req } });
    expect(getAvailableSlots).toHaveBeenCalledWith({ input, ctx: { req, session: null } });
  });

  it("prevents browsers and proxies from sharing personalized offerings", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = { setHeader: vi.fn() };
    await getScheduleHandler({ input, ctx: { req, res } });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
});
