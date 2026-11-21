import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import translations from "../../../../packages/i18n/locales/en/common.json";
import Privacy from "../cal-privacy/page";
import Terms from "../cal-terms/page";
import Info from "./page";

vi.mock("@calcom/lib/constants", () => ({ APP_NAME: "Between Calls", LOGO_ICON: "/cal-com-icon.svg" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("app/_utils", () => ({
  getTranslate: async () => (key: string) => translations[key as keyof typeof translations] ?? key,
}));

describe("reviewed public information", () => {
  beforeEach(() => vi.stubEnv("CAL_PUBLIC_INFORMATION_ENABLED", ""));
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it.each([Info, Privacy, Terms])("keeps unpublished documents inaccessible by default", async (Page) => {
    await expect(Page()).rejects.toThrow("not found");
  });

  it.each([
    [Info, "App information"],
    [Privacy, "Privacy notice"],
    [Terms, "Booking terms"],
  ] as const)("renders approved content without requiring a guest account", async (Page, title) => {
    vi.stubEnv("CAL_PUBLIC_INFORMATION_ENABLED", "true");
    vi.stubEnv("CAL_PUBLIC_CONTACT_EMAIL", "host@example.com");
    render(await Page());
    expect(screen.getByRole("link", { name: "Between Calls" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    for (const [name, path] of [
      ["App information", "/cal-info"],
      ["Privacy notice", "/cal-privacy"],
      ["Booking terms", "/cal-terms"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", path);
    }
    expect(screen.getByRole("link", { name: "host@example.com" })).toHaveAttribute(
      "href",
      "mailto:host@example.com"
    );
    expect(screen.queryByText(/not published and are not an active agreement/)).not.toBeInTheDocument();
  });

  it("describes operator-dependent retention alongside provider and assistant data use", async () => {
    vi.stubEnv("CAL_PUBLIC_INFORMATION_ENABLED", "true");
    render(await Privacy());
    expect(screen.getByText(/backup retention depend/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "host@example.com" })).not.toBeInTheDocument();
    expect(screen.getByText(/no configured automatic expiry/)).toBeInTheDocument();
    expect(screen.getByText(/subject to its policies and account settings/)).toBeInTheDocument();
  });
});
