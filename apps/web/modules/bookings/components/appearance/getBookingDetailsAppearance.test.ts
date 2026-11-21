import { TEAL_BOOKING_APPEARANCE } from "@calcom/prisma/bookingPageAppearanceSchema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBookingDetailsAppearance } from "./getBookingDetailsAppearance";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@calcom/prisma", () => ({ default: { user: { findUnique } } }));
beforeEach(() => findUnique.mockReset());
describe("booking details appearance data", () => {
  it("returns only the validated public design from owner metadata", async () => {
    findUnique.mockResolvedValue({
      metadata: { bookingPageAppearance: TEAL_BOOKING_APPEARANCE, privateValue: "must not escape" },
    });
    expect(await getBookingDetailsAppearance({ ownerId: 12, isPersonal: true })).toEqual(
      TEAL_BOOKING_APPEARANCE
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 12 }, select: { metadata: true } });
  });
  it("does not load a personal design for teams, organizations or platform events", async () => {
    expect(await getBookingDetailsAppearance({ ownerId: 12, isPersonal: false })).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { metadata: {} },
    { metadata: { bookingPageAppearance: { ...TEAL_BOOKING_APPEARANCE, logoUrl: "javascript:alert(1)" } } },
  ])("ignores missing and invalid appearance: %o", async (owner) => {
    findUnique.mockResolvedValue(owner);
    expect(await getBookingDetailsAppearance({ ownerId: 12, isPersonal: true })).toBeNull();
  });
});
