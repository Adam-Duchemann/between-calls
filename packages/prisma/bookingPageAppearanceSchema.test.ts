import {
  updateUserMetadataAllowedKeys,
  ZUpdateProfileInputSchema,
} from "@calcom/trpc/server/routers/viewer/me/updateProfile.schema";
import { describe, expect, it } from "vitest";
import {
  TEAL_BOOKING_APPEARANCE,
  bookingPageAppearanceSchema,
  contrastRatio,
} from "./bookingPageAppearanceSchema";
import { userMetadata } from "./zod-utils";

describe("guest booking appearance", () => {
  it("accepts the verified website palette and readable foreground colours", () => {
    expect(bookingPageAppearanceSchema.parse(TEAL_BOOKING_APPEARANCE)).toEqual(TEAL_BOOKING_APPEARANCE);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#176B68", "#F6F3EC")).toBeGreaterThan(4.5);
  });
  it.each([
    "red",
    "#FFF;background:url(https://evil.test)",
    "var(--x)",
  ])("rejects unsafe colour %s", (accent) => {
    expect(bookingPageAppearanceSchema.safeParse({ ...TEAL_BOOKING_APPEARANCE, accent }).success).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//evil.test/a.png",
    "http://example.com/logo.png",
    "https://user:password@example.com/logo.png",
  ])("rejects unsafe logo %s", (logoUrl) => {
    expect(bookingPageAppearanceSchema.safeParse({ ...TEAL_BOOKING_APPEARANCE, logoUrl }).success).toBe(
      false
    );
  });
  it("rejects unreadable text and arbitrary CSS/font settings", () => {
    expect(
      bookingPageAppearanceSchema.safeParse({ ...TEAL_BOOKING_APPEARANCE, text: "#F6F3EC" }).success
    ).toBe(false);
    expect(
      bookingPageAppearanceSchema.safeParse({ ...TEAL_BOOKING_APPEARANCE, headingFont: "url(evil)" }).success
    ).toBe(false);
    expect(
      bookingPageAppearanceSchema.safeParse({ ...TEAL_BOOKING_APPEARANCE, css: "body{display:none}" }).success
    ).toBe(false);
  });
  it("round-trips settings through the persisted metadata and allowed update schema", () => {
    const metadata = {
      bookingPageAppearance: TEAL_BOOKING_APPEARANCE,
      defaultBookerLayouts: null,
      sessionTimeout: 60,
    };
    const parsed = userMetadata.parse(metadata);
    expect(updateUserMetadataAllowedKeys.parse(parsed)).toEqual(metadata);
    expect(ZUpdateProfileInputSchema.parse({ metadata })).toEqual({ metadata });
  });
  it("allows clearing the custom theme without changing dashboard or legacy brand settings", () => {
    expect(ZUpdateProfileInputSchema.parse({ metadata: { bookingPageAppearance: null } })).toEqual({
      metadata: { bookingPageAppearance: null },
    });
  });
  it("does not accept privileged metadata as a profile appearance update", () => {
    expect(
      updateUserMetadataAllowedKeys.parse({
        bookingPageAppearance: TEAL_BOOKING_APPEARANCE,
        isPremium: true,
        stripeCustomerId: "other",
      })
    ).toEqual({ bookingPageAppearance: TEAL_BOOKING_APPEARANCE });
  });
});
