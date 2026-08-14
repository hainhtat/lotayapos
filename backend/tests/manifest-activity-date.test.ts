import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("manifest activity date filter", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `mad-hub-${suffix}`;
  const shopId = `mad-shop-${suffix}`;
  const dispatcherId = `mad-dispatcher-${suffix}`;
  const riderId = `mad-rider-${suffix}`;
  const riderUserId = `mad-rider-user-${suffix}`;
  const batchId = `mad-batch-${suffix}`;
  const deliveredOnFilterDayId = `mad-parcel-filter-day-${suffix}`;
  const deliveredEarlierId = `mad-parcel-earlier-${suffix}`;

  const dispatcherToken = () =>
    signAccessToken({
      sub: dispatcherId,
      email: `dispatcher-${suffix}@example.com`,
      role: "DISPATCHER",
      tokenVersion: 0,
    });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Manifest activity hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Manifest activity shop ${suffix}` } });
    await prisma.user.create({
      data: {
        id: dispatcherId,
        name: "Dispatcher",
        email: `dispatcher-${suffix}@example.com`,
        username: `dispatcher-${suffix}`,
        passwordHash: "test-only",
        role: "DISPATCHER",
        hubId,
        active: true,
      },
    });
    await prisma.user.create({
      data: {
        id: riderUserId,
        name: "Rider",
        email: `rider-${suffix}@example.com`,
        username: `rider-${suffix}`,
        passwordHash: "test-only",
        role: "RIDER",
        hubId,
        active: true,
      },
    });
    await prisma.rider.create({
      data: {
        id: riderId,
        userId: riderUserId,
        hubId,
        payModel: "PERCENTAGE",
        commissionRateBps: 4000,
      },
    });
    await prisma.batch.create({
      data: {
        id: batchId,
        label: `Batch ${suffix}`,
        shopId,
        hubId,
        pickupDate: new Date("2026-08-01T00:00:00.000Z"),
        advancePaid: 0,
      },
    });

    const parcelDefaults = {
      batchId,
      riderId,
      customerName: "Customer",
      address: "123 Main Road",
      codAmount: 10000,
      deliveryFee: 1500,
      advanceAmount: 0,
      status: "DELIVERED" as const,
    };

    await prisma.parcel.create({
      data: {
        id: deliveredOnFilterDayId,
        trackingNumber: `MAD-FILTER-${suffix}`,
        ...parcelDefaults,
      },
    });
    await prisma.parcel.create({
      data: {
        id: deliveredEarlierId,
        trackingNumber: `MAD-EARLIER-${suffix}`,
        ...parcelDefaults,
      },
    });

    await prisma.statusHistory.createMany({
      data: [
        {
          parcelId: deliveredOnFilterDayId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "DELIVERED",
          actorId: dispatcherId,
          createdAt: new Date("2026-08-13T10:30:00.000Z"),
        },
        {
          parcelId: deliveredEarlierId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "DELIVERED",
          actorId: dispatcherId,
          createdAt: new Date("2026-08-10T10:30:00.000Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    const parcelIds = [deliveredOnFilterDayId, deliveredEarlierId];
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, riderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("filters manifest parcels by status activity date, not batch pickup date", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/manifest/preview")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        riderIds: [riderId],
        statuses: ["DELIVERED"],
        dateFrom: "2026-08-13",
        dateTo: "2026-08-13",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.parcelCount).toBe(1);
    expect(response.body.data.summary.delivered).toBe(1);
    const trackingNumbers = response.body.data.sections.flatMap(
      (section: { parcels: Array<{ trackingNumber: string }> }) => section.parcels.map((parcel) => parcel.trackingNumber),
    );
    expect(trackingNumbers).toEqual([`MAD-FILTER-${suffix}`]);
  });

  test("rejects an inverted manifest date range", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/manifest/preview")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        riderIds: [riderId],
        statuses: ["DELIVERED"],
        dateFrom: "2026-08-14",
        dateTo: "2026-08-13",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_DATE_RANGE");
  });
});
