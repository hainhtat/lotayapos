import { describe, expect, it } from "vitest";
import { hubBusinessDate } from "./business-date";

describe("hubBusinessDate", () => {
  it("uses the Myanmar date around the UTC boundary", () => {
    expect(hubBusinessDate(new Date("2026-09-04T20:00:00.000Z"))).toBe("2026-09-05");
  });
});
