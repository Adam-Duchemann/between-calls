import { TEAL_BOOKING_APPEARANCE } from "@calcom/prisma/bookingPageAppearanceSchema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingDetailsAppearance } from "./BookingDetailsAppearance";

describe("guest booking details branding", () => {
  it("uses saved branding for confirmation and cancellation details", () => {
    const { unmount } = render(
      <BookingDetailsAppearance
        appearance={{ ...TEAL_BOOKING_APPEARANCE, websiteUrl: "https://example.com" }}
        isEmbed={false}
        isHostView={false}
        hideBranding={false}>
        <h1>Booking cancelled</h1>
      </BookingDetailsAppearance>
    );
    expect(screen.getByRole("link", { name: "Between Calls" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("#176B68");
    expect(screen.getByRole("heading", { name: "Booking cancelled" })).toBeInTheDocument();
    unmount();
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
  });
  it.each([
    { isHostView: true, isEmbed: false },
    { isHostView: false, isEmbed: true },
  ])("keeps host and embed views independent: %o", (scope) => {
    render(
      <BookingDetailsAppearance
        appearance={{ ...TEAL_BOOKING_APPEARANCE, websiteUrl: "https://example.com" }}
        {...scope}
        hideBranding={false}>
        Details
      </BookingDetailsAppearance>
    );
    expect(screen.queryByRole("link", { name: "Between Calls" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
  });
  it("respects hidden branding while retaining the requested page colours", () => {
    render(
      <BookingDetailsAppearance
        appearance={{ ...TEAL_BOOKING_APPEARANCE, websiteUrl: "https://example.com" }}
        isEmbed={false}
        isHostView={false}
        hideBranding>
        Details
      </BookingDetailsAppearance>
    );
    expect(screen.queryByRole("link", { name: "Between Calls" })).not.toBeInTheDocument();
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("#176B68");
  });
  it("leaves platform and unconfigured pages unchanged", () => {
    render(
      <BookingDetailsAppearance appearance={null} isEmbed={false} isHostView={false} hideBranding={false}>
        Details
      </BookingDetailsAppearance>
    );
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
