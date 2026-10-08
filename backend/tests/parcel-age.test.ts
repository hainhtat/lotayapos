import { threeDaysInHandSnapshot } from "../src/utils/parcel-age.js";

describe("three days in hand snapshot", () => {
  it("returns unresolved parcel ids at the 72-hour boundary and the next due time", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    const parcels = [
      { id: "old", status: "CREATED", createdAt: new Date("2026-10-05T12:00:00.000Z") },
      { id: "next", status: "PENDING_RETURN", createdAt: new Date("2026-10-05T12:00:01.000Z") },
      { id: "delivered", status: "DELIVERED", createdAt: new Date("2026-10-01T00:00:00.000Z") },
      { id: "returned", status: "RETURNED", createdAt: new Date("2026-10-01T00:00:00.000Z") },
      { id: "voided", status: "VOIDED", createdAt: new Date("2026-10-01T00:00:00.000Z") },
    ];

    expect(threeDaysInHandSnapshot(parcels, now)).toEqual({
      parcelIds: ["old"],
      nextDueAt: "2026-10-08T12:00:01.000Z",
      calculatedAt: now.toISOString(),
    });
    expect(threeDaysInHandSnapshot(parcels, new Date("2026-10-08T12:00:01.000Z")).parcelIds).toEqual(["old", "next"]);
  });
});
