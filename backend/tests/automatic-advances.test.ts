import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/database.js";
import { bulkCreateParcels, createBatch, finalizeBatch } from "../src/services/operations.service.js";
import { updateParcel } from "../src/services/parcel.service.js";

describe("automatic batch advance recording", () => {
  const suffix = randomUUID();
  let hubId: string;
  let shopId: string;
  let townshipId: string;
  let regionId: string;
  let districtId: string;
  let admin: { id: string; role: string };
  let dispatcher: { id: string; role: string };
  let operationsManager: { id: string; role: string };
  beforeAll(async () => {
    hubId = (await prisma.hub.create({ data: { name: `Auto advance ${suffix}` } })).id;
    shopId = (await prisma.onlineShop.create({ data: { name: `Auto advance ${suffix}` } })).id;
    admin = await prisma.user.create({ data: { name: "Auto advance admin", email: `auto-admin-${suffix}@test.invalid`, passwordHash: "test-only", role: "SUPERADMIN", hubId } });
    dispatcher = await prisma.user.create({ data: { name: "Auto advance dispatcher", email: `auto-dispatcher-${suffix}@test.invalid`, passwordHash: "test-only", role: "DISPATCHER", hubId } });
    operationsManager = await prisma.user.create({ data: { name: "Auto advance operations", email: `auto-operations-${suffix}@test.invalid`, passwordHash: "test-only", role: "OPERATIONS_MANAGER", hubId } });
    regionId = (await prisma.regionState.create({ data: { code: `R-${suffix}`, nameEn: "Region", nameMy: "" } })).id;
    districtId = (await prisma.district.create({ data: { code: `D-${suffix}`, nameEn: "District", nameMy: "", regionStateId: regionId } })).id;
    townshipId = (await prisma.township.create({ data: { code: `T-${suffix}`, nameEn: "Township", districtId, deliveryFee: 1000 } })).id;
  });
  afterAll(async () => {
    const batchIds = (await prisma.batch.findMany({ where: { shopId }, select: { id: true } })).map(row => row.id);
    await prisma.osAdvanceCreditAllocation.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.osCreditAllocation.deleteMany({ where: { credit: { shopId } } });
    await prisma.osReturnCredit.deleteMany({ where: { shopId } });
    await prisma.parcelFieldAudit.deleteMany({ where: { parcel: { batchId: { in: batchIds } } } });
    await prisma.parcel.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.osBatchObligation.deleteMany({ where: { batchId: { in: batchIds } } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.batch.deleteMany({ where: { shopId } });
    await prisma.township.delete({ where: { id: townshipId } });
    await prisma.district.delete({ where: { id: districtId } });
    await prisma.regionState.delete({ where: { id: regionId } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, dispatcher.id, operationsManager.id] } } });
    await prisma.onlineShop.delete({ where: { id: shopId } });
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
    await prisma.hub.delete({ where: { id: hubId } });
  });
  const input = () => ({ shopId, hubId, pickupDate: "2037-01-01", batchName: "Automatic advance", advancePaid: 1000000, wallets: { cash: 400000, kbzPay: 350000, wavePay: 250000 }, idempotencyKey: `auto-${suffix}` });
  test("save records split wallets once; retry replays and changed retry conflicts", async () => {
    const batch = await createBatch(input(), admin);
    expect(batch.automaticAccounting).toBe(true);
    expect((await createBatch(input(), admin)).id).toBe(batch.id);
    await expect(createBatch({ ...input(), batchName: "Changed" }, admin)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const entries = await prisma.journalEntry.findMany({ where: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: batch.id }, include: { lines: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(entries[0]!.lines.filter(line => line.account.startsWith("WALLET_")).map(line => line.credit).sort()).toEqual([250000, 350000, 400000]);
    const parcel = { customerName: "Customer", address: "Address", townshipId, codAmount: 2000000 };
    const saved = await bulkCreateParcels(batch.id, { parcels: [parcel] }, dispatcher);
    expect((await prisma.osBatchObligation.findUniqueOrThrow({ where: { batchId: batch.id } })).originalCod).toBe(2000000);
    await finalizeBatch(batch.id, dispatcher);
    await bulkCreateParcels(batch.id, { parcels: [{ ...parcel, codAmount: 500000 }] }, dispatcher);
    expect((await prisma.osBatchObligation.findUniqueOrThrow({ where: { batchId: batch.id } })).originalCod).toBe(2500000);
    const lines = await prisma.journalLine.findMany({ where: { entry: { hubId } } });
    expect(lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(lines.filter(line => line.account === "OS_COD_PAYABLE").reduce((sum, line) => sum + line.credit - line.debit, 0)).toBe(1500000);
    await updateParcel(saved[0]!.id, { codAmount: 1900000 }, dispatcher);
    expect((await prisma.osBatchObligation.findUniqueOrThrow({ where: { batchId: batch.id } })).originalCod).toBe(2400000);
  });
  test("rejects unauthorized or invalid money before creating any batch", async () => {
    await expect(createBatch({ ...input(), pickupDate: "2037-01-02", idempotencyKey: `unauthorized-${suffix}` }, dispatcher)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createBatch({ ...input(), wallets: { cash: 1, kbzPay: 0, wavePay: 0 }, idempotencyKey: `invalid-wallet-${suffix}` }, admin)).rejects.toMatchObject({ code: "INVALID_WALLET_SPLIT" });
    expect(await prisma.batch.count({ where: { shopId } })).toBe(1);
  });
  test("allows an Operations Manager to create a split-wallet advance", async () => {
    const batch = await createBatch({ ...input(), pickupDate: "2037-01-05", idempotencyKey: `operations-${suffix}` }, operationsManager);
    expect(batch.advancePaid).toBe(1_000_000);
    expect(await prisma.journalEntry.count({ where: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: batch.id } })).toBe(1);
  });
  test("automatically applies available OS credit before posting the wallet split", async () => {
    const sourceBatch = await prisma.batch.create({ data: {
      shopId, hubId, pickupDate: new Date("2037-01-31T00:00:00.000Z"), label: "Credit source", advancePaid: 100_000,
      automaticAccounting: true, finalizedAt: new Date("2037-01-31T00:00:00.000Z"),
    } });
    await prisma.osBatchObligation.create({ data: { batchId: sourceBatch.id, shopId, hubId, originalCod: 100_000 } });
    const advanceJournal = await prisma.journalEntry.create({ data: {
      sourceType: "BATCH_PICKUP_ADVANCE", sourceId: sourceBatch.id, hubId, businessDate: sourceBatch.pickupDate, description: "Credit fixture advance",
      lines: { create: [{ account: "OS_COD_PAYABLE", debit: 100_000, credit: 0 }, { account: "WALLET_CASH", debit: 0, credit: 100_000 }] },
    } });
    const returnJournal = await prisma.journalEntry.create({ data: {
      sourceType: "OS_PHYSICAL_RETURN_CREDIT", sourceId: `credit-fixture-${suffix}`, hubId, businessDate: sourceBatch.pickupDate, description: "Credit fixture return",
      lines: { create: [{ account: "OS_COD_PAYABLE", debit: 100_000, credit: 0 }, { account: "OS_BATCH_COD_CLEARING", debit: 0, credit: 100_000 }] },
    } });
    await prisma.osReturnCredit.create({ data: {
      parcelId: `credit-fixture-parcel-${suffix}`, batchId: sourceBatch.id, shopId, hubId, amount: 100_000, codAmount: 100_000, feeAmount: 0,
      kind: "PHYSICAL_RETURN", businessDate: sourceBatch.pickupDate, idempotencyKey: `credit-fixture-${suffix}`, postedBy: admin.id, journalEntryId: returnJournal.id,
    } });
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: advanceJournal.id }, include: { lines: true } })).lines).toHaveLength(2);

    const fullyCovered = await createBatch({
      ...input(), pickupDate: "2037-02-01", advancePaid: 80_000, wallets: { cash: 0, kbzPay: 0, wavePay: 0 }, idempotencyKey: `credit-full-${suffix}`,
    }, operationsManager);
    expect(fullyCovered).toMatchObject({ advancePaid: 0, walletAdvance: 0, osCreditApplied: 80_000 });
    expect(await prisma.osAdvanceCreditAllocation.findMany({ where: { batchId: fullyCovered.id }, select: { amount: true } })).toEqual([{ amount: 80_000 }]);
    expect(await prisma.journalEntry.count({ where: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: fullyCovered.id } })).toBe(0);

    const partiallyCovered = await createBatch({
      ...input(), pickupDate: "2037-02-02", advancePaid: 80_000, wallets: { cash: 20_000, kbzPay: 20_000, wavePay: 20_000 }, idempotencyKey: `credit-partial-${suffix}`,
    }, operationsManager);
    expect(partiallyCovered).toMatchObject({ advancePaid: 60_000, walletAdvance: 60_000, osCreditApplied: 20_000 });
    const posted = await prisma.journalEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: partiallyCovered.id } }, include: { lines: true } });
    expect(posted.lines.filter(line => line.account.startsWith("WALLET_")).reduce((sum, line) => sum + line.credit, 0)).toBe(60_000);
  });
  test("zero advance permits operations recording without wallet mutation", async () => {
    const batch = await createBatch({ shopId, pickupDate: "2037-01-03", batchName: "Unpaid pickup", advancePaid: 0 }, dispatcher);
    expect(await prisma.journalEntry.count({ where: { sourceId: batch.id } })).toBe(0);
  });
  test("closed pickup date rolls back both batch and wallet movement", async () => {
    await prisma.cashbookDay.create({ data: { hubId, businessDate: new Date("2037-01-04"), closedAt: new Date(), closedBy: admin.id } });
    await expect(createBatch({ ...input(), pickupDate: "2037-01-04", idempotencyKey: `closed-${suffix}` }, admin)).rejects.toMatchObject({ code: "DAY_CLOSED" });
    expect(await prisma.batch.count({ where: { shopId, pickupDate: new Date("2037-01-04") } })).toBe(0);
  });
});
