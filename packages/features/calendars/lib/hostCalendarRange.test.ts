import { describe, expect, it } from "vitest";
import { hostCalendarRange } from "./hostCalendarRange";

describe("host calendar boundaries", () => {
  it("queries real midnight boundaries independently across spring DST", () => {
    const result = hostCalendarRange("2026-03-02", "America/New_York");
    expect(result).toEqual({ dateFrom: "2026-03-02T05:00:00.000Z", dateTo: "2026-03-09T04:00:00.000Z" });
  });
  it("covers the additional hour in autumn", () => {
    expect(hostCalendarRange("2026-10-26", "America/New_York")).toEqual({
      dateFrom: "2026-10-26T04:00:00.000Z",
      dateTo: "2026-11-02T05:00:00.000Z",
    });
  });
});
