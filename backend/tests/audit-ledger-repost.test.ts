import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { ApiError } from "../src/utils/api-error.js";
import { findUnreversedMoneyPostedEntry } from "../src/services/parcel.service.js";
import { postDeliveryCollection } from "../src/services/ledger.service.js";

describe("audit ledger re-post and MONEY_POSTED gates", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `aud-hub-${suffix}`;
  const shopId = `aud-shop-${suffix}`;
  const dispatcherId = `aud-dispatcher-${suffix}`;
  const financeId = `aud-finance-${suffix}`;
  const riderUserId = `aud-rider-user-${suffix}`;
  const riderId = `aud-rider-${suffix}`;
  const batchId = `aud-batch-${suffix}`;
  const partialParcelId = `aud-partial-${suffix}`;
  const collectionParcelId = `aud-collection-${suffix}`;
  const linkedGroupId = `aud-link-${suffix}`;
  const linkedParcelA = `aud-link-a-${suffix}`;
  const linkedParcelB = `aud-link-b-${suffix}`;
  const businessDate = "2026-08-15";
  const reasonCode = `AUD_PARTIAL_${suffix}`.slice(0, 32).toUpperCase();

  const dispatcherToken = () =>
    signAccessToken({
      sub: dispatcherId,
      email: `dispatcher-${suffix}@example.com`,
      role: "DISPATCHER",
      tokenVersion: 0,
    });
  const financeToken = () =>
    signAccessToken({
      sub: financeId,
      email: `finance-${suffix}@example.com`,
      role: "FINANCE",
      tokenVersion: 0,
    });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Audit hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Audit shop ${suffix}` } });
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
        id: financeId,
        name: "Finance",
        email: `finance-${suffix}@example.com`,
        username: `finance-${suffix}`,
        passwordHash: "test-only",
        role: "FINANCE",
        hubId,
        active: true,
      },
    });
    await prisma.user.create({
      data: {
        id: riderUserId,
        name: "Rider",
        email: `${riderId}@example.com`,
        username: riderId,
        passwordHash: "test-only",
        role: "RIDER",
        hubId,
        active: true,
      },
    });
    await prisma.rider.create({
      data: { id: riderId, userId: riderUserId, hubId, payModel: "PERCENTAGE", commissionRateBps: 4000 },
    });
    await prisma.batch.create({
      data: {
        id: batchId,
        shopId,
        hubId,
        label: `Audit ${suffix}`,
        pickupDate: new Date("2026-08-15T00:00:00.000Z"),
        advancePaid: 5000,
      },
    });
    await prisma.reasonCode.create({
      data: {
        code: reasonCode,
        outcome: "PARTIAL",
        labelEn: "Audit partial",
        labelMy: "စမ်းသပ်",
        active: true,
        noteRequired: false,
      },
    });
    await prisma.parcelLinkGroup.create({
      data: {
        id: linkedGroupId,
        address: "1 Road",
        baseDeliveryFee: 2000,
        totalDeliveryFee: 3000,
      },
    });

    for (const [id, tracking, status, linkGroupId] of [
      [partialParcelId, `AUD-PARTIAL-${suffix}`, "OUT_FOR_DELIVERY", null],
      [collectionParcelId, `AUD-COLL-${suffix}`, "DELIVERED", null],
      [linkedParcelA, `AUD-LA-${suffix}`, "DELIVERED", linkedGroupId],
      [linkedParcelB, `AUD-LB-${suffix}`, "DELIVERED", linkedGroupId],
    ] as const) {
      await prisma.parcel.create({
        data: {
          id,
          batchId,
          trackingNumber: tracking,
          customerName: "Customer",
          address: "1 Road",
          codAmount: 10000,
          deliveryFee: 2000,
          advanceAmount: 2000,
          status,
          riderId,
          linkGroupId,
        },
      });
    }
    await prisma.deliveryWay.create({
      data: {
        parcelId: collectionParcelId,
        riderId,
        commissionRate: 4000,
        commissionAmount: 800,
        outcome: "DELIVERED",
        completedAt: new Date(),
      },
    });
    await prisma.journalEntry.create({
      data: {
        sourceType: "LINKED_RIDER_COMMISSION",
        sourceId: `${linkedGroupId}:prior`,
        hubId,
        businessDate: new Date("2026-08-15T00:00:00.000Z"),
        description: "Versioned live linked commission",
        lines: {
          create: [
            { account: "RIDER_COMMISSION_EXPENSE", debit: 1200, credit: 0 },
            { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 1200 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const parcelIds = [partialParcelId, collectionParcelId, linkedParcelA, linkedParcelB];
    await prisma.alert.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.riderReceivableRecognition.deleteMany({
      where: {
        OR: [
          { sourceId: { in: [...parcelIds, linkedGroupId] } },
          { sourceId: { startsWith: `${partialParcelId}:` } },
          { sourceId: { startsWith: `${collectionParcelId}:` } },
          { sourceId: { startsWith: `${linkedGroupId}:` } },
          { sourceId: { startsWith: `${linkedParcelA}:` } },
          { sourceId: { startsWith: `${linkedParcelB}:` } },
        ],
      },
    });
    await prisma.packageAssignment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    const entries = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { sourceId: { in: [...parcelIds, linkedGroupId] } },
          { sourceId: { startsWith: `${partialParcelId}:` } },
          { sourceId: { startsWith: `${collectionParcelId}:` } },
          { sourceId: { startsWith: `${linkedGroupId}:` } },
          { hubId },
        ],
      },
      select: { id: true },
    });
    const entryIds = entries.map((entry) => entry.id);
    if (entryIds.length) {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
      // Also delete reversals that reference these entries as sourceId
      const reversals = await prisma.journalEntry.findMany({
        where: { sourceType: "LEDGER_REVERSAL", sourceId: { in: entryIds } },
        select: { id: true },
      });
      const reversalIds = reversals.map((entry) => entry.id);
      if (reversalIds.length) {
        await prisma.journalLine.deleteMany({ where: { entryId: { in: reversalIds } } });
        await prisma.journalEntry.deleteMany({ where: { id: { in: reversalIds } } });
      }
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    await prisma.parcel.updateMany({ where: { id: { in: parcelIds } }, data: { linkGroupId: null } });
    await prisma.parcelLinkGroup.deleteMany({ where: { id: linkedGroupId } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, financeId, riderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
    await prisma.reasonCode.deleteMany({ where: { code: reasonCode } });
  });

  test("MONEY_POSTED detects versioned LINKED_* journals (AUD-01)", async () => {
    const posted = await prisma.$transaction((tx) =>
      findUnreversedMoneyPostedEntry(tx, { parcelId: linkedParcelA, linkGroupId: linkedGroupId }),
    );
    expect(posted).toBeTruthy();
  });

  test("re-posts partial return journals after reversal (AUD-02)", async () => {
    const first = await request(app)
      .post(`/api/v1/parcels/${partialParcelId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        status: "PARTIAL",
        reasonCode,
        actualCodCollected: 3000,
        collectionWallet: "CASH",
      });
    expect(first.status).toBe(200);

    for (const sourceType of ["PARTIAL_RETURN_COLLECTION", "OS_PARTIAL_RETURN_ADJUSTMENT"] as const) {
      const entry = await prisma.journalEntry.findFirst({
        where: { sourceType, OR: [{ sourceId: partialParcelId }, { sourceId: { startsWith: `${partialParcelId}:` } }] },
        orderBy: { createdAt: "desc" },
      });
      expect(entry).toBeTruthy();
      const reversal = await request(app)
        .post("/api/v1/finance/ledger/reversals")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({
          sourceType,
          sourceId: entry!.sourceId,
          businessDate,
          reason: "Correct partial money",
        });
      expect(reversal.status).toBe(201);
    }

    const reopen = await request(app)
      .post(`/api/v1/parcels/${partialParcelId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "OUT_FOR_DELIVERY", note: "Re-open after partial reversal" });
    expect(reopen.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/parcels/${partialParcelId}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        status: "PARTIAL",
        reasonCode,
        actualCodCollected: 3000,
        collectionWallet: "CASH",
      });
    expect(second.status).toBe(200);

    const collections = await prisma.journalEntry.findMany({
      where: {
        sourceType: "PARTIAL_RETURN_COLLECTION",
        OR: [{ sourceId: partialParcelId }, { sourceId: { startsWith: `${partialParcelId}:` } }],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(collections.length).toBeGreaterThanOrEqual(2);
    expect(collections.some((entry) => entry.sourceId?.includes(":"))).toBe(true);
  });

  test("re-posts delivery collection after reversal without requiring duplicate live commission (AUD-03)", async () => {
    const first = await postDeliveryCollection(
      {
        parcelId: collectionParcelId,
        businessDate,
        wallet: "CASH",
        collectedCod: 10000,
        collectedDeliveryFee: 2000,
      },
      { id: financeId, role: "FINANCE" },
    );
    expect(first.entry.sourceId).toBe(collectionParcelId);

    const reversal = await request(app)
      .post("/api/v1/finance/ledger/reversals")
      .set("Authorization", `Bearer ${financeToken()}`)
      .send({
        sourceType: "DELIVERY_COLLECTION",
        sourceId: collectionParcelId,
        businessDate,
        reason: "Correct collection",
      });
    expect(reversal.status).toBe(201);

    const second = await postDeliveryCollection(
      {
        parcelId: collectionParcelId,
        businessDate,
        wallet: "CASH",
        collectedCod: 10000,
        collectedDeliveryFee: 2000,
      },
      { id: financeId, role: "FINANCE" },
    );
    expect(second.entry.sourceId?.startsWith(`${collectionParcelId}:`)).toBe(true);

    await expect(
      postDeliveryCollection(
        {
          parcelId: collectionParcelId,
          businessDate,
          wallet: "CASH",
          collectedCod: 10000,
          collectedDeliveryFee: 2000,
        },
        { id: financeId, role: "FINANCE" },
      ),
    ).rejects.toMatchObject({ code: "COLLECTION_EXISTS", status: 409 } satisfies Partial<ApiError>);
  });

  test("re-posts linked commission after reversal without double live journal", async () => {
    // Seed delivery ways so group completion path can allocate commission.
    for (const parcelId of [linkedParcelA, linkedParcelB]) {
      await prisma.deliveryWay.create({
        data: {
          parcelId,
          riderId,
          commissionRate: 4000,
          commissionAmount: 600,
          outcome: "DELIVERED",
          completedAt: new Date(),
        },
      });
    }

    const prior = await prisma.journalEntry.findFirst({
      where: { sourceType: "LINKED_RIDER_COMMISSION", sourceId: { startsWith: `${linkedGroupId}:` } },
    });
    expect(prior).toBeTruthy();

    const reversal = await request(app)
      .post("/api/v1/finance/ledger/reversals")
      .set("Authorization", `Bearer ${financeToken()}`)
      .send({
        sourceType: "LINKED_RIDER_COMMISSION",
        sourceId: prior!.sourceId,
        businessDate,
        reason: "Correct linked commission",
      });
    expect(reversal.status).toBe(201);

    // Re-enter final member DELIVERED via override-style OFD → DELIVERED on B after marking not delivered briefly.
    await prisma.parcel.update({ where: { id: linkedParcelB }, data: { status: "OUT_FOR_DELIVERY" } });
    const redeiver = await request(app)
      .post(`/api/v1/parcels/${linkedParcelB}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "DELIVERED" });
    expect(redeiver.status).toBe(200);

    const commissions = await prisma.journalEntry.findMany({
      where: {
        sourceType: "LINKED_RIDER_COMMISSION",
        OR: [{ sourceId: linkedGroupId }, { sourceId: { startsWith: `${linkedGroupId}:` } }],
      },
      orderBy: { createdAt: "asc" },
    });
    expect(commissions.length).toBeGreaterThanOrEqual(2);

    const live: string[] = [];
    for (const entry of commissions) {
      const rev = await prisma.journalEntry.findUnique({
        where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: entry.id } },
      });
      if (!rev) live.push(entry.sourceId!);
    }
    expect(live).toHaveLength(1);
    expect(live[0] === linkedGroupId || live[0]!.startsWith(`${linkedGroupId}:`)).toBe(true);
  });
});
