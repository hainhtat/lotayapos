import { describe, expect, it } from "vitest";
import { datePresetRange } from "./date-presets";

describe("datePresetRange", () => {
  it("returns local calendar bounds for today, this week, and this month", () => {
    const wednesday = new Date(2026, 7, 12, 15, 30);
    expect(datePresetRange("today", wednesday)).toEqual({ dateFrom: "2026-08-12", dateTo: "2026-08-12" });
    expect(datePresetRange("thisWeek", wednesday)).toEqual({ dateFrom: "2026-08-10", dateTo: "2026-08-16" });
    expect(datePresetRange("thisMonth", wednesday)).toEqual({ dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    const sunday = new Date(2026, 7, 16, 10);
    expect(datePresetRange("thisWeek", sunday)).toEqual({ dateFrom: "2026-08-10", dateTo: "2026-08-16" });
  });
});
