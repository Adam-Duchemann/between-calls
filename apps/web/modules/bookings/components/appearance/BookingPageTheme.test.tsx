import { TEAL_BOOKING_APPEARANCE } from "@calcom/prisma/bookingPageAppearanceSchema";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BookingPageBrand, BookingPageTheme } from "./BookingPageTheme";

afterEach(() => {
  document.body.removeAttribute("style");
  document.body.removeAttribute("data-cal-booking-theme");
});
describe("booking-only appearance", () => {
  it("keeps preview styles local to the preview", () => {
    render(
      <BookingPageTheme appearance={TEAL_BOOKING_APPEARANCE}>
        <p>Preview</p>
      </BookingPageTheme>
    );
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("");
    expect(screen.getByText("Preview").parentElement?.style.getPropertyValue("--cal-brand")).toBe("#176B68");
  });
  it("themes portal content on the actual booking page and restores the dashboard styles on exit", () => {
    document.body.style.setProperty("--cal-brand", "#123456", "important");
    document.body.style.backgroundColor = "rgb(1, 2, 3)";
    const { unmount } = render(
      <BookingPageTheme appearance={TEAL_BOOKING_APPEARANCE} documentTheme>
        <p>Booking</p>
      </BookingPageTheme>
    );
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("#176B68");
    expect(document.body).toHaveAttribute("data-cal-booking-theme", "true");
    unmount();
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("#123456");
    expect(document.body.style.getPropertyPriority("--cal-brand")).toBe("important");
    expect(document.body.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
  });
  it("restores original styles after switching colours repeatedly", () => {
    const { rerender, unmount } = render(
      <BookingPageTheme appearance={TEAL_BOOKING_APPEARANCE} documentTheme>
        Booking
      </BookingPageTheme>
    );
    rerender(
      <BookingPageTheme appearance={{ ...TEAL_BOOKING_APPEARANCE, accent: "#334455" }} documentTheme>
        Booking
      </BookingPageTheme>
    );
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("#334455");
    unmount();
    expect(document.body.style.getPropertyValue("--cal-brand")).toBe("");
  });
  it("leaves existing themes intact when custom appearance is disabled", () => {
    render(
      <BookingPageTheme appearance={{ ...TEAL_BOOKING_APPEARANCE, enabled: false }} documentTheme>
        Legacy booking
      </BookingPageTheme>
    );
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
    expect(document.querySelector(".cal-booking-theme")).toBeNull();
  });
  it("shows the configured brand and home link without changing the meeting title", () => {
    render(
      <BookingPageBrand
        appearance={{
          ...TEAL_BOOKING_APPEARANCE,
          brandName: "Meet the host",
          websiteUrl: "https://example.com",
        }}
      />
    );
    expect(screen.getByRole("link", { name: "Meet the host" })).toHaveAttribute(
      "href",
      "https://example.com"
    );
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/cal-com-icon.svg");
  });
});
