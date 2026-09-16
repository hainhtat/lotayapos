import { buildParcelListWhere } from "../src/services/parcel.service.js";

const scope = { id: "manager", role: "OPERATIONS_MANAGER", hubId: "hub-a", riderId: null };

describe("dispatch work queues", () => {
  afterEach(() => jest.restoreAllMocks());

  test("overdue uses first recorded timestamp and keeps hub and batch scope", () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-16T12:00:00Z"));
    expect(buildParcelListWhere(scope, false, { queue: "overdue", batchId: "old-batch" })).toEqual({ AND: [
      { batch: { hubId: "hub-a" } },
      { status: { notIn: ["DELIVERED", "RETURNED"] }, createdAt: { lte: new Date("2026-09-13T12:00:00Z") } },
      { batchId: "old-batch" },
    ] });
  });

  test("rescheduled work excludes physical OS returns and completed deliveries", () => {
    expect(buildParcelListWhere(scope, false, { queue: "rescheduled" })).toEqual({ AND: [
      { batch: { hubId: "hub-a" } },
      { status: { notIn: ["DELIVERED", "RETURNED", "PENDING_RETURN"] }, reasonCode: { in: ["DATE_CHANGE", "DELIVERY_DATE_CHANGE", "RESCHEDULE"] } },
    ] });
    expect(buildParcelListWhere(scope, false, { queue: "return-to-os" })).toEqual({ AND: [
      { batch: { hubId: "hub-a" } },
      { status: { in: ["PENDING_RETURN", "REJECTED"] } },
    ] });
  });
});
