import { describe, expect, it } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { Prisma, User, Schedule } from "@calcom/prisma/client";
import { createInitialAdmin } from "./createInitialAdmin";

const input = {
  username: "owner",
  email: "owner@example.test",
  name: "Owner",
  passwordHash: "hashed-password",
  privateInstance: true,
};
function setup() {
  const tx = mockDeep<Prisma.TransactionClient>();
  tx.user.count.mockResolvedValue(0);
  tx.user.create.mockResolvedValue(mockDeep<User>({ id: 7 }));
  tx.schedule.create.mockResolvedValue(mockDeep<Schedule>({ id: 8 }));
  return tx;
}
describe("initial private account", () => {
  it("creates the owner, Reunion workweek and first meeting type together", async () => {
    const tx = setup();
    await createInitialAdmin(tx, input);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: input.email,
          role: "ADMIN",
          timeZone: "UTC",
          completedOnboarding: true,
          password: { create: { hash: input.passwordHash } },
        }),
      })
    );
    expect(tx.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 7,
          timeZone: "UTC",
          availability: {
            create: {
              days: [1, 2, 3, 4, 5],
              startTime: new Date("1970-01-01T09:00:00Z"),
              endTime: new Date("1970-01-01T17:00:00Z"),
            },
          },
        }),
      })
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { defaultScheduleId: 8 },
      select: { id: true },
    });
    expect(tx.eventType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "30min",
          length: 30,
          userId: 7,
          users: { connect: { id: 7 } },
          scheduleId: 8,
          bookingLimits: { PER_DAY: 4 },
          locations: [{ type: "integrations:google:meet" }],
        }),
      })
    );
  });
  it("refuses an initialized instance without modifying accounts", async () => {
    const tx = setup();
    tx.user.count.mockResolvedValue(1);
    await expect(createInitialAdmin(tx, input)).rejects.toThrow("No setup needed");
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.eventType.create).not.toHaveBeenCalled();
  });
  it("retains ordinary onboarding outside private mode", async () => {
    const tx = setup();
    await createInitialAdmin(tx, { ...input, privateInstance: false });
    expect(tx.schedule.create).not.toHaveBeenCalled();
    expect(tx.eventType.create).not.toHaveBeenCalled();
    expect(tx.user.create.mock.calls[0][0].data.completedOnboarding).toBeUndefined();
  });
});
