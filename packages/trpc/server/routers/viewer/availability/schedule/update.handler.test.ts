import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { expect, it, vi } from "vitest";
import { updateHandler } from "./update.handler";

vi.mock("@calcom/features/schedules/services/ScheduleService", () => ({
  updateSchedule: vi.fn(async () => {
    throw new ErrorWithCode(ErrorCode.Forbidden, "Unauthorized");
  }),
}));

it("reports denied schedule edits as forbidden instead of an internal server failure", async () => {
  await expect(
    updateHandler({
      ctx: { user: { id: 2, defaultScheduleId: null, timeZone: "UTC" } },
      input: { scheduleId: 1, name: "Attempt" },
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
