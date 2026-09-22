import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { backfillMissingPaidToOsFeeReceivables } from "../src/services/parcel.service.js";

describe("OUT_FOR_DELIVERY to DELIVERED without open delivery way", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `ofd-hub-${suffix}`;
  const shopId = `ofd-shop-${suffix}`;
  const dispatcherId = `ofd-dispatcher-${suffix}`;
  const riderUserId = `ofd-rider-user-${suffix}`;
  const riderId = `ofd-rider-${suffix}`;
  const batchId = `ofd-batch-${suffix}`;
  const parcelPaidToOsId = `ofd-parcel-paid-os-${suffix}`;
  const parcelPaidToOsFeeId = `ofd-parcel-paid-os-fee-${suffix}`;
  const parcelMissingWayId = `ofd-parcel-missing-${suffix}`;
  const parcelMismatchWayId = `ofd-parcel-mismatch-${suffix}`;
  const parcelConflictWayId = `ofd-parcel-conflict-${suffix}`;
  const parcelReuseWayId = `ofd-parcel-reuse-${suffix}`;
  const parcelOfdSupersedeId = `ofd-parcel-ofd-super-${suffix}`;
  const parcelLegacyFeeId = `ofd-parcel-legacy-fee-${suffix}`;
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
        id: parcelPaidToOsId,
        batchId,
        trackingNumber: `OFD-PAID-OS-${suffix}`,
        customerName: "Paid to OS Customer",
        address: "6 Road",
        codAmount: 164000,
        deliveryFee: 4500,
        advanceAmount: 0,
        status: "OUT_FOR_DELIVERY",
        riderId,
      },
    });
    await prisma.parcel.create({
      data: {
        id: parcelPaidToOsFeeId,
        batchId,
        trackingNumber: `OFD-PAID-OS-FEE-${suffix}`,
        customerName: "Paid to OS Fee Included",
        address: "7 Road",
        codAmount: 80000,
        deliveryFee: 3000,
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
    // Legacy paid-to-OS: credit + commission posted, fee receivable missing (pre-fix).
    await prisma.parcel.create({
      data: {
        id: parcelLegacyFeeId,
        batchId,
        trackingNumber: `OFD-LEGACY-FEE-${suffix}`,
        customerName: "Legacy Fee Customer",
        address: "8 Road",
        codAmount: 50000,
        deliveryFee: 4000,
        advanceAmount: 0,
        status: "DELIVERED",
        collectionMode: "PAID_BY_OS",
        paidToOsFeeIncluded: false,
        riderId,
      },
    });
    await prisma.deliveryWay.create({
      data: {
        parcelId: parcelLegacyFeeId,
        riderId,
        commissionRate: 4000,
        commissionAmount: 1600,
        outcome: "DELIVERED",
        completedAt: new Date("2026-08-14T10:00:00.000Z"),
      },
    });
    const legacyBusinessDate = new Date("2026-08-14T00:00:00.000Z");
    await prisma.journalEntry.create({
      data: {
        sourceType: "OS_PAID_TO_OS_CREDIT",
        sourceId: parcelLegacyFeeId,
        hubId,
        businessDate: legacyBusinessDate,
        description: "Legacy paid-to-OS credit",
        lines: {
          create: [
            { account: "OS_COD_PAYABLE", debit: 50000, credit: 0 },
            { account: "OS_BATCH_COD_CLEARING", debit: 0, credit: 50000 },
          ],
        },
      },
    });
    await prisma.journalEntry.create({
      data: {
        sourceType: "RIDER_COMMISSION",
        sourceId: parcelLegacyFeeId,
        hubId,
        businessDate: legacyBusinessDate,
        description: "Legacy commission",
        lines: {
          create: [
            { account: "RIDER_COMMISSION_EXPENSE", debit: 1600, credit: 0 },
            { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 1600 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const parcelIds = [parcelMissingWayId, parcelPaidToOsId, parcelPaidToOsFeeId, parcelMismatchWayId, parcelConflictWayId, parcelReuseWayId, parcelOfdSupersedeId, parcelLegacyFeeId];
    await prisma.alert.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.osReturnCredit.deleteMany({ where: { parcelId: { in: parcelIds } } });
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
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
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

  test("posts OS credit for paid-to-OS delivery without wallet receipt", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelPaidToOsId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        status: "DELIVERED",
        collectionMode: "PAID_BY_OS",
        paidToOsIncludeDeliveryFee: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("DELIVERED");
    expect(response.body.data.collectionMode).toBe("PAID_BY_OS");
    expect(response.body.data.paidToOsFeeIncluded).toBe(false);

    const credit = await prisma.osReturnCredit.findUnique({ where: { parcelId: parcelPaidToOsId } });
    expect(credit).toMatchObject({
      amount: 164000,
      codAmount: 164000,
      feeAmount: 0,
      kind: "PAID_TO_OS",
      status: "POSTED",
    });

    const journal = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_PAID_TO_OS_CREDIT", sourceId: parcelPaidToOsId } },
      include: { lines: true },
    });
    expect(journal?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: "OS_COD_PAYABLE", debit: 164000, credit: 0 }),
      expect.objectContaining({ account: "OS_BATCH_COD_CLEARING", debit: 0, credit: 164000 }),
    ]));
    expect(journal?.lines.some((line) => line.account === "DELIVERY_FEE_REVENUE")).toBe(false);
    expect(journal?.lines.some((line) => line.account.startsWith("WALLET_"))).toBe(false);

    // 40% of 4500 fee = 1800; fee stays with rider as receivable (COD already credited to OS).
    const commission = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelPaidToOsId } },
      include: { lines: true },
    });
    expect(commission?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: "RIDER_COMMISSION_EXPENSE", debit: 1800, credit: 0 }),
      expect.objectContaining({ account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 1800 }),
    ]));

    const feeReceivable = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_PAID_TO_OS_FEE_RECEIVABLE", sourceId: parcelPaidToOsId } },
      include: { lines: true },
    });
    expect(feeReceivable?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: "RIDER_RECEIVABLE", debit: 2700, credit: 0 }),
      expect.objectContaining({ account: "RIDER_COMMISSION_PAYABLE", debit: 1800, credit: 0 }),
      expect.objectContaining({ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 4500 }),
    ]));
    const recognition = await prisma.riderReceivableRecognition.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_PAID_TO_OS_FEE_RECEIVABLE", sourceId: parcelPaidToOsId } },
    });
    expect(recognition).toMatchObject({ riderId, codAmount: 0, deliveryFee: 4500, commissionAmount: 1800, receivableAmount: 2700 });

    const cashReceivable = await prisma.riderReceivableRecognition.findFirst({
      where: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: { startsWith: parcelPaidToOsId } },
    });
    expect(cashReceivable).toBeNull();
  });

  test("paid-to-OS with fee included credits OS for fee and skips fee receivable", async () => {
    const response = await request(app)
      .post(`/api/v1/parcels/${parcelPaidToOsFeeId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        status: "DELIVERED",
        collectionMode: "PAID_BY_OS",
        paidToOsIncludeDeliveryFee: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.paidToOsFeeIncluded).toBe(true);

    const credit = await prisma.osReturnCredit.findUnique({ where: { parcelId: parcelPaidToOsFeeId } });
    expect(credit).toMatchObject({
      amount: 83000,
      codAmount: 80000,
      feeAmount: 3000,
      kind: "PAID_TO_OS",
      status: "POSTED",
    });

    const journal = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_PAID_TO_OS_CREDIT", sourceId: parcelPaidToOsFeeId } },
      include: { lines: true },
    });
    expect(journal?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: "OS_COD_PAYABLE", debit: 83000, credit: 0 }),
      expect.objectContaining({ account: "OS_BATCH_COD_CLEARING", debit: 0, credit: 80000 }),
      expect.objectContaining({ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 3000 }),
    ]));

    const commission = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelPaidToOsFeeId } },
    });
    expect(commission).toBeTruthy();

    const feeReceivable = await prisma.riderReceivableRecognition.findFirst({
      where: { sourceType: "OS_PAID_TO_OS_FEE_RECEIVABLE", sourceId: { startsWith: parcelPaidToOsFeeId } },
    });
    expect(feeReceivable).toBeNull();

    const handover = await request(app)
      .post("/api/v1/operations/parcels/paid-to-os/preview")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ shopId, riderId });
    expect(handover.status).toBe(200);
    expect(handover.body.data.parcels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: parcelPaidToOsFeeId, paidToOsFeeIncluded: true, codAmount: 80000 }),
    ]));
    expect(handover.body.data.totalFees).toBeGreaterThanOrEqual(3000);

    const pdf = await request(app)
      .post("/api/v1/operations/parcels/paid-to-os/pdf")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ shopId, riderId });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const combinedPdf = await request(app)
      .post("/api/v1/operations/parcels/os-handover/pdf")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ parcelIds: [], shopId, riderId });
    expect(combinedPdf.status).toBe(200);
    expect(combinedPdf.headers["content-type"]).toMatch(/pdf/);
    expect(combinedPdf.headers["x-physical-return-count"]).toBe("0");
    expect(Number(combinedPdf.headers["x-paid-to-os-count"])).toBeGreaterThanOrEqual(1);
    expect(Buffer.from(combinedPdf.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");
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

  test("backfills missing paid-to-OS fee receivable for legacy deliveries", async () => {
    const before = await prisma.riderReceivableRecognition.findFirst({
      where: { sourceType: "OS_PAID_TO_OS_FEE_RECEIVABLE", sourceId: { startsWith: parcelLegacyFeeId } },
    });
    expect(before).toBeNull();

    const result = await backfillMissingPaidToOsFeeReceivables({
      trackingNumbers: [`OFD-LEGACY-FEE-${suffix}`],
    });
    expect(result.posted).toEqual([
      expect.objectContaining({
        trackingNumber: `OFD-LEGACY-FEE-${suffix}`,
        deliveryFee: 4000,
        commissionAmount: 1600,
        receivableAmount: 2400,
      }),
    ]);

    const recognition = await prisma.riderReceivableRecognition.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_PAID_TO_OS_FEE_RECEIVABLE", sourceId: parcelLegacyFeeId } },
    });
    expect(recognition).toMatchObject({
      riderId,
      codAmount: 0,
      deliveryFee: 4000,
      commissionAmount: 1600,
      receivableAmount: 2400,
    });

    const again = await backfillMissingPaidToOsFeeReceivables({
      trackingNumbers: [`OFD-LEGACY-FEE-${suffix}`],
    });
    expect(again.posted).toEqual([]);
    expect(again.skipped).toEqual([
      expect.objectContaining({ trackingNumber: `OFD-LEGACY-FEE-${suffix}`, reason: "fee_receivable_exists" }),
    ]);
  });
});
