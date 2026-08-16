import { describe, expect, it } from "vitest";
import {
  appendParcelDraft,
  applyTownshipToParcelRow,
  formatTrackingNumber,
  hydrateParcelRowLocations,
  isParcelRowComplete,
  isParcelRowLocationConsistent,
  isResolvedTownshipId,
  parseParcelGrid,
  townshipsForRegion,
  type ParcelRow,
} from "./batch-detail-page";

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

const townships = [
  {
    id: "t-hlaing",
    nameEn: "Hlaing",
    deliveryFee: 2500,
    district: {
      id: "d-west",
      nameEn: "West Yangon",
      regionStateId: "r-yangon",
      regionState: { id: "r-yangon", nameEn: "Yangon" },
    },
  },
  {
    id: "t-thingangyun",
    nameEn: "Thingangyun",
    deliveryFee: 2800,
    district: {
      id: "d-east",
      nameEn: "East Yangon",
      regionStateId: "r-yangon",
      regionState: { id: "r-yangon", nameEn: "Yangon" },
    },
  },
  {
    id: "t-chanayethazan",
    nameEn: "Chanayethazan",
    deliveryFee: 3000,
    district: {
      id: "d-mandalay",
      nameEn: "Mandalay",
      regionStateId: "r-mandalay",
      regionState: { id: "r-mandalay", nameEn: "Mandalay" },
    },
  },
];

const regions = [
  { id: "r-yangon", nameEn: "Yangon" },
  { id: "r-mandalay", nameEn: "Mandalay" },
];

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

describe("region-first location selection", () => {
  it("lists every township in the chosen region across districts", () => {
    expect(townshipsForRegion(townships, "")).toEqual([]);
    expect(townshipsForRegion(townships, "r-yangon").map((item) => item.id)).toEqual([
      "t-hlaing",
      "t-thingangyun",
    ]);
    expect(townshipsForRegion(townships, "r-mandalay").map((item) => item.id)).toEqual(["t-chanayethazan"]);
  });

  it("fills district from township without changing region", () => {
    expect(
      applyTownshipToParcelRow(
        { ...blankRow(), regionStateId: "r-yangon" },
        "t-thingangyun",
        townships,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-yangon",
      townshipId: "t-thingangyun",
      districtId: "d-east",
      zoneId: "",
    });
  });

  it("syncs region from township when requested by the modal form path", () => {
    expect(
      applyTownshipToParcelRow(blankRow(), "t-chanayethazan", townships, { syncRegion: true }),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-mandalay",
      townshipId: "t-chanayethazan",
      districtId: "d-mandalay",
      zoneId: "",
    });
    expect(
      applyTownshipToParcelRow(
        {
          ...blankRow(),
          regionStateId: "r-mandalay",
          townshipId: "t-chanayethazan",
          districtId: "d-mandalay",
          zoneId: "z1",
        },
        "",
        townships,
        { syncRegion: true },
      ),
    ).toEqual(blankRow());
  });

  it("clears township and district but keeps region when township is cleared", () => {
    expect(
      applyTownshipToParcelRow(
        {
          ...blankRow(),
          regionStateId: "r-yangon",
          townshipId: "t-hlaing",
          districtId: "d-west",
          zoneId: "z1",
        },
        "",
        townships,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-yangon",
    });
  });

  it("hydrates pasted township names into district while preserving region", () => {
    expect(
      hydrateParcelRowLocations(
        {
          ...blankRow(),
          regionStateId: "r-yangon",
          townshipId: "Hlaing",
          zoneId: "z1",
          districtId: "ignored",
        },
        townships,
        regions,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-yangon",
      townshipId: "t-hlaing",
      districtId: "d-west",
      zoneId: "z1",
    });
  });

  it("derives region from township when paste omitted region", () => {
    expect(
      hydrateParcelRowLocations(
        {
          ...blankRow(),
          townshipId: "Thingangyun",
          zoneId: "z-east",
        },
        townships,
        regions,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-yangon",
      townshipId: "t-thingangyun",
      districtId: "d-east",
      zoneId: "z-east",
    });
  });

  it("syncs region from township when paste region and township disagree", () => {
    expect(
      hydrateParcelRowLocations(
        {
          ...blankRow(),
          regionStateId: "r-yangon",
          townshipId: "Chanayethazan",
          zoneId: "z1",
        },
        townships,
        regions,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-mandalay",
      townshipId: "t-chanayethazan",
      districtId: "d-mandalay",
      zoneId: "z1",
    });
  });

  it("leaves ambiguous township names unresolved", () => {
    const duplicateNameTownships = [
      ...townships,
      {
        id: "t-hlaing-mdy",
        nameEn: "Hlaing",
        deliveryFee: 3100,
        district: {
          id: "d-mandalay",
          nameEn: "Mandalay",
          regionStateId: "r-mandalay",
          regionState: { id: "r-mandalay", nameEn: "Mandalay" },
        },
      },
    ];
    expect(
      hydrateParcelRowLocations(
        { ...blankRow(), townshipId: "Hlaing" },
        duplicateNameTownships,
        regions,
      ),
    ).toEqual({
      ...blankRow(),
      townshipId: "Hlaing",
      districtId: "",
      regionStateId: "",
    });
    expect(
      hydrateParcelRowLocations(
        { ...blankRow(), regionStateId: "r-yangon", townshipId: "Hlaing" },
        duplicateNameTownships,
        regions,
      ),
    ).toEqual({
      ...blankRow(),
      regionStateId: "r-yangon",
      townshipId: "t-hlaing",
      districtId: "d-west",
    });
  });

  it("rejects unresolved or cross-region township ids for save readiness", () => {
    expect(isResolvedTownshipId("t-hlaing", townships)).toBe(true);
    expect(isResolvedTownshipId("Hlaing", townships)).toBe(false);
    expect(isParcelRowLocationConsistent({ ...blankRow(), townshipId: "t-hlaing", regionStateId: "r-yangon" }, townships)).toBe(true);
    expect(isParcelRowLocationConsistent({ ...blankRow(), townshipId: "t-chanayethazan", regionStateId: "r-yangon" }, townships)).toBe(false);
    expect(isParcelRowLocationConsistent({ ...blankRow(), townshipId: "Hlaing", regionStateId: "r-yangon" }, townships)).toBe(false);
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
