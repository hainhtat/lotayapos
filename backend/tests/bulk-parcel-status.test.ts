import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("atomic bulk parcel status", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `bulk-status-hub-${suffix}`;
  const shopId = `bulk-status-shop-${suffix}`;
  const dispatcherId = `bulk-status-dispatcher-${suffix}`;
  const riderUserId = `bulk-status-rider-user-${suffix}`;
  const riderId = `bulk-status-rider-${suffix}`;
  const batchId = `bulk-status-batch-${suffix}`;
  const successIds = [`bulk-status-success-a-${suffix}`, `bulk-status-success-b-${suffix}`];
  const rollbackIds = [`bulk-status-rollback-a-${suffix}`, `bulk-status-rollback-b-${suffix}`];
  const parcelIds = [...successIds, ...rollbackIds];

  const token = () => signAccessToken({
    sub: dispatcherId,
    email: `bulk-status-${suffix}@example.com`,
    role: "DISPATCHER",
    tokenVersion: 0,
  });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Bulk status hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Bulk status shop ${suffix}` } });
    await prisma.user.create({
      data: {
        id: dispatcherId,
        name: "Dispatcher",
        email: `bulk-status-${suffix}@example.com`,
        username: `bulk-status-${suffix}`,
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
        email: `bulk-status-rider-${suffix}@example.com`,
        username: `bulk-status-rider-${suffix}`,
        passwordHash: "test-only",
        role: "RIDER",
        hubId,
        active: true,
      },
    });
    await prisma.rider.create({ data: { id: riderId, userId: riderUserId, hubId, commissionRateBps: 4000 } });
    await prisma.batch.create({
      data: { id: batchId, shopId, hubId, label: `Bulk status ${suffix}`, pickupDate: new Date("2026-09-04T00:00:00.000Z"), advancePaid: 0 },
    });
    for (const [index, id] of parcelIds.entries()) {
      await prisma.parcel.create({
        data: {
          id,
          batchId,
          trackingNumber: `BULK-STATUS-${index}-${suffix}`,
          customerName: `Customer ${index}`,
          address: `${index} Main Road`,
          codAmount: 10000,
          deliveryFee: 2000,
          advanceAmount: 0,
          status: id === rollbackIds[1] ? "CREATED" : "ASSIGNED",
          riderId,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, riderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("updates the complete selection and preserves normal status side effects", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/bulk-status")
      .set("Authorization", `Bearer ${token()}`)
      .send({ parcelIds: successIds, status: "OUT_FOR_DELIVERY" });

    expect(response.status).toBe(200);
    expect(response.body.data.updatedCount).toBe(2);
    expect(response.body.data.parcels).toHaveLength(2);
    const parcels = await prisma.parcel.findMany({ where: { id: { in: successIds } } });
    expect(parcels.every((parcel) => parcel.status === "OUT_FOR_DELIVERY")).toBe(true);
    expect(await prisma.statusHistory.count({ where: { parcelId: { in: successIds }, toStatus: "OUT_FOR_DELIVERY" } })).toBe(2);
    expect(await prisma.deliveryWay.count({ where: { parcelId: { in: successIds }, completedAt: null } })).toBe(2);
  });

  test("rolls back every status, history, and way when a later transition fails", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/bulk-status")
      .set("Authorization", `Bearer ${token()}`)
      .send({ parcelIds: rollbackIds, status: "OUT_FOR_DELIVERY" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OVERRIDE_NOTE_REQUIRED");
    const parcels = await prisma.parcel.findMany({ where: { id: { in: rollbackIds } }, orderBy: { id: "asc" } });
    expect(parcels.map((parcel) => parcel.status).sort()).toEqual(["ASSIGNED", "CREATED"]);
    expect(await prisma.statusHistory.count({ where: { parcelId: { in: rollbackIds } } })).toBe(0);
    expect(await prisma.deliveryWay.count({ where: { parcelId: { in: rollbackIds } } })).toBe(0);
  });

  test("rejects selections over 50 before service execution", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/bulk-status")
      .set("Authorization", `Bearer ${token()}`)
      .send({ parcelIds: Array.from({ length: 51 }, (_, index) => `parcel-${index}`), status: "OUT_FOR_DELIVERY" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
