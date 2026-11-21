import { ErrorCode } from "@calcom/lib/errorCodes";
import type { PrismaClient } from "@calcom/prisma";
import { expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { ScheduleService } from "./ScheduleService";

vi.mock("@calcom/lib/hasEditPermissionForUser", () => ({
  hasEditPermissionForUserID: vi.fn().mockResolvedValue(false),
}));

it("rejects another owner's schedule before any write with an explicit forbidden error", async () => {
  const prisma = mockDeep<PrismaClient>();
  prisma.schedule.findUnique.mockResolvedValue({ id: 1, name: "Work", userId: 1, timeZone: "UTC" });
  await expect(
    new ScheduleService(prisma).update({
      input: { scheduleId: 1, name: "Attempt" },
      user: { id: 2, defaultScheduleId: null, timeZone: "UTC" },
    })
  ).rejects.toMatchObject({ code: ErrorCode.Forbidden });
  expect(prisma.schedule.update).not.toHaveBeenCalled();
  expect(prisma.user.update).not.toHaveBeenCalled();
});
