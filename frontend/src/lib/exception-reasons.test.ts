import { describe, expect, it } from "vitest";
import { isDateChangeReason } from "./exception-reasons";

describe("isDateChangeReason", () => {
  it("matches configured date-change codes case-insensitively", () => {
    expect(isDateChangeReason("DATE_CHANGE")).toBe(true);
    expect(isDateChangeReason("delivery_date_change")).toBe(true);
    expect(isDateChangeReason(" reschedule ")).toBe(true);
  });

  it("rejects unrelated or empty reason codes", () => {
    expect(isDateChangeReason("NO_ANSWER")).toBe(false);
    expect(isDateChangeReason(null)).toBe(false);
    expect(isDateChangeReason(undefined)).toBe(false);
  });
});
