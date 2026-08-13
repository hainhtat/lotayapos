import { describe, expect, it } from "vitest";
import { buildManifestBody, manifestStatusLabelKey, manifestStatusList } from "./manifest-filters";

describe("manifest filters", () => {
  it("expands to-deliver and all status groups for the manifest API", () => {
    expect(manifestStatusList("toDeliver")).toEqual(["ASSIGNED", "OUT_FOR_DELIVERY", "PICKED_UP"]);
    expect(manifestStatusList("all")).toContain("DELIVERED");
    expect(manifestStatusList("FAILED")).toEqual(["FAILED"]);
    expect(manifestStatusLabelKey("PENDING_RETURN")).toBe("pendingReturn");
  });

  it("omits riders and dates when viewing every hub rider for all dates", () => {
    expect(
      buildManifestBody({
        riderIds: [],
        status: "all",
        datePreset: "all",
        dateFrom: "",
        dateTo: "",
      }),
    ).toEqual({
      statuses: manifestStatusList("all"),
    });
  });

  it("applies today and custom pickup-date ranges", () => {
    expect(
      buildManifestBody({
        riderIds: ["rider-1"],
        status: "DELIVERED",
        datePreset: "today",
        dateFrom: "",
        dateTo: "",
        now: new Date(2026, 7, 13, 9),
      }),
    ).toEqual({
      riderIds: ["rider-1"],
      statuses: ["DELIVERED"],
      dateFrom: "2026-08-13",
      dateTo: "2026-08-13",
    });
    expect(
      buildManifestBody({
        riderIds: ["rider-1"],
        status: "toDeliver",
        datePreset: "custom",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-07",
      }),
    ).toMatchObject({ dateFrom: "2026-08-01", dateTo: "2026-08-07" });
  });
});
