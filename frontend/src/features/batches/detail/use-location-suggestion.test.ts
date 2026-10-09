import { describe, expect, it } from "vitest";
import { hasLookupPhone } from "./use-location-suggestion";

describe("phone suggestion threshold", () => {
  it("accepts Myanmar digit phone numbers as well as ASCII digits", () => {
    expect(hasLookupPhone("၀၉ ၁၂၃ ၄၅၆ ၇၈၉")).toBe(true);
    expect(hasLookupPhone("09 123 456 789")).toBe(true);
    expect(hasLookupPhone("၀၉ ၁၂၃")).toBe(false);
  });
});
