import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { assertBalancedLines, buildPartialReturnAdjustmentLines, buildReturnDeductionLines } from "../src/services/ledger.service.js";
import {
  recoverableAdvance,
  sumUnreversedCreditsToOsAdvanceReceivable,
  sumUnreversedDebitsToOsSettlementOffset,
} from "../src/services/os-advance.js";

describe("Finance OS pending-return recovery", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `pr-hub-${suffix}`;
  const shopId = `pr-shop-${suffix}`;
  const financeId = `pr-finance-${suffix}`;
  const ids = {
    failedParcel: `pr-failed-${suffix}`,
    partialParcel: `pr-partial-${suffix}`,
    fullOffsetParcel: `pr-full-${suffix}`,
    failedBatch: `pr-batch-failed-${suffix}`,
    partialBatch: `pr-batch-partial-${suffix}`,
    fullBatch: `pr-batch-full-${suffix}`,
    deliveredBatch: `pr-batch-delivered-${suffix}`,
    deliveredParcel: `pr-delivered-${suffix}`,
    idempotencyParcel: `pr-idem-${suffix}`,
    idempotencyBatch: `pr-batch-idem-${suffix}`,
    incompleteParcel: `pr-incomplete-${suffix}`,
    incompleteBatch: `pr-batch-incomplete-${suffix}`,
    repostParcel: `pr-repost-${suffix}`,
    repostBatch: `pr-batch-repost-${suffix}`,
  };

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `PR Hub ${suffix}` } });
    await prisma.user.create({
      data: {
        id: financeId,
        name: "Finance PR",
        email: `finance-pr-${suffix}@example.com`,
        username: `finance-pr-${suffix}`,
        passwordHash: "test-only",
        role: "FINANCE",
        hubId,
      },
    });
    await prisma.onlineShop.create({ data: { id: shopId, name: `PR Shop ${suffix}` } });
    const pickupDate = new Date("2026-08-13T00:00:00.000Z");
    await prisma.batch.create({
      data: {
        id: ids.failedBatch,
        shopId,
        hubId,
        label: `Failed batch ${suffix}`,
        pickupDate,
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.partialBatch,
        shopId,
        hubId,
        label: `Partial batch ${suffix}`,
        pickupDate: new Date("2026-08-14T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.fullBatch,
        shopId,
        hubId,
        label: `Full offset batch ${suffix}`,
        pickupDate: new Date("2026-08-15T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.deliveredBatch,
        shopId,
        hubId,
        label: `Delivered batch ${suffix}`,
        pickupDate: new Date("2026-08-16T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.idempotencyBatch,
        shopId,
        hubId,
        label: `Idempotency batch ${suffix}`,
        pickupDate: new Date("2026-08-17T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.incompleteBatch,
        shopId,
        hubId,
        label: `Incomplete batch ${suffix}`,
        pickupDate: new Date("2026-08-18T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.batch.create({
      data: {
        id: ids.repostBatch,
        shopId,
        hubId,
        label: `Repost batch ${suffix}`,
        pickupDate: new Date("2026-08-19T00:00:00.000Z"),
        advancePaid: 8000,
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.failedParcel,
        batchId: ids.failedBatch,
        trackingNumber: `PR-FAILED-${suffix}`,
        customerName: "Failed Customer",
        address: "Address 1",
        codAmount: 10000,
        advanceAmount: 8000,
        status: "FAILED",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.partialParcel,
        batchId: ids.partialBatch,
        trackingNumber: `PR-PARTIAL-${suffix}`,
        customerName: "Partial Customer",
        address: "Address 2",
        codAmount: 10000,
        advanceAmount: 8000,
        actualCodCollected: 6000,
        partialReturnShortfall: 4000,
        status: "PARTIAL",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.fullOffsetParcel,
        batchId: ids.fullBatch,
        trackingNumber: `PR-FULL-${suffix}`,
        customerName: "Full Offset Customer",
        address: "Address 3",
        codAmount: 8000,
        advanceAmount: 8000,
        actualCodCollected: 0,
        partialReturnShortfall: 8000,
        status: "PARTIAL",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.deliveredParcel,
        batchId: ids.deliveredBatch,
        trackingNumber: `PR-DELIVERED-${suffix}`,
        customerName: "Delivered Customer",
        address: "Address 4",
        codAmount: 50000,
        advanceAmount: 8000,
        deliveryFee: 1000,
        status: "DELIVERED",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.idempotencyParcel,
        batchId: ids.idempotencyBatch,
        trackingNumber: `PR-IDEM-${suffix}`,
        customerName: "Idempotency Customer",
        address: "Address 5",
        codAmount: 10000,
        advanceAmount: 8000,
        status: "FAILED",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.incompleteParcel,
        batchId: ids.incompleteBatch,
        trackingNumber: `PR-INCOMPLETE-${suffix}`,
        customerName: "Incomplete Customer",
        address: "Address 6",
        codAmount: 10000,
        advanceAmount: 8000,
        status: "RETURNED",
      },
    });
    await prisma.parcel.create({
      data: {
        id: ids.repostParcel,
        batchId: ids.repostBatch,
        trackingNumber: `PR-REPOST-${suffix}`,
        customerName: "Repost Customer",
        address: "Address 7",
        codAmount: 10000,
        advanceAmount: 8000,
        status: "FAILED",
      },
    });
    const businessDate = new Date("2026-08-13T00:00:00.000Z");
    await prisma.journalEntry.create({
      data: {
        sourceType: "OS_PARTIAL_RETURN_ADJUSTMENT",
        sourceId: ids.partialParcel,
        hubId,
        businessDate,
        description: "Partial offset 4000",
        lines: { create: buildPartialReturnAdjustmentLines(4000) },
      },
    });
    await prisma.journalEntry.create({
      data: {
        sourceType: "OS_PARTIAL_RETURN_ADJUSTMENT",
        sourceId: ids.fullOffsetParcel,
        hubId,
        businessDate,
        description: "Partial offset 8000",
        lines: { create: buildPartialReturnAdjustmentLines(8000) },
      },
    });
    await prisma.journalEntry.create({
      data: {
        sourceType: "OS_RETURN_DEDUCTION",
        sourceId: ids.incompleteParcel,
        hubId,
        businessDate,
        description: "Partial return deduction 3000",
        lines: { create: buildReturnDeductionLines(3000) },
      },
    });
  });

  afterAll(async () => {
    const parcelIds = [
      ids.failedParcel,
      ids.partialParcel,
      ids.fullOffsetParcel,
      ids.deliveredParcel,
      ids.idempotencyParcel,
      ids.incompleteParcel,
      ids.repostParcel,
    ];
    const batchIds = [
      ids.failedBatch,
      ids.partialBatch,
      ids.fullBatch,
      ids.deliveredBatch,
      ids.idempotencyBatch,
      ids.incompleteBatch,
      ids.repostBatch,
    ];
    await prisma.osSettlementBatch.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.osSettlement.deleteMany({ where: { hubId } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.journalLine.deleteMany({
      where: { entry: { OR: [{ sourceId: { in: parcelIds } }, { sourceId: { startsWith: `${ids.repostParcel}:` } }, { hubId }] } },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        OR: [
          { sourceId: { in: parcelIds } },
          { sourceId: { startsWith: `${ids.repostParcel}:` } },
          { hubId },
        ],
      },
    });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: financeId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  const auth = () =>
    `Bearer ${signAccessToken({
      sub: financeId,
      email: `finance-pr-${suffix}@example.com`,
      role: "FINANCE",
      tokenVersion: 0,
    })}`;

  async function hubOffsetBalance() {
    const lines = await prisma.journalLine.findMany({
      where: { account: "OS_SETTLEMENT_OFFSET", entry: { hubId } },
      select: { debit: true, credit: true },
    });
    return lines.reduce((sum, line) => sum + line.debit - line.credit, 0);
  }

  async function hubWalletCashBalance() {
    const lines = await prisma.journalLine.findMany({
      where: { account: "WALLET_CASH", entry: { hubId } },
      select: { debit: true, credit: true },
    });
    return lines.reduce((sum, line) => sum + line.debit - line.credit, 0);
  }

  test("lists pending returns with recoverable amounts", async () => {
    const response = await request(app)
      .get(`/api/v1/finance/os-pending-returns?shopId=${shopId}`)
      .set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.data.summary.count).toBe(5);
    const byId = Object.fromEntries(
      response.body.data.items.map((item: { id: string }) => [item.id, item]),
    );
    expect(byId[ids.failedParcel].recoverableAmount).toBe(8000);
    expect(byId[ids.failedParcel].priorOffsetAmount).toBe(0);
    expect(byId[ids.partialParcel].recoverableAmount).toBe(4000);
    expect(byId[ids.partialParcel].priorOffsetAmount).toBe(4000);
    expect(byId[ids.fullOffsetParcel].recoverableAmount).toBe(0);
    expect(byId[ids.idempotencyParcel].recoverableAmount).toBe(8000);
    expect(byId[ids.repostParcel].recoverableAmount).toBe(8000);
    expect(byId[ids.deliveredParcel]).toBeUndefined();
    expect(response.body.data.summary.totalRecoverableAmount).toBe(28000);
  });

  test("rejects receive without a required idempotencyKey", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.idempotencyParcel, businessDate: "2026-08-13" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("FAILED receive posts full advance deduction without wallet lines", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.failedParcel, businessDate: "2026-08-13", idempotencyKey: `recv-failed-${suffix}` });
    expect(response.status).toBe(201);
    expect(response.body.data.parcel.status).toBe("RETURNED");
    expect(response.body.data.recoverableAmount).toBe(8000);
    expect(response.body.data.journalEntry.sourceType).toBe("OS_RETURN_DEDUCTION");
    const lines = response.body.data.journalEntry.lines as Array<{ account: string; debit: number; credit: number }>;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "OS_SETTLEMENT_OFFSET", debit: 8000, credit: 0 }),
        expect.objectContaining({ account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 8000 }),
      ]),
    );
    expect(assertBalancedLines(lines)).toEqual({ debit: 8000, credit: 8000 });
    expect(lines.some((line) => line.account.startsWith("WALLET_"))).toBe(false);
    const parcel = await prisma.parcel.findUniqueOrThrow({ where: { id: ids.failedParcel } });
    expect(parcel.status).toBe("RETURNED");

    const pending = await request(app)
      .get(`/api/v1/finance/os-pending-returns?shopId=${shopId}`)
      .set("Authorization", auth());
    expect(pending.status).toBe(200);
    expect(pending.body.data.items.some((item: { id: string }) => item.id === ids.failedParcel)).toBe(false);

    const drafts = await request(app)
      .get(`/api/v1/finance/os-settlement-drafts?shopId=${shopId}`)
      .set("Authorization", auth());
    expect(drafts.status).toBe(200);
    const failedDraft = drafts.body.data.find((batch: { id: string }) => batch.id === ids.failedBatch);
    expect(failedDraft.returnedAdvance).toBe(8000);
  });

  test("PARTIAL receive deducts only the unrecovered remainder", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.partialParcel, businessDate: "2026-08-13", idempotencyKey: `recv-partial-${suffix}` });
    expect(response.status).toBe(201);
    expect(response.body.data.parcel.status).toBe("RETURNED");
    expect(response.body.data.recoverableAmount).toBe(4000);
    const credited = response.body.data.journalEntry.lines
      .filter((line: { account: string }) => line.account === "OS_ADVANCE_RECEIVABLE")
      .reduce((sum: number, line: { credit: number }) => sum + line.credit, 0);
    expect(credited).toBe(4000);
  });

  test("PARTIAL with full advance already offset returns without a new journal", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.fullOffsetParcel, businessDate: "2026-08-13", idempotencyKey: `recv-full-${suffix}` });
    expect(response.status).toBe(201);
    expect(response.body.data.parcel.status).toBe("RETURNED");
    expect(response.body.data.recoverableAmount).toBe(0);
    expect(response.body.data.journalEntry).toBeNull();
    const deduction = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "OS_RETURN_DEDUCTION", sourceId: ids.fullOffsetParcel } },
    });
    expect(deduction).toBeNull();
  });

  test("receive is idempotent for an already-received parcel", async () => {
    const first = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.failedParcel, businessDate: "2026-08-13", idempotencyKey: `recv-failed-${suffix}` });
    expect(first.status).toBe(200);
    expect(first.body.data.alreadyReceived).toBe(true);
    expect(first.body.data.replay).toBe(true);
    expect(first.body.data.journalEntry.sourceType).toBe("OS_RETURN_DEDUCTION");
    const count = await prisma.journalEntry.count({
      where: { sourceType: "OS_RETURN_DEDUCTION", sourceId: ids.failedParcel },
    });
    expect(count).toBe(1);
  });

  test("rejects idempotency key reuse with a different businessDate", async () => {
    const key = `recv-idem-${suffix}`;
    const first = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.idempotencyParcel, businessDate: "2026-08-13", idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(first.body.data.parcel.status).toBe("RETURNED");

    const conflict = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.idempotencyParcel, businessDate: "2026-08-14", idempotencyKey: key });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const replay = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.idempotencyParcel, businessDate: "2026-08-13", idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.body.data.alreadyReceived).toBe(true);
    expect(replay.body.data.replay).toBe(true);
  });

  test("rejects receive for DELIVERED parcels", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({
        parcelId: ids.deliveredParcel,
        businessDate: "2026-08-13",
        idempotencyKey: `recv-delivered-${suffix}`,
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_RETURN_STATUS");
    const parcel = await prisma.parcel.findUniqueOrThrow({ where: { id: ids.deliveredParcel } });
    expect(parcel.status).toBe("DELIVERED");
  });

  test("settlement returnedAdvance includes staged offsets after receive", async () => {
    const drafts = await request(app)
      .get(`/api/v1/finance/os-settlement-drafts?shopId=${shopId}`)
      .set("Authorization", auth());
    expect(drafts.status).toBe(200);
    const byId = Object.fromEntries(
      drafts.body.data.map((batch: { id: string; returnedAdvance: number }) => [batch.id, batch]),
    );
    expect(byId[ids.failedBatch].returnedAdvance).toBe(8000);
    expect(byId[ids.partialBatch].returnedAdvance).toBe(8000);
    expect(byId[ids.fullBatch].returnedAdvance).toBe(8000);
  });

  test("OS settlement clears staged OFFSET and reduces net payable after receive", async () => {
    const stagedBefore = await sumUnreversedDebitsToOsSettlementOffset(prisma, ids.failedParcel);
    expect(stagedBefore).toBe(8000);
    const offsetBeforeSettle = await hubOffsetBalance();
    const walletBeforeSettle = await hubWalletCashBalance();

    const preview = await request(app)
      .post("/api/v1/finance/os-settlements/preview")
      .set("Authorization", auth())
      .send({
        shopId,
        hubId,
        batchIds: [ids.deliveredBatch, ids.failedBatch],
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.defaults.returnDeduction).toBe(8000);
    expect(preview.body.data.defaults.netAmount).toBe(33000);

    const settlement = await request(app)
      .post("/api/v1/finance/os-settlements")
      .set("Authorization", auth())
      .send({
        shopId,
        hubId,
        batchIds: [ids.deliveredBatch, ids.failedBatch],
        businessDate: "2026-08-13",
        wallet: "CASH",
        idempotencyKey: `os-settle-${suffix}`,
      });
    expect(settlement.status).toBe(201);
    expect(settlement.body.data.netAmount).toBe(33000);
    const offsetCredit = settlement.body.data.journalEntry.lines.find(
      (line: { account: string; credit: number }) => line.account === "OS_SETTLEMENT_OFFSET",
    );
    expect(offsetCredit?.credit).toBe(8000);
    expect(
      settlement.body.data.journalEntry.lines.some(
        (line: { account: string }) => line.account === "OS_RETURN_DEDUCTION",
      ),
    ).toBe(false);
    const walletCredit = settlement.body.data.journalEntry.lines.find(
      (line: { account: string; credit: number }) => line.account === "WALLET_CASH",
    );
    expect(walletCredit?.credit).toBe(33000);

    expect(await hubOffsetBalance()).toBe(offsetBeforeSettle - 8000);
    expect(await hubWalletCashBalance()).toBe(walletBeforeSettle - 33000);
  });

  test("rejects return-deduction re-post when an unreversed deduction under-covers remainder", async () => {
    const ledger = await request(app)
      .post("/api/v1/finance/ledger/return-deductions")
      .set("Authorization", auth())
      .send({ parcelId: ids.incompleteParcel, businessDate: "2026-08-13", amount: 5000 });
    expect(ledger.status).toBe(409);
    expect(ledger.body.error.code).toBe("DEDUCTION_INCOMPLETE");

    const receive = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.incompleteParcel, businessDate: "2026-08-13", idempotencyKey: `recv-incomplete-${suffix}` });
    expect(receive.status).toBe(409);
    expect(receive.body.error.code).toBe("DEDUCTION_INCOMPLETE");
  });

  test("allows versioned return-deduction re-post after reversal", async () => {
    const receive = await request(app)
      .post("/api/v1/finance/os-returns/receive")
      .set("Authorization", auth())
      .send({ parcelId: ids.repostParcel, businessDate: "2026-08-13", idempotencyKey: `recv-repost-${suffix}` });
    expect(receive.status).toBe(201);
    expect(receive.body.data.journalEntry.sourceId).toBe(ids.repostParcel);

    const reverse = await request(app)
      .post("/api/v1/finance/ledger/reversals")
      .set("Authorization", auth())
      .send({
        sourceType: "OS_RETURN_DEDUCTION",
        sourceId: ids.repostParcel,
        businessDate: "2026-08-13",
        reason: "Correct deduction amount",
      });
    expect(reverse.status).toBe(201);
    expect(await sumUnreversedCreditsToOsAdvanceReceivable(prisma, ids.repostParcel)).toBe(0);
    expect(await sumUnreversedDebitsToOsSettlementOffset(prisma, ids.repostParcel)).toBe(0);
    expect(await recoverableAdvance(prisma, { id: ids.repostParcel, advanceAmount: 8000 })).toBe(8000);

    const repost = await request(app)
      .post("/api/v1/finance/ledger/return-deductions")
      .set("Authorization", auth())
      .send({ parcelId: ids.repostParcel, businessDate: "2026-08-13", amount: 8000 });
    expect(repost.status).toBe(201);
    expect(repost.body.data.sourceId).toMatch(new RegExp(`^${ids.repostParcel}:`));
    const credited = repost.body.data.lines
      .filter((line: { account: string }) => line.account === "OS_ADVANCE_RECEIVABLE")
      .reduce((sum: number, line: { credit: number }) => sum + line.credit, 0);
    expect(credited).toBe(8000);
    expect(await sumUnreversedCreditsToOsAdvanceReceivable(prisma, ids.repostParcel)).toBe(8000);
    expect(await sumUnreversedDebitsToOsSettlementOffset(prisma, ids.repostParcel)).toBe(8000);
    expect(await recoverableAdvance(prisma, { id: ids.repostParcel, advanceAmount: 8000 })).toBe(0);

    const drafts = await request(app)
      .get(`/api/v1/finance/os-settlement-drafts?shopId=${shopId}`)
      .set("Authorization", auth());
    expect(drafts.status).toBe(200);
    const repostDraft = drafts.body.data.find((batch: { id: string }) => batch.id === ids.repostBatch);
    expect(repostDraft.returnedAdvance).toBe(8000);
  });
});
