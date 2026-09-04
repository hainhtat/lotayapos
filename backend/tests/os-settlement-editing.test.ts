import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("auditable OS settlement editing", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hubId = `ose-hub-${suffix}`;
  const shopId = `ose-shop-${suffix}`;
  const userId = `ose-finance-${suffix}`;
  const batchId = `ose-batch-${suffix}`;
  const draftBatchId = `ose-draft-batch-${suffix}`;
  const originalId = `ose-original-${suffix}`;
  const originalJournalId = `ose-journal-${suffix}`;
  const auth = () => `Bearer ${signAccessToken({ sub: userId, email: `ose-${suffix}@test.local`, role: "FINANCE", tokenVersion: 0 })}`;

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `OSE Hub ${suffix}` } });
    await prisma.user.create({ data: { id: userId, name: "OSE Finance", username: userId, email: `ose-${suffix}@test.local`, passwordHash: "test", role: "FINANCE", hubId } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `OSE Shop ${suffix}` } });
    await prisma.batch.create({ data: { id: batchId, shopId, hubId, pickupDate: new Date("2026-08-01T00:00:00Z"), label: "Posted edit", advancePaid: 2_000 } });
    await prisma.batch.create({ data: { id: draftBatchId, shopId, hubId, pickupDate: new Date("2026-08-02T00:00:00Z"), label: "Draft edit", advancePaid: 5_000 } });
    await prisma.parcel.create({ data: { batchId: draftBatchId, trackingNumber: `OSE-${suffix}`, customerName: "Customer", address: "Address", codAmount: 20_000, advanceAmount: 5_000, deliveryFee: 2_000, status: "DELIVERED" } });
    await prisma.journalEntry.create({ data: {
      id: originalJournalId, sourceType: "OS_SETTLEMENT", sourceId: originalId, hubId,
      businessDate: new Date("2026-08-10T00:00:00Z"), description: "Original OS statement",
      lines: { create: [
        { account: "OS_COD_PAYABLE", debit: 10_000, credit: 0 },
        { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 2_000 },
        { account: "OS_SETTLEMENT_OFFSET", debit: 0, credit: 1_000 },
        { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 1_000 },
        { account: "WALLET_CASH", debit: 0, credit: 6_000 },
      ] },
    } });
    await prisma.osSettlement.create({ data: {
      id: originalId, shopId, hubId, businessDate: new Date("2026-08-10T00:00:00Z"),
      grossCollectedCod: 10_000, advanceDeduction: 2_000, returnDeduction: 1_000,
      deliveryFeeDeduction: 1_000, adjustmentAmount: 0, netAmount: 6_000, wallet: "CASH",
      idempotencyKey: `original-${suffix}`, postedBy: userId, journalEntryId: originalJournalId,
      batches: { create: { batchId, collectedCod: 10_000, advanceAmount: 2_000, returnedAdvance: 1_000, deliveryFees: 1_000 } },
    } });
  });

  afterAll(async () => {
    await prisma.osSettlementEditAudit.deleteMany({ where: { actorId: userId } });
    await prisma.osSettlementDraft.deleteMany({ where: { hubId } });
    await prisma.osSettlementBatch.deleteMany({ where: { batchId: { in: [batchId, draftBatchId] } } });
    await prisma.osSettlement.deleteMany({ where: { hubId } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.parcel.deleteMany({ where: { batchId: draftBatchId } });
    await prisma.batch.deleteMany({ where: { id: { in: [batchId, draftBatchId] } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.onlineShop.delete({ where: { id: shopId } });
    await prisma.hub.delete({ where: { id: hubId } });
  });

  test("persists and optimistically updates bounded draft components with audit history", async () => {
    const create = await request(app).post("/api/v1/finance/os-settlement-drafts").set("Authorization", auth()).send({
      shopId, batchIds: [draftBatchId], businessDate: "2026-08-11", wallet: "CASH",
      advanceDeduction: 5_000, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: 0, reason: "Initial finance draft", idempotencyKey: `draft-create-${suffix}`,
    });
    expect(create.status).toBe(201);
    expect(create.body.data.version).toBe(1);
    const conflictingCreateReplay = await request(app).post("/api/v1/finance/os-settlement-drafts").set("Authorization", auth()).send({
      shopId, batchIds: [draftBatchId], businessDate: "2026-08-12", wallet: "CASH",
      advanceDeduction: 5_000, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: 0, reason: "Different draft identity", idempotencyKey: `draft-create-${suffix}`,
    });
    expect(conflictingCreateReplay.status).toBe(409);
    expect(conflictingCreateReplay.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const createKeyAsPatch = await request(app).patch(`/api/v1/finance/os-settlement-drafts/${create.body.data.id}`).set("Authorization", auth()).send({
      expectedVersion: 1, advanceDeduction: 5_000, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: 0, reason: "Wrong action replay", idempotencyKey: `draft-create-${suffix}`,
    });
    expect(createKeyAsPatch.status).toBe(409);
    expect(createKeyAsPatch.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const edit = await request(app).patch(`/api/v1/finance/os-settlement-drafts/${create.body.data.id}`).set("Authorization", auth()).send({
      expectedVersion: 1, advanceDeduction: 4_500, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: -250, adjustmentReason: "Approved shortfall", reason: "Reviewed components",
      idempotencyKey: `draft-edit-${suffix}`,
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ version: 2, advanceDeduction: 4_500, adjustmentAmount: -250 });
    const wrongVersionReplay = await request(app).patch(`/api/v1/finance/os-settlement-drafts/${create.body.data.id}`).set("Authorization", auth()).send({
      expectedVersion: 2, advanceDeduction: 4_500, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: -250, adjustmentReason: "Approved shortfall", reason: "Reviewed components",
      idempotencyKey: `draft-edit-${suffix}`,
    });
    expect(wrongVersionReplay.status).toBe(409);
    expect(wrongVersionReplay.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    const stale = await request(app).patch(`/api/v1/finance/os-settlement-drafts/${create.body.data.id}`).set("Authorization", auth()).send({
      expectedVersion: 1, advanceDeduction: 4_000, returnDeduction: 0, deliveryFeeDeduction: 2_000,
      adjustmentAmount: 0, reason: "Stale finance edit", idempotencyKey: `draft-stale-${suffix}`,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("EDIT_CONFLICT");
  });

  test("amends a posted statement only through a balanced reversal and replacement", async () => {
    const response = await request(app).patch(`/api/v1/finance/os-settlements/${originalId}`).set("Authorization", auth()).send({
      expectedVersion: 1, businessDate: "2026-08-11", wallet: "CASH",
      advanceDeduction: 1_500, returnDeduction: 1_000, deliveryFeeDeduction: 1_000,
      adjustmentAmount: 500, adjustmentReason: "Approved correction", reason: "Correct statement components",
      idempotencyKey: `posted-edit-${suffix}`,
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ status: "POSTED", version: 2, supersedesId: originalId, netAmount: 7_000 });
    const original = await prisma.osSettlement.findUniqueOrThrow({ where: { id: originalId } });
    expect(original.status).toBe("REPLACED");
    const reversal = await prisma.journalEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: originalJournalId } }, include: { lines: true } });
    expect(reversal.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(reversal.lines.reduce((sum, line) => sum + line.credit, 0));
    const replacement = await prisma.journalEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "OS_SETTLEMENT", sourceId: response.body.data.id } }, include: { lines: true } });
    expect(replacement.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(10_500);
    expect(replacement.lines.reduce((sum, line) => sum + line.credit, 0)).toBe(10_500);
    const replay = await request(app).patch(`/api/v1/finance/os-settlements/${originalId}`).set("Authorization", auth()).send({
      expectedVersion: 1, businessDate: "2026-08-11", wallet: "CASH",
      advanceDeduction: 1_500, returnDeduction: 1_000, deliveryFeeDeduction: 1_000,
      adjustmentAmount: 500, adjustmentReason: "Approved correction", reason: "Correct statement components",
      idempotencyKey: `posted-edit-${suffix}`,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(response.body.data.id);
    expect(await prisma.osSettlementEditAudit.count({ where: { idempotencyKey: `posted-edit-${suffix}` } })).toBe(1);

    const second = await request(app).patch(`/api/v1/finance/os-settlements/${response.body.data.id}`).set("Authorization", auth()).send({
      expectedVersion: 2, businessDate: "2026-08-12", wallet: "KBZ_PAY",
      advanceDeduction: 1_400, returnDeduction: 1_000, deliveryFeeDeduction: 900,
      adjustmentAmount: 300, adjustmentReason: "Second approved correction", reason: "Correct statement again",
      idempotencyKey: `posted-edit-second-${suffix}`,
    });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ version: 3, supersedesId: response.body.data.id });
    const detailFromOriginal = await request(app).get(`/api/v1/finance/os-settlements/${originalId}`).set("Authorization", auth());
    expect(detailFromOriginal.status).toBe(200);
    expect(detailFromOriginal.body.data.editHistory).toHaveLength(2);
    expect(detailFromOriginal.body.data.supersessionChainIds).toEqual(expect.arrayContaining([originalId, response.body.data.id, second.body.data.id]));
  });
});
