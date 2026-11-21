import type { LookBusyPolicy } from "@calcom/prisma/lookBusySchema";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LookBusySettings } from "./LookBusySettings";

vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

function Settings() {
  const [value, onChange] = useState<LookBusyPolicy>({ mode: "off" });
  return (
    <>
      <LookBusySettings value={value} onChange={onChange} />
      <output data-testid="policy">{JSON.stringify(value)}</output>
    </>
  );
}

describe("Look busy controls", () => {
  it("defaults to off and saves a daily or weekly number of choices", () => {
    render(<Settings />);
    expect(screen.getByLabelText("look_busy_mode")).toHaveValue("off");
    fireEvent.change(screen.getByLabelText("look_busy_mode"), { target: { value: "day" } });
    fireEvent.change(screen.getByLabelText("look_busy_count"), { target: { value: "3" } });
    expect(screen.getByTestId("policy")).toHaveTextContent('{"mode":"day","count":3}');
    fireEvent.change(screen.getByLabelText("look_busy_mode"), { target: { value: "week" } });
    expect(screen.getByTestId("policy")).toHaveTextContent('{"mode":"week","count":3}');
    expect(screen.getByText("look_busy_week_help")).toBeInTheDocument();
  });

  it("offers the requested 66 percent preset and can be disabled again", () => {
    render(<Settings />);
    fireEvent.change(screen.getByLabelText("look_busy_mode"), { target: { value: "percentage" } });
    fireEvent.change(screen.getByLabelText("look_busy_percentage"), { target: { value: "66" } });
    expect(screen.getByTestId("policy")).toHaveTextContent('{"mode":"percentage","percentage":66}');
    fireEvent.change(screen.getByLabelText("look_busy_mode"), { target: { value: "off" } });
    expect(screen.queryByLabelText("look_busy_percentage")).not.toBeInTheDocument();
    expect(screen.getByTestId("policy")).toHaveTextContent('{"mode":"off"}');
  });
});
