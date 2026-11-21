import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AboutView, { UPSTREAM_LICENSE } from "./about-view";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
describe("About attribution", () => {
  it("retains the complete upstream licence and identifies the original project", () => {
    expect(UPSTREAM_LICENSE.trim()).toBe(readFileSync("LICENSE", "utf8").trim());
    render(<AboutView />);
    expect(screen.getByRole("link", { name: "Cal.diy" })).toHaveAttribute(
      "href",
      "https://github.com/calcom/cal.diy"
    );
    expect(screen.getByText(/Copyright \(c\) 2020-present Cal.com, Inc./)).toBeInTheDocument();
  });
});
