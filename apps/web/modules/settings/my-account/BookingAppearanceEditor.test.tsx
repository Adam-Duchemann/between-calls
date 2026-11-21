import { TEAL_BOOKING_APPEARANCE } from "@calcom/prisma/bookingPageAppearanceSchema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookingAppearanceEditor } from "./BookingAppearanceEditor";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

describe("booking page editor", () => {
  it("previews edits without saving and resets to the saved version", () => {
    const save = vi.fn();
    render(<BookingAppearanceEditor value={TEAL_BOOKING_APPEARANCE} onSave={save} />);
    fireEvent.change(screen.getByLabelText("booking_appearance_brand_name"), {
      target: { value: "Meet the host" },
    });
    expect(screen.getByText("Meet the host")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(screen.getByLabelText("booking_appearance_brand_name")).toHaveValue("Between Calls");
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });
  it("saves only on explicit submission", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<BookingAppearanceEditor value={TEAL_BOOKING_APPEARANCE} onSave={save} />);
    fireEvent.change(screen.getByLabelText("booking_appearance_brand_name"), {
      target: { value: "Meet the host" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ ...TEAL_BOOKING_APPEARANCE, brandName: "Meet the host" })
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeDisabled());
  });
  it("keeps edits when saving fails", async () => {
    render(
      <BookingAppearanceEditor
        value={TEAL_BOOKING_APPEARANCE}
        onSave={vi.fn().mockRejectedValue(new Error("offline"))}
      />
    );
    fireEvent.change(screen.getByLabelText("booking_appearance_brand_name"), {
      target: { value: "Keep my draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText("booking_appearance_brand_name")).toHaveValue("Keep my draft");
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
  });
  it("prevents saving unreadable combinations", () => {
    render(<BookingAppearanceEditor value={TEAL_BOOKING_APPEARANCE} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("booking_appearance_text"), { target: { value: "#F6F3EC" } });
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("booking_appearance_text_contrast");
  });
  it("preserves the current draft when website import fails", async () => {
    const save = vi.fn();
    render(
      <BookingAppearanceEditor
        value={{ ...TEAL_BOOKING_APPEARANCE, websiteUrl: "https://example.com" }}
        onSave={save}
        onImport={vi.fn().mockRejectedValue(new Error("unavailable"))}
      />
    );
    fireEvent.change(screen.getByLabelText("booking_appearance_brand_name"), {
      target: { value: "My draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "booking_appearance_import" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByLabelText("booking_appearance_brand_name")).toHaveValue("My draft");
    expect(screen.getByLabelText("booking_appearance_accent")).toHaveValue(
      TEAL_BOOKING_APPEARANCE.accent.toLowerCase()
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("imports into the draft without publishing and supports mobile preview", async () => {
    const save = vi.fn();
    const suggest = vi.fn().mockResolvedValue({ accent: "#334455" });
    render(
      <BookingAppearanceEditor
        value={{ ...TEAL_BOOKING_APPEARANCE, websiteUrl: "https://example.com" }}
        onSave={save}
        onImport={suggest}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "booking_appearance_import" }));
    await waitFor(() => expect(screen.getByLabelText("booking_appearance_accent")).toHaveValue("#334455"));
    expect(suggest).toHaveBeenCalledWith("https://example.com");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "booking_appearance_mobile" }));
    expect(screen.getByRole("button", { name: "booking_appearance_mobile" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(document.body).not.toHaveAttribute("data-cal-booking-theme");
  });
});
