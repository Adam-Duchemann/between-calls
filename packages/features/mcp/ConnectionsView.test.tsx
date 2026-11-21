import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsView } from "./ConnectionsView";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
const item = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  clientName: "My assistant",
  scopes: ["cal:read", "cal:propose"],
  createdAt: "2026-11-01T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
};
beforeEach(() => {
  vi.mocked(fetch).mockReset();
});
describe("AI connection settings", () => {
  it("shows the endpoint and connection permissions without changing access", () => {
    render(
      <ConnectionsView endpoint="https://cal.test/api/mcp" initial={{ items: [item], nextCursor: null }} />
    );
    expect(screen.getByText("https://cal.test/api/mcp")).toBeTruthy();
    expect(screen.getByText("My assistant")).toBeTruthy();
    expect(screen.getByText("mcp_permission_propose")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires an explicit disconnect decision and removes the revoked connection", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}));
    render(
      <ConnectionsView endpoint="https://cal.test/api/mcp" initial={{ items: [item], nextCursor: null }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "mcp_disconnect" }));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "mcp_confirm_disconnect" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/mcp/connections",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ grantId: item.id }) })
      )
    );
    await waitFor(() => expect(screen.queryByText("My assistant")).toBeNull());
    expect(screen.getByText("mcp_no_connections")).toBeTruthy();
  });
  it("keeps the connection visible when revocation fails", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 500 }));
    render(
      <ConnectionsView endpoint="https://cal.test/api/mcp" initial={{ items: [item], nextCursor: null }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "mcp_disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "mcp_confirm_disconnect" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("My assistant")).toBeTruthy();
  });
  it("lets the keyboard cancel or confirm a named disconnect", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({}));
    render(
      <ConnectionsView endpoint="https://cal.test/api/mcp" initial={{ items: [item], nextCursor: null }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "mcp_disconnect" }));
    const confirmation = screen.getByRole("form", { name: "My assistant" });
    fireEvent.keyDown(confirmation, { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "mcp_disconnect" }));
    fireEvent.submit(screen.getByRole("form", { name: "My assistant" }));
    await waitFor(() => expect(screen.getByText("mcp_no_connections")).toBeTruthy());
  });
});
