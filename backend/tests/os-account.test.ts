import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { attributableLegacyBatchPayment, buildCutoverAdjustmentLines, requiredOpeningAdjustment } from "../src/services/os-account.service.js";

describe("OS cutover reconciliation", () => {
  test("uses attributable legacy batch evidence and exposes settlement-level differences", () => {
    const attributable = attributableLegacyBatchPayment({ collectedCod: 2_000_000, advanceAmount: 1_000_000, returnedAdvance: 200_000, deliveryFees: 50_000 });
    expect(attributable).toBe(750_000);
    expect(requiredOpeningAdjustment(700_000, attributable)).toBe(50_000);
    expect(requiredOpeningAdjustment(800_000, attributable)).toBe(-50_000);
  });

  test("posts sign-correct balanced GL entries for opening adjustments", () => {
    const increase = buildCutoverAdjustmentLines(50_000);
    expect(increase).toEqual([{ account: "OS_BATCH_COD_CLEARING", debit: 50_000, credit: 0 }, { account: "OS_COD_PAYABLE", debit: 0, credit: 50_000 }]);
    expect(increase.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(increase.filter((line) => line.account === "OS_COD_PAYABLE").reduce((sum, line) => sum + line.credit - line.debit, 0)).toBe(50_000);
    const decrease = buildCutoverAdjustmentLines(-50_000);
    expect(decrease.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(decrease.filter((line) => line.account === "OS_COD_PAYABLE").reduce((sum, line) => sum + line.credit - line.debit, 0)).toBe(-50_000);
  });
});

describe("simplified OS account", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hubId = `osa-hub-${suffix}`, shopId = `osa-shop-${suffix}`, userId = `osa-user-${suffix}`;
  const oldBatch = `osa-old-${suffix}`, newBatch = `osa-new-${suffix}`;
  const auth = () => signAccessToken({ sub: userId, email: `osa-${suffix}@test.local`, role: "FINANCE", tokenVersion: 0 });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `OS Account hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `OS Account shop ${suffix}` } });
    await prisma.user.create({ data: { id: userId, name: "Finance", email: `osa-${suffix}@test.local`, passwordHash: "test", role: "FINANCE", hubId } });
    await prisma.batch.createMany({ data: [
      { id: oldBatch, shopId, hubId, label: "Day 1", pickupDate: new Date("2034-01-01"), advancePaid: 1_000_000 },
      { id: newBatch, shopId, hubId, label: "Day 2", pickupDate: new Date("2034-01-02"), advancePaid: 0 },
    ] });
    await prisma.osBatchObligation.createMany({ data: [
      { batchId: oldBatch, shopId, hubId, originalCod: 2_000_000 },
      { batchId: newBatch, shopId, hubId, originalCod: 2_000_000 },
    ] });
    await prisma.journalEntry.create({ data: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: oldBatch, hubId, businessDate: new Date("2034-01-01"), description: "Posted test advance", lines: { create: [{ account: "OS_COD_PAYABLE", debit: 1_000_000, credit: 0 }, { account: "WALLET_CASH", debit: 0, credit: 1_000_000 }] } } });
  });

  afterAll(async () => {
    const payments = await prisma.osAccountPayment.findMany({ where: { shopId }, select: { id: true, journalEntryId: true } });
    const advanceEntries = await prisma.journalEntry.findMany({ where: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: oldBatch }, select: { id: true } });
    const journalIds = [...payments.map(p => p.journalEntryId), ...advanceEntries.map(entry => entry.id)];
    await prisma.osCreditAllocation.deleteMany({ where: { paymentId: { in: payments.map(p => p.id) } } });
    await prisma.osPaymentAllocation.deleteMany({ where: { paymentId: { in: payments.map(p => p.id) } } });
    await prisma.osPaymentWallet.deleteMany({ where: { paymentId: { in: payments.map(p => p.id) } } });
    await prisma.osAccountPayment.deleteMany({ where: { id: { in: payments.map(p => p.id) } } });
    await prisma.journalLine.deleteMany({ where: { entryId: { in: journalIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
    await prisma.osBatchObligation.deleteMany({ where: { batchId: { in: [oldBatch, newBatch] } } });
    await prisma.batch.deleteMany({ where: { id: { in: [oldBatch, newBatch] } } });
    await prisma.user.delete({ where: { id: userId } }); await prisma.onlineShop.delete({ where: { id: shopId } }); await prisma.hub.delete({ where: { id: hubId } });
  });

  test("shows COD minus advance and records a split-wallet partial payment oldest first", async () => {
    const before = await request(app).get("/api/v1/finance/os-accounts").set("Authorization", `Bearer ${auth()}`);
    expect(before.status).toBe(200);
    expect(before.body.data.shops[0].batches[0]).toEqual(expect.objectContaining({ originalCod: 2_000_000, advancePaid: 1_000_000, outstanding: 1_000_000 }));

    const paid = await request(app).post("/api/v1/finance/os-payments").set("Authorization", `Bearer ${auth()}`).send({
      shopId, batchIds: [newBatch, oldBatch], businessDate: "2034-01-03", wallets: { cash: 600_000, kbzPay: 400_000, wavePay: 0 }, note: "Pay prior outstanding", idempotencyKey: `pay-${suffix}`,
    });
    expect(paid.status).toBe(201);
    expect(paid.body.data.allocations).toEqual([expect.objectContaining({ batchId: oldBatch, amount: 1_000_000 })]);
    expect(paid.body.data.wallets).toEqual(expect.arrayContaining([expect.objectContaining({ wallet: "cash", amount: 600_000 }), expect.objectContaining({ wallet: "kbzPay", amount: 400_000 })]));
  });

  test("rejects wallet outflow above selected payable", async () => {
    const response = await request(app).post("/api/v1/finance/os-payments").set("Authorization", `Bearer ${auth()}`).send({
      shopId, batchIds: [newBatch], businessDate: "2034-01-03", wallets: { cash: 2_000_001, kbzPay: 0, wavePay: 0 }, note: "Too much payment", idempotencyKey: `over-${suffix}`,
    });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe("PAYMENT_EXCEEDS_PAYABLE");
  });

  test("rejects reuse of a payment idempotency key with a different payload", async () => {
    const response = await request(app).post("/api/v1/finance/os-payments").set("Authorization", `Bearer ${auth()}`).send({
      shopId, batchIds: [newBatch, oldBatch], businessDate: "2034-01-03", wallets: { cash: 500_000, kbzPay: 500_000, wavePay: 0 }, note: "Changed retry", idempotencyKey: `pay-${suffix}`,
    });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
