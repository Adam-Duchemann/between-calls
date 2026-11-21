import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HostCalendarLayers } from "./HostCalendarLayers";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

it("shows per-source failures and lets the host toggle layers or retry", () => {
  const toggle = vi.fn();
  const retry = vi.fn();
  render(
    <HostCalendarLayers
      sources={[
        { id: "work", externalId: "Work calendar", status: "error" },
        { id: "home", externalId: "Home calendar", status: "ok" },
      ]}
      hidden={[]}
      onToggle={toggle}
      onRetry={retry}
      loading={false}
      error={false}
    />
  );
  expect(screen.getByText("host_calendar_source_error")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Home calendar"));
  expect(toggle).toHaveBeenCalledWith("home");
  fireEvent.click(screen.getByRole("button", { name: "retry" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("bookings")).toBeChecked();
});
