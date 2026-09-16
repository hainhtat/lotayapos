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
    const journalIds = (await prisma.journalEntry.findMany({ where: { hubId }, select: { id: true } })).map(entry => entry.id);
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

  test("retries and void-and-replace corrections preserve exactly one wallet effect", async () => {
    const payment = { shopId, batchIds: [newBatch], businessDate: "2034-01-03", wallets: { cash: 100, kbzPay: 200, wavePay: 300 }, note: "Correction test", idempotencyKey: `correct-${suffix}` };
    const post = () => request(app).post("/api/v1/finance/os-payments").set("Authorization", `Bearer ${auth()}`).send(payment);
    const first = await post(), retry = await post();
    expect(first.status).toBe(201); expect(retry.body.data.id).toBe(first.body.data.id);
    const correction = { businessDate: "2034-01-03", reason: "Wrong split", idempotencyKey: `void-${suffix}`, replacement: { ...payment, wallets: { cash: 0, kbzPay: 0, wavePay: 600 }, idempotencyKey: `replacement-${suffix}` } };
    const replace = () => request(app).post(`/api/v1/finance/os-payments/${first.body.data.id}/replace`).set("Authorization", `Bearer ${auth()}`).send(correction);
    const replaced = await replace(), replacedRetry = await replace();
    expect(replaced.status).toBe(201); expect(replacedRetry.body.data.id).toBe(replaced.body.data.id);
    const changed = await request(app).post(`/api/v1/finance/os-payments/${first.body.data.id}/replace`).set("Authorization", `Bearer ${auth()}`).send({ ...correction, replacement: { ...correction.replacement, note: "Changed intent" } });
    expect(changed.status).toBe(409); expect(changed.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await prisma.osAccountPayment.findUniqueOrThrow({ where: { id: first.body.data.id } })).status).toBe("VOIDED");
    const journals = await prisma.journalEntry.findMany({ where: { hubId }, include: { lines: true } });
    for (const journal of journals) expect(journal.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    const correctionJournals = journals.filter(journal => [first.body.data.id, replaced.body.data.id, correction.idempotencyKey].includes(journal.sourceId));
    expect(correctionJournals).toHaveLength(3);
    for (const [account, balance] of [["WALLET_CASH", 0], ["WALLET_KBZ_PAY", 0], ["WALLET_WAVE_PAY", -600]] as const) {
      expect(correctionJournals.flatMap(journal => journal.lines).filter(line => line.account === account).reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(balance);
    }
    expect(await prisma.osAccountPayment.count({ where: { replacesId: first.body.data.id } })).toBe(1);
  });

  const postgresTest = process.env.DATABASE_PROVIDER === "postgresql" ? test : test.skip;
  postgresTest("concurrent duplicate payments create one payment and one journal", async () => {
    const payload = { shopId, batchIds: [newBatch], businessDate: "2034-01-03", wallets: { cash: 10, kbzPay: 20, wavePay: 30 }, note: "Concurrent retry", idempotencyKey: `concurrent-${suffix}` };
    const responses = await Promise.all([1, 2].map(() => request(app).post("/api/v1/finance/os-payments").set("Authorization", `Bearer ${auth()}`).send(payload)));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect(await prisma.osAccountPayment.count({ where: { idempotencyKey: payload.idempotencyKey } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "OS_ACCOUNT_PAYMENT", sourceId: responses[0].body.data.id } })).toBe(1);
  });
});
