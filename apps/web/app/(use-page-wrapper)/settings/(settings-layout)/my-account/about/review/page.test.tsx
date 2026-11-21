import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import translations from "../../../../../../../../../packages/i18n/locales/en/common.json";
import Page, { metadata } from "./page";

const mocks = vi.hoisted(() => ({ session: vi.fn(), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: mocks.session }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("app/_utils", () => ({
  getTranslate: async () => (key: string) => translations[key as keyof typeof translations] ?? key,
}));
vi.mock("@calcom/ui/components/logo", () => ({ Logo: () => <span>Between Calls</span> }));

describe("private information review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CAL_PUBLIC_INFORMATION_ENABLED", "");
    vi.stubEnv("CAL_PUBLIC_CONTACT_EMAIL", "host@example.com");
    mocks.redirect.mockImplementation(() => {
      throw new Error("login redirect");
    });
    mocks.notFound.mockImplementation(() => {
      throw new Error("not found");
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("identifies the documents as published after publication is enabled", async () => {
    vi.stubEnv("CAL_PUBLIC_INFORMATION_ENABLED", "true");
    mocks.session.mockResolvedValue({ user: { id: 1, role: "ADMIN" } });
    render(await Page());
    expect(screen.getByText(/These documents are published/)).toBeInTheDocument();
    expect(screen.queryByText(/not published and are not an active agreement/)).not.toBeInTheDocument();
  });
  it("requires a signed-in host before rendering drafts", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("login redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("/auth/login?callbackUrl="));
  });
  it("does not expose installation review to ordinary future team users", async () => {
    mocks.session.mockResolvedValue({ user: { id: 2, role: "USER" } });
    await expect(Page()).rejects.toThrow("not found");
  });
  it("shows all drafts, material data practices and review status to the administrator", async () => {
    mocks.session.mockResolvedValue({ user: { id: 1, role: "ADMIN" } });
    render(await Page());
    for (const name of ["App information", "Privacy notice", "Booking terms"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/not published and are not an active agreement/)).toBeInTheDocument();
    expect(screen.getByText(/no configured automatic expiry/)).toBeInTheDocument();
    expect(screen.getByText(/subject to its policies and account settings/)).toBeInTheDocument();
    expect(screen.getByText(/does not erase previously created Google events/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "host@example.com" })).toHaveAttribute(
      "href",
      "mailto:host@example.com"
    );
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
