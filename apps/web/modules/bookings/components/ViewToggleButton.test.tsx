import { TooltipProvider } from "@radix-ui/react-tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewToggleButton } from "./ViewToggleButton";

const { setView } = vi.hoisted(() => ({ setView: vi.fn() }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string) =>
      (({ list_view: "List view", calendar_view: "Calendar view" }) as Record<string, string>)[key] ?? key,
  }),
}));
vi.mock("@calcom/lib/hooks/useMediaQuery", () => ({ default: () => false }));
vi.mock("../hooks/useBookingsView", () => ({ useBookingsView: () => ["calendar", setView] }));
describe("booking view selection", () => {
  it("shows named views and lets the host return to the booking list", () => {
    render(
      <TooltipProvider>
        <ViewToggleButton bookingsV3Enabled />
      </TooltipProvider>
    );
    const list = screen.getByRole("radio", { name: "List view" });
    expect(screen.getByRole("radio", { name: "Calendar view" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(list);
    expect(setView).toHaveBeenCalledWith("list");
  });
});
