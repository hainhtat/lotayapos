import { calculateLinkedDeliveryFee, isAssignmentEligible, normalizeDeliveryAddress } from "../src/services/operations.service.js";
import { calculateLinkedDeliveryAmounts } from "../src/services/ledger.service.js";

describe("linked parcels", () => {
  test("charges the base fee plus 1000 MMK for each additional parcel", () => {
    expect(calculateLinkedDeliveryFee(3000, 1)).toBe(3000);
    expect(calculateLinkedDeliveryFee(3000, 3)).toBe(5000);
  });

  test("rejects invalid linked fee inputs", () => {
    expect(() => calculateLinkedDeliveryFee(-1, 2)).toThrow("Linked delivery fee inputs are invalid");
    expect(() => calculateLinkedDeliveryFee(3000, 0)).toThrow("Linked delivery fee inputs are invalid");
  });

  test("normalizes harmless address casing and whitespace differences", () => {
    expect(normalizeDeliveryAddress("  No. 12,   BAHAN Road ")).toBe(normalizeDeliveryAddress("no. 12, bahan road"));
  });

  test("keeps linking separate from assignment eligibility", () => {
    expect(isAssignmentEligible({ riderId: null, status: "CREATED" })).toBe(true);
  });

  test("calculates commission from the adjusted group fee", () => {
    expect(calculateLinkedDeliveryAmounts({ baseDeliveryFee: 3000, parcelCount: 3, commissionRateBps: 4000 })).toEqual({ deliveryFee: 5000, commission: 2000 });
  });
});
