import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReviewData, ReviewView } from "./ReviewView";

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, values?: object) => (values ? `${key} ${JSON.stringify(values)}` : key),
  }),
}));
const review: ReviewData = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  status: "PENDING",
  result: null,
  expiresAt: "2099-01-01T00:00:00Z",
  confirmationToken: "a".repeat(64),
  payload: {
    action: {
      kind: "event_type_update",
      eventTypeId: 1,
      changes: { lookBusy: { mode: "percentage", percentage: 66 } },
    },
    expectedState: "b".repeat(64),
    summary: "Update Intro call",
  },
};
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});
describe("trusted change review", () => {
  it("shows the exact effect and account without submitting anything", () => {
    render(<ReviewView review={review} accountEmail="owner@example.test" timeZone="Indian/Reunion" />);
    expect(screen.getByText("Update Intro call")).toBeTruthy();
    expect(screen.getByText("owner@example.test")).toBeTruthy();
    expect(screen.getByText(/look_busy_hide_percentage.*66/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["approve", "decline"] as const)("submits only a proof and decision after %s", async (decision) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ result: { id: 1 } }));
    render(<ReviewView review={review} timeZone="UTC" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: decision === "approve" ? "mcp_approve_change" : "mcp_decline_change",
      })
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/mcp/proposals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          proposalId: review.id,
          confirmationToken: review.confirmationToken,
          decision,
        }),
      })
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "mcp_approve_change" })).toBeNull());
  });
  it("removes approval for expired, consumed or unavailable requests", () => {
    const { rerender } = render(
      <ReviewView review={{ ...review, expiresAt: "2000-01-01T00:00:00Z" }} timeZone="UTC" />
    );
    expect(screen.queryByRole("button", { name: "mcp_approve_change" })).toBeNull();
    rerender(
      <ReviewView review={{ ...review, status: "SUCCEEDED", confirmationToken: null }} timeZone="UTC" />
    );
    expect(screen.queryByRole("button", { name: "mcp_approve_change" })).toBeNull();
    rerender(<ReviewView timeZone="UTC" />);
    expect(screen.queryByRole("button", { name: "mcp_approve_change" })).toBeNull();
  });
  it("does not offer an automatic retry after an uncertain execution error", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "mcp_change_failed" }, { status: 400 }));
    render(<ReviewView review={review} timeZone="UTC" />);
    fireEvent.click(screen.getByRole("button", { name: "mcp_approve_change" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("mcp_review_failed"));
    expect(screen.queryByRole("button", { name: "mcp_approve_change" })).toBeNull();
  });
});
