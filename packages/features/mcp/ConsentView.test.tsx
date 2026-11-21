import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentView } from "./ConsentView";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
const review = {
  authorizationId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  clientName: "My assistant",
  expiresAt: "2026-11-13T10:15:00Z",
  consentToken: "a".repeat(64),
  request: {
    client_id: "client",
    response_type: "code" as const,
    redirect_uri: "https://client.example.test/callback",
    resource: "https://cal.test/api/mcp",
    scope: "cal:read cal:propose",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256" as const,
  },
};
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

describe("AI assistant consent", () => {
  it("shows the account, app, exact return address and requested capabilities without granting access", () => {
    render(<ConsentView review={review} accountEmail="owner@example.test" />);
    expect(screen.getByText("My assistant")).toBeTruthy();
    expect(screen.getByText("owner@example.test")).toBeTruthy();
    expect(screen.getByText(review.request.redirect_uri)).toBeTruthy();
    expect(screen.getByText("mcp_permission_read")).toBeTruthy();
    expect(screen.getByText("mcp_permission_propose")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "approve",
    "decline",
  ] as const)("submits %s only after its button is pressed and reports failures", async (decision) => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 400 }));
    render(<ConsentView review={review} accountEmail="owner@example.test" />);
    fireEvent.click(screen.getByRole("button", { name: decision === "approve" ? "mcp_connect" : "cancel" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("mcp_request_failed"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/consent",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ decision, review }) })
    );
  });

  it("does not offer approval for an invalid request", () => {
    render(<ConsentView />);
    expect(screen.getByRole("alert").textContent).toContain("mcp_request_failed");
    expect(screen.queryByRole("button", { name: "mcp_connect" })).not.toBeTruthy();
  });
});
