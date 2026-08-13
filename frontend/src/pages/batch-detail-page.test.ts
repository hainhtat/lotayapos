import { describe, expect, it } from "vitest";
import { appendParcelDraft, formatTrackingNumber, isParcelRowComplete, parseParcelGrid, type ParcelRow } from "./batch-detail-page";

const blankRow = (): ParcelRow => ({
  orderId: "",
  customerName: "",
  address: "",
  regionStateId: "",
  districtId: "",
  townshipId: "",
  zoneId: "",
  customerPhone: "",
  codAmount: "",
});

describe("parseParcelGrid", () => {
  it("parses pasted spreadsheet rows in the confirmed column order", () => {
    expect(parseParcelGrid("OS-100\tMa Su\tYangon\tr1\td1\tt1\tz1\t09123\t25000\nOS-200,Ko A,Mandalay,r2,d2,t2,,09456,10000")).toEqual([
      {
        orderId: "OS-100",
        customerName: "Ma Su",
        address: "Yangon",
        regionStateId: "r1",
        districtId: "d1",
        townshipId: "t1",
        zoneId: "z1",
        customerPhone: "09123",
        codAmount: "25000",
      },
      {
        orderId: "OS-200",
        customerName: "Ko A",
        address: "Mandalay",
        regionStateId: "r2",
        districtId: "d2",
        townshipId: "t2",
        zoneId: "",
        customerPhone: "09456",
        codAmount: "10000",
      },
    ]);
  });
});

describe("formatTrackingNumber", () => {
  it("formats Lotaya tracking numbers with zero padding", () => {
    expect(formatTrackingNumber(1)).toBe("LTY-001");
    expect(formatTrackingNumber(42)).toBe("LTY-042");
  });
});

describe("parcel form drafts", () => {
  it("accepts a complete modal row and replaces the first blank spreadsheet row", () => {
    const draft: ParcelRow = {
      ...blankRow(),
      customerName: "Ma Su",
      address: "Yangon",
      townshipId: "t1",
      codAmount: "25000",
    };
    expect(isParcelRowComplete(draft)).toBe(true);
    expect(isParcelRowComplete({ ...draft, customerPhone: "" })).toBe(true);
    expect(isParcelRowComplete({ ...draft, townshipId: "" })).toBe(false);
    expect(isParcelRowComplete({ ...draft, codAmount: "12.5" })).toBe(false);
    expect(appendParcelDraft([blankRow(), blankRow()], draft)[0]).toEqual(draft);
  });
});
