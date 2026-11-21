import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Credits from "./Credits";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: () => "About" }) }));
describe("attribution navigation", () => {
  it("links to local About instead of displaying upstream branding in the sidebar", () => {
    render(<Credits />);
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/settings/my-account/about");
    expect(screen.queryByText(/Cal\.com|Cal\.diy/)).not.toBeInTheDocument();
  });
});
