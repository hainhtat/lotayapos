import { businessDateUtcBoundary, nextCalendarDate } from "../src/utils/business-date.js";

describe("hub-local business date UTC boundaries", () => {
  test("maps a Yangon calendar day to the prior UTC evening", () => {
    expect(businessDateUtcBoundary("2026-08-11", "Asia/Yangon").toISOString()).toBe("2026-08-10T17:30:00.000Z");
    expect(businessDateUtcBoundary(nextCalendarDate("2026-08-11"), "Asia/Yangon").toISOString()).toBe("2026-08-11T17:30:00.000Z");
  });

  test("uses calendar-next-day boundaries across daylight-saving changes", () => {
    const from = businessDateUtcBoundary("2026-03-08", "America/New_York");
    const to = businessDateUtcBoundary(nextCalendarDate("2026-03-08"), "America/New_York");
    expect(to.getTime() - from.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
