import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { csvValue } from "../src/controllers/reports.controller.js";

describe("phase one operational reports", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hubId = `reports-hub-${suffix}`;
  const shopId = `reports-shop-${suffix}`;
  const userId = `reports-finance-${suffix}`;
  const riderUserId = `reports-rider-user-${suffix}`;
  const riderId = `reports-rider-${suffix}`;
  const batchId = `reports-batch-${suffix}`;
  const parcelId = `reports-parcel-${suffix}`;
  const journalId = `reports-journal-${suffix}`;
  const settlementId = `reports-os-settlement-${suffix}`;
  const token = () => signAccessToken({ sub: userId, email: `${userId}@test.local`, role: "FINANCE", tokenVersion: 0 });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: "Reports Hub" } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Reports Shop ${suffix}` } });
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local`, username: userId, passwordHash: "test", name: "Finance", role: "FINANCE", hubId } });
    await prisma.user.create({ data: { id: riderUserId, email: `${riderUserId}@test.local`, username: riderUserId, passwordHash: "test", name: "Report Rider", role: "RIDER", hubId } });
    await prisma.rider.create({ data: { id: riderId, userId: riderUserId, hubId, commissionRateBps: 4000 } });
    await prisma.batch.create({ data: { id: batchId, shopId, hubId, label: "Report batch", pickupDate: new Date("2026-08-01T00:00:00.000Z") } });
    await prisma.parcel.create({ data: { id: parcelId, batchId, trackingNumber: `REPORT-${suffix}`, orderId: "ORDER-1", customerName: "Customer", address: "Address", codAmount: 10000, deliveryFee: 2000, advanceAmount: 7000, riderId, status: "RETURNED" } });
    await prisma.statusHistory.createMany({ data: [
      { parcelId, fromStatus: "OUT_FOR_DELIVERY", toStatus: "PENDING_RETURN", actorId: userId, reasonCode: "FAILED", createdAt: new Date("2026-08-10T02:00:00.000Z") },
      { parcelId, fromStatus: "PENDING_RETURN", toStatus: "RETURNED", actorId: userId, createdAt: new Date("2026-08-11T02:00:00.000Z") },
    ] });
    await prisma.deliveryWay.create({ data: { parcelId, riderId, commissionRate: 4000, commissionAmount: 800, outcome: "DELIVERED", completedAt: new Date("2026-08-10T03:00:00.000Z") } });
    await prisma.journalEntry.create({ data: { id: journalId, sourceType: "OS_SETTLEMENT", sourceId: settlementId, hubId, businessDate: new Date("2026-08-12T00:00:00.000Z"), description: "Report settlement" } });
    await prisma.osSettlement.create({ data: { id: settlementId, shopId, hubId, businessDate: new Date("2026-08-12T00:00:00.000Z"), grossCollectedCod: 10000, advanceDeduction: 7000, returnDeduction: 500, deliveryFeeDeduction: 2000, adjustmentAmount: 100, netAmount: 600, wallet: "CASH", idempotencyKey: settlementId, postedBy: userId, journalEntryId: journalId } });
  });

  afterAll(async () => {
    await prisma.osSettlement.deleteMany({ where: { id: settlementId } });
    await prisma.journalEntry.deleteMany({ where: { id: journalId } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId } });
    await prisma.statusHistory.deleteMany({ where: { parcelId } });
    await prisma.parcel.deleteMany({ where: { id: parcelId } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, riderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  const path = (name: string, extra = "") => `/api/v1/reports/${name}?from=2026-08-01&to=2026-08-31&shopId=${shopId}${extra}`;

  test("reports monthly status activity and return events", async () => {
    const monthly = await request(app).get(path("monthly-operations")).set("Authorization", `Bearer ${token()}`);
    expect(monthly.status).toBe(200);
    expect(monthly.body.data).toMatchObject({ basis: "status_activity", totals: { statusTransitions: 2, uniqueParcels: 1 }, transitionCounts: { PENDING_RETURN: 1, RETURNED: 1 } });
    const returns = await request(app).get(path("returns", `&riderId=${riderId}`)).set("Authorization", `Bearer ${token()}`);
    expect(returns.status).toBe(200);
    expect(returns.body.data.totals).toMatchObject({ events: 2, uniqueParcels: 1, pendingReturnEvents: 1, returnedEvents: 1, advanceAmount: 7000 });
  });

  test("reports persisted rider-way performance and OS settlement amounts", async () => {
    const rider = await request(app).get(path("rider-performance", `&riderId=${riderId}`)).set("Authorization", `Bearer ${token()}`);
    expect(rider.status).toBe(200);
    expect(rider.body.data.riders[0]).toMatchObject({ riderId, completedWays: 1, delivered: 1, commissionAmount: 800 });
    const statement = await request(app).get(path("os-statements")).set("Authorization", `Bearer ${token()}`);
    expect(statement.status).toBe(200);
    expect(statement.body.data.totals).toMatchObject({ settlements: 1, grossCollectedCod: 10000, netAmount: 600 });
  });

  test("exports detailed reports as UTF-8 CSV", async () => {
    const response = await request(app).get(path("returns", "&format=csv")).set("Authorization", `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/csv/);
    expect(response.text).toContain("trackingNumber");
    expect(response.text).toContain(`REPORT-${suffix}`);
  });

  test("neutralizes spreadsheet formulas while retaining numeric CSV cells", () => {
    expect(csvValue("=HYPERLINK(\"https://evil.invalid\")")).toBe("\"'=HYPERLINK(\"\"https://evil.invalid\"\")\"");
    expect(csvValue(" +SUM(1,1)")).toBe("\"' +SUM(1,1)\"");
    expect(csvValue("@command")).toBe("\"'@command\"");
    expect(csvValue("\tformula")).toBe("\"'\tformula\"");
    expect(csvValue(1234)).toBe("1234");
  });

  test("rejects report ranges above the synchronous safety envelope", async () => {
    const response = await request(app).get(`/api/v1/reports/returns?from=2025-01-01&to=2026-08-31&shopId=${shopId}`).set("Authorization", `Bearer ${token()}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REPORT_RANGE_TOO_LARGE");
  });
});
