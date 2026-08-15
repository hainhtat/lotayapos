import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("OUT_FOR_DELIVERY to DELIVERED without open delivery way", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `ofd-hub-${suffix}`;
  const shopId = `ofd-shop-${suffix}`;
  const dispatcherId = `ofd-dispatcher-${suffix}`;
  const riderUserId = `ofd-rider-user-${suffix}`;
  const riderId = `ofd-rider-${suffix}`;
  const batchId = `ofd-batch-${suffix}`;
  const parcelMissingWayId = `ofd-parcel-missing-${suffix}`;
  const parcelMismatchWayId = `ofd-parcel-mismatch-${suffix}`;
  const parcelConflictWayId = `ofd-parcel-conflict-${suffix}`;
  const parcelReuseWayId = `ofd-parcel-reuse-${suffix}`;
  const parcelOfdSupersedeId = `ofd-parcel-ofd-super-${suffix}`;
  const otherRiderId = `ofd-other-rider-${suffix}`;
  const otherRiderUserId = `ofd-other-rider-user-${suffix}`;

  const dispatcherToken = () =>
    signAccessToken({
      sub: dispatcherId,
      email: `dispatcher-${suffix}@example.com`,
      role: "DISPATCHER",
      tokenVersion: 0,
    });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `OFD hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `OFD shop ${suffix}` } });
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
    for (const [userId, id, name] of [
      [riderUserId, riderId, "Rider"],
      [otherRiderUserId, otherRiderId, "Other Rider"],
    ] as const) {
      await prisma.user.create({
        data: {
          id: userId,
          name,
          email: `${id}@example.com`,
          username: id,
          passwordHash: "test-only",
          role: "RIDER",
          hubId,
          active: true,
        },
      });
      await prisma.rider.create({
        data: { id, userId, hubId, payModel: "PERCENTAGE", commissionRateBps: 4000 },
      });
    }
    await prisma.batch.create({
      data: {
        id: batchId,
        shopId,
        hubId,
        label: `OFD ${suffix}`,
        pickupDate: new Date("2026-08-14T00:00:00.000Z"),
        advancePaid: 0,
      },
    });
    await prisma.parcel.create({
      data: {
        id: parcelMissingWayId,
        batchId,
        trackingNumber: `OFD-MISS-${suffix}`,
        customerName: "Customer",
        address: "1 Road",
        codAmount: 10000,
        deliveryFee: 2000,
        advanceAmount: 0,
        status: "OUT_FOR_DELIVERY",
        riderId,
      },
    });
    await prisma.parcel.create({
      data: {
        id: parcelMismatchWayId,
        batchId,
        trackingNumber: `OFD-MISMATCH-${suffix}`,
        customerName: "Customer Two",
        address: "2 Road",
        codAmount: 12000,
        deliveryFee: 2000,
        advanceAmount: 0,
        status: "OUT_FOR_DELIVERY",
        riderId,
      },
    });
    // Open way exists but under a different rider — ERP must still be able to deliver.
    await prisma.deliveryWay.create({
      data: { parcelId: parcelMismatchWayId, riderId: otherRiderId, commissionRate: 4000 },
    });
    await prisma.parcel.create({
      data: {
        id: parcelConflictWayId,
        batchId,
        trackingNumber: `OFD-CONFLICT-${suffix}`,
        customerName: "Customer Three",
        address: "3 Road",
        codAmount: 9000,
        deliveryFee: 2000,
        advanceAmount: 0,
        status: "OUT_FOR_DELIVERY",
        riderId,
      },
    });
    // Duplicate open ways (bug from repeated OFD) must not block delivery.
    await prisma.deliveryWay.create({
      data: { parcelId: parcelConflictWayId, riderId, commissionRate: 4000, startedAt: new Date("2026-08-13T08:00:00.000Z") },
    });
    await prisma.deliveryWay.create({
      data: { parcelId: parcelConflictWayId, riderId, commissionRate: 4000, startedAt: new Date("2026-08-13T09:00:00.000Z") },
    });
    await prisma.parcel.create({
      data: {
        id: parcelReuseWayId,
        batchId,
        trackingNumber: `OFD-REUSE-${suffix}`,
        customerName: "Customer Four",
        address: "4 Road",
        codAmount: 8000,
        deliveryFee: 2000,
        advanceAmount: 0,
        status: "ASSIGNED",
        riderId,
      },
    });
    // Existing open way must be reused on OUT_FOR_DELIVERY (no second open way).
    await prisma.deliveryWay.create({
      data: { parcelId: parcelReuseWayId, riderId, commissionRate: 4000, startedAt: new Date("2026-08-13T07:00:00.000Z") },
    });
    await prisma.parcel.create({
      data: {
        id: parcelOfdSupersedeId,
        batchId,
        trackingNumber: `OFD-SUPER-${suffix}`,
        customerName: "Customer Five",
        address: "5 Road",
        codAmount: 7000,
        deliveryFee: 2000,
        advanceAmount: 0,
        status: "ASSIGNED",
        riderId,
      },
    });
    await prisma.deliveryWay.create({
      data: { parcelId: parcelOfdSupersedeId, riderId, commissionRate: 4000, startedAt: new Date("2026-08-13T06:00:00.000Z") },
    });
    await prisma.deliveryWay.create({
      data: { parcelId: parcelOfdSupersedeId, riderId: otherRiderId, commissionRate: 4000, startedAt: new Date("2026-08-13T06:30:00.000Z") },
    });
  });

  afterAll(async () => {
    const parcelIds = [parcelMissingWayId, parcelMismatchWayId, parcelConflictWayId, parcelReuseWayId, parcelOfdSupersedeId];
    await prisma.alert.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.riderReceivableRecognition.deleteMany({
      where: {
        OR: [
          { sourceId: { in: parcelIds } },
          ...parcelIds.map((id) => ({ sourceId: { startsWith: `${id}:` } })),
        ],
      },
    });
    const entries = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { sourceId: { in: parcelIds } },
          ...parcelIds.map((id) => ({ sourceId: { startsWith: `${id}:` } })),
          { hubId },
        ],
      },
      select: { id: true },
    });
    const entryIds = entries.map((entry) => entry.id);
    if (entryIds.length) {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: { in: [riderId, otherRiderId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, riderUserId, otherRiderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("allows DELIVERED when parcel is OUT_FOR_DELIVERY with no delivery way", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelMissingWayId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "DELIVERED" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("DELIVERED");
    const way = await prisma.deliveryWay.findFirst({ where: { parcelId: parcelMissingWayId, outcome: "DELIVERED" } });
    expect(way?.riderId).toBe(riderId);
    expect(way?.completedAt).toBeTruthy();
    // 40% of 2000 fee = 800; missing way must still post commission + receivable.
    expect(way?.commissionAmount).toBe(800);

    const commission = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelMissingWayId } },
      include: { lines: true },
    });
    expect(commission).toBeTruthy();
    expect(commission!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "RIDER_COMMISSION_EXPENSE", debit: 800, credit: 0 }),
        expect.objectContaining({ account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 800 }),
      ]),
    );

    const receivable = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcelMissingWayId } },
      include: { lines: true },
    });
    expect(receivable).toBeTruthy();
    const debit = receivable!.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = receivable!.lines.reduce((sum, line) => sum + line.credit, 0);
    expect(debit).toBe(credit);
    expect(receivable!.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "RIDER_RECEIVABLE", debit: 11200, credit: 0 }),
        expect.objectContaining({ account: "CUSTOMER_COD_RECEIVABLE", debit: 0, credit: 10000 }),
        expect.objectContaining({ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 2000 }),
      ]),
    );
    const recognition = await prisma.riderReceivableRecognition.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcelMissingWayId } },
    });
    expect(recognition).toMatchObject({ riderId, codAmount: 10000, deliveryFee: 2000, commissionAmount: 800 });
  });

  test("allows DELIVERED when open delivery way belongs to a different rider", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelMismatchWayId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "DELIVERED" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("DELIVERED");
    const way = await prisma.deliveryWay.findFirst({
      where: { parcelId: parcelMismatchWayId, completedAt: { not: null } },
    });
    expect(way?.riderId).toBe(riderId);
    expect(way?.outcome).toBe("DELIVERED");
    expect(way?.commissionAmount).toBe(800);

    const commission = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelMismatchWayId } },
    });
    expect(commission).toBeTruthy();
    const recognition = await prisma.riderReceivableRecognition.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcelMismatchWayId } },
    });
    expect(recognition).toMatchObject({ riderId, commissionAmount: 800 });
  });

  test("allows DELIVERED when multiple open delivery ways exist", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelConflictWayId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "DELIVERED" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("DELIVERED");

    const ways = await prisma.deliveryWay.findMany({
      where: { parcelId: parcelConflictWayId },
      orderBy: { startedAt: "asc" },
    });
    expect(ways).toHaveLength(2);
    expect(ways.filter((way) => way.completedAt === null)).toHaveLength(0);
    const delivered = ways.filter((way) => way.outcome === "DELIVERED");
    const superseded = ways.filter((way) => way.outcome === "SUPERSEDED");
    expect(delivered).toHaveLength(1);
    expect(superseded).toHaveLength(1);
    expect(delivered[0]?.riderId).toBe(riderId);
    expect(delivered[0]?.commissionAmount).toBe(800);

    const commissions = await prisma.journalEntry.findMany({
      where: {
        sourceType: "RIDER_COMMISSION",
        OR: [{ sourceId: parcelConflictWayId }, { sourceId: { startsWith: `${parcelConflictWayId}:` } }],
      },
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0]?.sourceId).toBe(parcelConflictWayId);
  });

  test("OUT_FOR_DELIVERY reuses an existing open delivery way instead of creating a duplicate", async () => {
    const before = await prisma.deliveryWay.count({ where: { parcelId: parcelReuseWayId } });
    expect(before).toBe(1);

    const response = await request(app)
      .post(`/api/v1/parcels/${parcelReuseWayId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "OUT_FOR_DELIVERY" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("OUT_FOR_DELIVERY");

    const ways = await prisma.deliveryWay.findMany({ where: { parcelId: parcelReuseWayId } });
    expect(ways).toHaveLength(1);
    expect(ways[0]?.completedAt).toBeNull();
    expect(ways[0]?.riderId).toBe(riderId);
  });

  test("OUT_FOR_DELIVERY keeps one open way and supersedes extras", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelOfdSupersedeId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "OUT_FOR_DELIVERY" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("OUT_FOR_DELIVERY");

    const ways = await prisma.deliveryWay.findMany({
      where: { parcelId: parcelOfdSupersedeId },
      orderBy: { startedAt: "asc" },
    });
    expect(ways).toHaveLength(2);
    const open = ways.filter((way) => way.completedAt === null);
    const superseded = ways.filter((way) => way.outcome === "SUPERSEDED");
    expect(open).toHaveLength(1);
    expect(open[0]?.riderId).toBe(riderId);
    expect(superseded).toHaveLength(1);
  });
});
