import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleDraft } from "../lib/visualAvailability";
import { VisualAvailabilityEditor } from "./VisualAvailabilityEditor";

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      calendars: {
        hostCalendar: {
          useQuery: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
        },
      },
    },
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

function Editor({ weekStart = 1 }: { weekStart?: number }) {
  const form = useForm<ScheduleDraft>({
    defaultValues: {
      schedule: [
        [],
        [{ start: new Date("2026-11-16T09:00Z"), end: new Date("2026-11-16T17:00Z") }],
        [],
        [],
        [],
        [],
        [],
      ],
      dateOverrides: [],
    },
  });
  return (
    <FormProvider {...form}>
      <VisualAvailabilityEditor weekStart={weekStart} timeZone="Indian/Reunion">
        <div>List controls</div>
      </VisualAvailabilityEditor>
      <output data-testid="draft">{JSON.stringify(form.watch())}</output>
    </FormProvider>
  );
}

function preparePointerGrid() {
  const grid = screen.getByTestId("availability-grid");
  grid.setPointerCapture = vi.fn();
  grid.releasePointerCapture = vi.fn();
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 756,
    height: 1152,
    right: 756,
    bottom: 1152,
    toJSON: () => ({}),
  });
  return grid;
}

describe("visual schedule draft", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("commits pointer drawing only on release and cancels with Escape", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    render(<Editor />);
    const grid = preparePointerGrid();
    const before = screen.getByTestId("draft").textContent;
    fireEvent.pointerDown(grid, { button: 0, clientX: 606, clientY: 432 });
    fireEvent.pointerMove(grid, { clientX: 606, clientY: 480 });
    expect(screen.getByTestId("draft").textContent).toBe(before);
    fireEvent.keyDown(grid, { key: "Escape" });
    fireEvent.pointerUp(grid, { clientX: 606, clientY: 480 });
    expect(screen.getByTestId("draft").textContent).toBe(before);
    fireEvent.pointerDown(grid, { button: 0, clientX: 606, clientY: 432 });
    fireEvent.pointerMove(grid, { clientX: 606, clientY: 480 });
    fireEvent.pointerUp(grid, { clientX: 606, clientY: 480 });
    expect(screen.getAllByRole("button", { name: "availability_range" })).toHaveLength(2);
    expect(screen.getByTestId("draft")).toHaveTextContent("T10:00:00.000Z");
  });

  it.each([
    { gesture: "move", x: 206 },
    { gesture: "draw", x: 306 },
  ])("cancels an active $gesture if the first day of week changes", ({ gesture, x }) => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { rerender } = render(<Editor weekStart={0} />);
    const grid = preparePointerGrid();
    const before = screen.getByTestId("draft").textContent;
    const target = gesture === "move" ? screen.getByRole("button", { name: "availability_range" }) : grid;
    fireEvent.pointerDown(target, { button: 0, clientX: x, clientY: 480 });
    fireEvent.pointerMove(grid, { clientX: x, clientY: 528 });

    rerender(<Editor weekStart={1} />);
    fireEvent.pointerUp(screen.getByTestId("availability-grid"), { clientX: x, clientY: 528 });

    expect(screen.getByTestId("draft").textContent).toBe(before);
    expect(screen.getAllByRole("button", { name: "availability_range" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "availability_remove_range" })).not.toBeInTheDocument();
  });

  it("shares calendar edits with the list without submitting, and supports undo after confirmed removal", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "availability_range" }));
    fireEvent.change(screen.getByLabelText("start_time"), { target: { value: "10:00" } });
    expect(screen.getByTestId("draft")).toHaveTextContent("T10:00:00.000Z");
    fireEvent.click(screen.getByRole("button", { name: "availability_remove_range" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.getByRole("button", { name: "availability_range" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "availability_remove_range" }));
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    expect(screen.queryByRole("button", { name: "availability_range" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(screen.getByRole("button", { name: "availability_range" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "list_view" }));
    expect(screen.getByText("List controls")).toBeInTheDocument();
    expect(screen.getByTestId("draft")).toHaveTextContent("T10:00:00.000Z");
  });
  it("moves a selected window with the keyboard without changing its duration", () => {
    render(<Editor />);
    fireEvent.keyDown(screen.getByRole("button", { name: "availability_range" }), { key: "ArrowDown" });
    expect(screen.getByTestId("draft")).toHaveTextContent("T09:15:00.000Z");
    expect(screen.getByTestId("draft")).toHaveTextContent("T17:15:00.000Z");
  });
});
