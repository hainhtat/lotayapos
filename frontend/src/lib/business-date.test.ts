import { describe, expect, it } from "vitest";
import { hubBusinessDate } from "./business-date";

describe("hubBusinessDate", () => {
  it("uses the Myanmar date around the UTC boundary", () => {
    expect(hubBusinessDate(new Date("2026-09-04T20:00:00.000Z"))).toBe("2026-09-05");
  });
  it("uses today in Yangon during the early-morning UTC date difference", () => {
    expect(hubBusinessDate(new Date("2026-09-17T18:45:00.000Z"))).toBe("2026-09-18");
  });
});
