import { describe, expect, it } from "vitest";
import { isParcelThreeDaysInHand } from "./parcel-age";

const now = Date.parse("2026-10-08T12:00:00.000Z");

describe("three days in hand", () => {
  it("includes unresolved parcels at the 72-hour boundary", () => {
    expect(isParcelThreeDaysInHand({ status: "PENDING_RETURN", createdAt: "2026-10-05T12:00:00.000Z" }, now)).toBe(true);
    expect(isParcelThreeDaysInHand({ status: "OUT_FOR_DELIVERY", createdAt: "2026-10-05T12:00:00.001Z" }, now)).toBe(false);
  });

  it("excludes resolved parcels and missing creation dates", () => {
    for (const status of ["DELIVERED", "RETURNED", "VOIDED"]) {
      expect(isParcelThreeDaysInHand({ status, createdAt: "2026-10-01T00:00:00.000Z" }, now)).toBe(false);
    }
    expect(isParcelThreeDaysInHand({ status: "CREATED" }, now)).toBe(false);
  });
});
