import { classifyLocationSuggestions, normalizeCustomerPhone } from "../src/services/parcel-location-suggestions.service.js";

const saved = (overrides: Record<string, unknown> = {}) => ({
  customerName: "May", customerPhone: "+95 9 123 456 789", address: "12 Bogyoke Road",
  townshipId: "township-1", township: "Kyauktada", districtId: "district-1", district: "Yangon East",
  regionStateId: "region-1", regionState: "Yangon", lastUsedAt: "2026-10-04T00:00:00.000Z", ...overrides,
});

describe("parcel location suggestions", () => {
  it("normalizes Myanmar local and international phones", () => {
    expect(normalizeCustomerPhone("+95 (9) 123-456-789")).toBe("09123456789");
    expect(normalizeCustomerPhone("09 123 456 789")).toBe("09123456789");
    expect(normalizeCustomerPhone("၀၉ ၁၂၃ ၄၅၆ ၇၈၉")).toBe("09123456789");
  });

  it("marks one matching phone/location safe and preserves an equivalent PDF address", () => {
    const result = classifyLocationSuggestions([{ customerName: "May", customerPhone: "09123456789", address: "12, Bogyoke Road" }], [saved()]);
    expect(result[0]).toMatchObject({ kind: "SAFE", candidates: [{ source: "PHONE", customerName: "May", townshipId: "township-1" }] });
    expect(classifyLocationSuggestions([{ customerName: "", customerPhone: "၀၉ ၁၂၃ ၄၅၆ ၇၈၉" }], [saved()])[0]).toMatchObject({ kind: "SAFE", candidates: [{ customerName: "May" }] });
  });

  it("requires review when phone history has different locations or the PDF address conflicts", () => {
    const rows = [{ customerName: "May", customerPhone: "09123456789", address: "New street" }];
    expect(classifyLocationSuggestions(rows, [saved()])[0]?.kind).toBe("CONFLICT");
    expect(classifyLocationSuggestions(rows, [saved(), saved({ address: "Another street" })])[0]?.kind).toBe("MULTIPLE");
  });

  it("requires review when a shared phone belongs to a different named customer", () => {
    expect(classifyLocationSuggestions([{ customerName: "Ko Aung", customerPhone: "09123456789" }], [saved()])[0]?.kind).toBe("CONFLICT");
  });

  it("suggests a second phone only by exact name and normalized address, requiring confirmation", () => {
    const rows = [{ customerName: "May", customerPhone: "09999999999", address: "12 Bogyoke Road" }];
    expect(classifyLocationSuggestions(rows, [saved()])[0]).toMatchObject({ kind: "NAME_ADDRESS", candidates: [{ source: "NAME_ADDRESS" }] });
    expect(classifyLocationSuggestions([{ ...rows[0], address: "Other street" }], [saved()])[0]?.kind).toBe("NONE");
  });

  it("keeps 200 imported rows aligned and prefers a phone match over a same-name address match", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      customerName: "May", customerPhone: index === 137 ? "09123456789" : "09999999999",
      address: index === 137 ? "Another road" : "",
    }));
    const result = classifyLocationSuggestions(rows, [
      saved(),
      saved({ customerPhone: "09888888888", address: "Another road", townshipId: "township-2" }),
    ]);
    expect(result).toHaveLength(200);
    expect(result[136]).toMatchObject({ index: 136, kind: "NONE" });
    expect(result[137]).toMatchObject({ index: 137, kind: "CONFLICT", candidates: [{ townshipId: "township-1", source: "PHONE" }] });
    expect(result[138]).toMatchObject({ index: 138, kind: "NONE" });
  });
});
