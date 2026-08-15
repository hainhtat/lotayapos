import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { buildDeliveryCollectionLines } from "../src/services/ledger.service.js";
import { buildPickupAdvanceJournalLines } from "../src/services/operations.service.js";

describe("parcel corrections and delivery fee edits", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `pc-hub-${suffix}`;
  const shopId = `pc-shop-${suffix}`;
  const dispatcherId = `pc-dispatcher-${suffix}`;
  const financeUserId = `pc-finance-${suffix}`;
  const rider1Id = `pc-rider1-${suffix}`;
  const rider2Id = `pc-rider2-${suffix}`;
  const rider1UserId = `pc-rider1-user-${suffix}`;
  const rider2UserId = `pc-rider2-user-${suffix}`;
  const batchId = `pc-batch-${suffix}`;
  const advanceBatchId = `pc-advance-batch-${suffix}`;
  const parcelId = `pc-parcel-${suffix}`;
  const editableParcelId = `pc-editable-parcel-${suffix}`;
  const deliveredEditParcelId = `pc-delivered-edit-parcel-${suffix}`;
  const advanceParcelId = `pc-advance-parcel-${suffix}`;
  const moneyPostedParcelId = `pc-money-parcel-${suffix}`;
  const editableBatchId = `pc-editable-batch-${suffix}`;
  const deliveredEditBatchId = `pc-delivered-edit-batch-${suffix}`;
  const moneyPostedBatchId = `pc-money-batch-${suffix}`;
  const businessDate = new Date("2026-08-13T00:00:00.000Z");

  const dispatcherToken = () =>
    signAccessToken({
      sub: dispatcherId,
      email: `dispatcher-${suffix}@example.com`,
      role: "DISPATCHER",
      tokenVersion: 0,
    });
  const financeToken = () =>
    signAccessToken({
      sub: financeUserId,
      email: `finance-${suffix}@example.com`,
      role: "FINANCE",
      tokenVersion: 0,
    });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Parcel corrections hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Parcel corrections shop ${suffix}` } });
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
        id: financeUserId,
        name: "Finance",
        email: `finance-${suffix}@example.com`,
        username: `finance-${suffix}`,
        passwordHash: "test-only",
        role: "FINANCE",
        hubId,
        active: true,
      },
    });
    for (const [userId, riderId, label] of [
      [rider1UserId, rider1Id, "Rider One"],
      [rider2UserId, rider2Id, "Rider Two"],
    ] as const) {
      await prisma.user.create({
        data: {
          id: userId,
          name: label,
          email: `${riderId}@example.com`,
          username: riderId,
          passwordHash: "test-only",
          role: "RIDER",
          hubId,
          active: true,
        },
      });
      await prisma.rider.create({
        data: {
          id: riderId,
          userId,
          hubId,
          payModel: "PERCENTAGE",
          commissionRateBps: 4000,
        },
      });
    }

    const batchDefaults = { shopId, hubId, advancePaid: 5000 };
    const batchRows = [
      [batchId, `Batch ${suffix}`, new Date("2026-08-13T00:00:00.000Z")],
      [editableBatchId, `Editable batch ${suffix}`, new Date("2026-08-14T00:00:00.000Z")],
      [deliveredEditBatchId, `Delivered edit batch ${suffix}`, new Date("2026-08-15T00:00:00.000Z")],
      [advanceBatchId, `Advance batch ${suffix}`, new Date("2026-08-16T00:00:00.000Z")],
      [moneyPostedBatchId, `Money posted batch ${suffix}`, new Date("2026-08-17T00:00:00.000Z")],
    ] as const;
    for (const [id, label, pickupDate] of batchRows) {
      await prisma.batch.create({ data: { id, label, pickupDate, ...batchDefaults } });
    }

    const parcelDefaults = {
      customerName: "Customer",
      address: "123 Main Road",
      codAmount: 100000,
      deliveryFee: 3000,
      advanceAmount: 5000,
      status: "ASSIGNED" as const,
    };
    for (const [id, batch, trackingNumber] of [
      [parcelId, batchId, `PC-${suffix}`],
      [editableParcelId, editableBatchId, `PC-EDIT-${suffix}`],
      [deliveredEditParcelId, deliveredEditBatchId, `PC-DLV-EDIT-${suffix}`],
    ] as const) {
      await prisma.parcel.create({
        data: {
          id,
          batchId: batch,
          trackingNumber,
          riderId: rider1Id,
          ...parcelDefaults,
        },
      });
    }
    await prisma.parcel.create({
      data: {
        id: advanceParcelId,
        batchId: advanceBatchId,
        trackingNumber: `PC-ADV-${suffix}`,
        riderId: rider1Id,
        ...parcelDefaults,
      },
    });
    await prisma.parcel.create({
      data: {
        id: moneyPostedParcelId,
        batchId: moneyPostedBatchId,
        trackingNumber: `PC-MNY-${suffix}`,
        riderId: rider1Id,
        ...parcelDefaults,
      },
    });

    await prisma.journalEntry.create({
      data: {
        sourceType: "BATCH_PICKUP_ADVANCE",
        sourceId: advanceBatchId,
        hubId,
        businessDate,
        description: "Posted advance for guard test",
        lines: { create: buildPickupAdvanceJournalLines(5000, "CASH") },
      },
    });
  });

  afterAll(async () => {
    const parcelIds = [parcelId, editableParcelId, deliveredEditParcelId, advanceParcelId, moneyPostedParcelId];
    const batchIds = [batchId, editableBatchId, deliveredEditBatchId, advanceBatchId, moneyPostedBatchId];
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.settlementLine.deleteMany({ where: { settlement: { riderId: { in: [rider1Id, rider2Id] } } } });
    await prisma.settlement.deleteMany({ where: { riderId: { in: [rider1Id, rider2Id] } } });
    await prisma.riderReceivableRecognition.deleteMany({
      where: {
        OR: [
          { sourceId: { in: parcelIds } },
          { sourceId: { startsWith: `${parcelId}:` } },
          { sourceId: { startsWith: `${moneyPostedParcelId}:` } },
          { riderId: { in: [rider1Id, rider2Id] } },
        ],
      },
    });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.packageAssignment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.journalLine.deleteMany({
      where: {
        entry: {
          OR: [
            { sourceId: { in: [...parcelIds, ...batchIds] } },
            { sourceId: { startsWith: `${parcelId}:` } },
            { sourceId: { startsWith: `${moneyPostedParcelId}:` } },
            { hubId },
          ],
        },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        OR: [
          { sourceId: { in: [...parcelIds, ...batchIds] } },
          { sourceId: { startsWith: `${parcelId}:` } },
          { sourceId: { startsWith: `${moneyPostedParcelId}:` } },
          { hubId },
        ],
      },
    });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.rider.deleteMany({ where: { id: { in: [rider1Id, rider2Id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, financeUserId, rider1UserId, rider2UserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  async function deliverParcel(id: string) {
    const response = await request(app)
      .post(`/api/v1/parcels/${id}/status`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ status: "DELIVERED", note: "Integration test delivery override" });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("DELIVERED");
  }

  test("updates delivery fee on an editable assigned parcel", async () => {
    const response = await request(app)
      .patch(`/api/v1/parcels/${editableParcelId}`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ deliveryFee: 3500 });

    expect(response.status).toBe(200);
    expect(response.body.data.deliveryFee).toBe(3500);

    const stored = await prisma.parcel.findUniqueOrThrow({ where: { id: editableParcelId }, select: { deliveryFee: true } });
    expect(stored.deliveryFee).toBe(3500);
  });

  test("blocks delivery fee edits after batch pickup advance is posted", async () => {
    const response = await request(app)
      .patch(`/api/v1/parcels/${advanceParcelId}`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ deliveryFee: 3500 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ADVANCE_POSTED");
    expect(response.body.error.message).toMatch(/delivery fee/i);
  });

  test("blocks delivery fee edits on delivered parcels", async () => {
    await deliverParcel(deliveredEditParcelId);

    const response = await request(app)
      .patch(`/api/v1/parcels/${deliveredEditParcelId}`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ deliveryFee: 4000 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PARCEL_NOT_EDITABLE");
  });

  test("corrects a delivered parcel rider by reversing and re-posting receivable and commission", async () => {
    await deliverParcel(parcelId);

    const response = await request(app)
      .post(`/api/v1/operations/parcels/${parcelId}/correct-rider`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ riderId: rider2Id, reason: "Wrong rider before settlement" });

    expect(response.status).toBe(200);
    expect(response.body.data.rider.id).toBe(rider2Id);

    const recognition = await prisma.riderReceivableRecognition.findFirst({
      where: { riderId: rider2Id, sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: { startsWith: parcelId } },
      orderBy: { createdAt: "desc" },
    });
    expect(recognition?.riderId).toBe(rider2Id);
    expect(recognition?.deliveryFee).toBe(3000);
    expect(recognition?.commissionAmount).toBe(1200);

    const oldRiderCorrection = await prisma.riderReceivableRecognition.findFirst({
      where: { riderId: rider1Id, sourceType: "RIDER_RECEIVABLE_CORRECTION", sourceId: { startsWith: `${parcelId}:reverse:` } },
    });
    expect(oldRiderCorrection?.receivableAmount).toBe(-(100000 + 3000 - 1200));

    const receivableJournal = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcelId } },
      select: { id: true },
    });
    expect(receivableJournal).toBeTruthy();
    const receivableReversal = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: receivableJournal!.id } },
    });
    expect(receivableReversal).toBeTruthy();

    const originalCommission = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelId } },
      select: { id: true },
    });
    expect(originalCommission).toBeTruthy();
    const commissionReversal = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: originalCommission!.id } },
    });
    expect(commissionReversal).toBeTruthy();

    const repostedCommission = await prisma.journalEntry.findFirst({
      where: { sourceType: "RIDER_COMMISSION", sourceId: { startsWith: `${parcelId}:` } },
    });
    expect(repostedCommission).toBeTruthy();

    const repostedReceivable = await prisma.journalEntry.findFirst({
      where: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: { startsWith: `${parcelId}:` } },
    });
    expect(repostedReceivable).toBeTruthy();

    const history = await prisma.statusHistory.findFirst({
      where: { parcelId, note: { contains: "Correct rider" } },
      orderBy: { createdAt: "desc" },
    });
    expect(history?.fromStatus).toBe("DELIVERED");
    expect(history?.toStatus).toBe("DELIVERED");
    expect(history?.note).toContain("Rider One");
    expect(history?.note).toContain("Rider Two");
  });

  test("flags advancePosted on listBatches from pickup-advance journal entries", async () => {
    const response = await request(app)
      .get("/api/v1/operations/batches")
      .set("Authorization", `Bearer ${financeToken()}`);

    expect(response.status).toBe(200);
    const batches = response.body.data as Array<{ id: string; advancePosted: boolean }>;
    expect(batches.find((row) => row.id === advanceBatchId)?.advancePosted).toBe(true);
    expect(batches.find((row) => row.id === batchId)?.advancePosted).toBe(false);
  });

  test("treats reversed pickup advances as unposted and allows Finance to re-post", async () => {
    const reverseBatchId = `pc-rev-advance-batch-${suffix}`;
    const reverseParcelId = `pc-rev-advance-parcel-${suffix}`;

    const cleanup = async () => {
      const advances = await prisma.journalEntry.findMany({
        where: {
          OR: [
            { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: reverseBatchId },
            { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: { startsWith: `${reverseBatchId}:` } },
          ],
        },
        select: { id: true },
      });
      const entryIds = advances.map((entry) => entry.id);
      await prisma.journalLine.deleteMany({
        where: {
          entry: {
            OR: [
              { id: { in: entryIds } },
              { sourceType: "LEDGER_REVERSAL", sourceId: { in: entryIds } },
            ],
          },
        },
      });
      await prisma.journalEntry.deleteMany({
        where: {
          OR: [
            { id: { in: entryIds } },
            { sourceType: "LEDGER_REVERSAL", sourceId: { in: entryIds } },
          ],
        },
      });
      await prisma.parcel.deleteMany({ where: { id: reverseParcelId } });
      await prisma.batch.deleteMany({ where: { id: reverseBatchId } });
    };

    await cleanup();
    try {
      await prisma.batch.create({
        data: {
          id: reverseBatchId,
          shopId,
          hubId,
          label: `Reversal advance batch ${suffix}`,
          pickupDate: new Date("2026-08-18T00:00:00.000Z"),
          advancePaid: 5000,
        },
      });
      await prisma.parcel.create({
        data: {
          id: reverseParcelId,
          batchId: reverseBatchId,
          trackingNumber: `PC-REV-ADV-${suffix}`,
          riderId: rider1Id,
          customerName: "Customer",
          address: "123 Main Road",
          codAmount: 100000,
          deliveryFee: 3000,
          advanceAmount: 5000,
          status: "ASSIGNED",
        },
      });

      const posted = await request(app)
        .post(`/api/v1/operations/batches/${reverseBatchId}/pickup-advances`)
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ fundingWallet: "CASH" });
      expect(posted.status).toBe(200);
      expect(posted.body.data).toMatchObject({ alreadyPosted: false, postedCount: 1 });

      const listedPosted = await request(app)
        .get("/api/v1/operations/batches")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(listedPosted.body.data.find((row: { id: string }) => row.id === reverseBatchId)?.advancePosted).toBe(true);

      const reversal = await request(app)
        .post("/api/v1/finance/ledger/reversals")
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({
          sourceType: "BATCH_PICKUP_ADVANCE",
          sourceId: reverseBatchId,
          businessDate: "2026-08-18",
          reason: "Advance posted to wrong wallet",
        });
      expect(reversal.status).toBe(201);

      const listedAfterReversal = await request(app)
        .get("/api/v1/operations/batches")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(listedAfterReversal.body.data.find((row: { id: string }) => row.id === reverseBatchId)?.advancePosted).toBe(false);

      // After reversal, Finance must be able to re-post (versioned sourceId; unique key cannot reuse batchId alone).
      const repost = await request(app)
        .post(`/api/v1/operations/batches/${reverseBatchId}/pickup-advances`)
        .set("Authorization", `Bearer ${financeToken()}`)
        .send({ fundingWallet: "KBZ_PAY" });
      expect(repost.status).toBe(200);
      expect(repost.body.data).toMatchObject({ alreadyPosted: false, postedCount: 1 });

      const advances = await prisma.journalEntry.findMany({
        where: {
          OR: [
            { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: reverseBatchId },
            { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: { startsWith: `${reverseBatchId}:` } },
          ],
        },
        include: { lines: true },
        orderBy: { createdAt: "asc" },
      });
      const liveAdvances = [];
      for (const entry of advances) {
        const rev = await prisma.journalEntry.findUnique({
          where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: entry.id } },
        });
        if (!rev) liveAdvances.push(entry);
      }
      expect(liveAdvances).toHaveLength(1);
      expect(liveAdvances[0]!.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ account: "OS_ADVANCE_RECEIVABLE", debit: 5000, credit: 0 }),
          expect.objectContaining({ account: "WALLET_KBZ_PAY", debit: 0, credit: 5000 }),
        ]),
      );

      const listedReposted = await request(app)
        .get("/api/v1/operations/batches")
        .set("Authorization", `Bearer ${financeToken()}`);
      expect(listedReposted.body.data.find((row: { id: string }) => row.id === reverseBatchId)?.advancePosted).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("blocks rider correction when finance collection is already posted", async () => {
    await deliverParcel(moneyPostedParcelId);

    const collection = buildDeliveryCollectionLines({
      collectedCod: 100000,
      collectedDeliveryFee: 3000,
      advanceAmount: 5000,
      wallet: "CASH",
    });
    await prisma.journalEntry.create({
      data: {
        sourceType: "DELIVERY_COLLECTION",
        sourceId: moneyPostedParcelId,
        hubId,
        businessDate,
        description: "Posted collection blocks rider correction",
        lines: { create: collection.lines },
      },
    });

    const response = await request(app)
      .post(`/api/v1/operations/parcels/${moneyPostedParcelId}/correct-rider`)
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({ riderId: rider2Id, reason: "Should be blocked by posted collection" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MONEY_POSTED");
  });

});
