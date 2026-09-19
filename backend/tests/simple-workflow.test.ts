import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/database.js";
import { rescheduleParcels } from "../src/services/parcel.service.js";
import { bulkAssignParcels, getBatchDetail, listBatches } from "../src/services/operations.service.js";
import { receiveOsReturnsBulk } from "../src/services/finance/os-returns.js";

describe("simple dispatch and physical OS handover", () => {
  const suffix = randomUUID(), hubId = `flow-${suffix}`, shopId = `shop-${suffix}`, batchId = `batch-${suffix}`;
  const actor = { id: `ops-${suffix}`, role: "OPERATIONS_MANAGER" };
  const riderUserId = `user-${suffix}`, riderId = `rider-${suffix}`;
  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: "Workflow test" } });
    await prisma.onlineShop.create({ data: { id: shopId, name: "Workflow shop" } });
    await prisma.user.createMany({ data: [
      { id: actor.id, name: "Ops", email: `${actor.id}@test.invalid`, role: actor.role, hubId, passwordHash: "fixture" },
      { id: riderUserId, name: "Rider", email: `${riderUserId}@test.invalid`, role: "RIDER", hubId, passwordHash: "fixture" },
    ] });
    await prisma.rider.create({ data: { id: riderId, userId: riderUserId, hubId } });
    await prisma.batch.create({ data: { id: batchId, hubId, shopId, label: "Original batch", pickupDate: new Date("2037-01-01") } });
    await prisma.osBatchObligation.create({ data: { batchId, hubId, shopId, originalCod: 100000 } });
  });
  afterAll(async () => {
    const where = { parcel: { batchId } };
    await prisma.statusHistory.deleteMany({ where });
    await prisma.packageAssignment.deleteMany({ where });
    await prisma.deliveryWay.deleteMany({ where });
    await prisma.osReturnCredit.deleteMany({ where: { batchId } });
    await prisma.osSettlementEditAudit.deleteMany({ where: { actorId: actor.id } });
    await prisma.parcel.deleteMany({ where: { batchId } });
    await prisma.osSettlementBatch.deleteMany({ where: { batchId } });
    await prisma.osSettlement.deleteMany({ where: { hubId } });
    await prisma.osBatchObligation.deleteMany({ where: { batchId } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.batch.delete({ where: { id: batchId } });
    await prisma.rider.delete({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [actor.id, riderUserId] } } });
    await prisma.onlineShop.delete({ where: { id: shopId } });
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
    await prisma.hub.delete({ where: { id: hubId } });
  });
  const parcel = (status: string) => prisma.parcel.create({ data: { batchId, trackingNumber: randomUUID(), customerName: "Fixture", address: "Fixture", codAmount: 1000, status } });

  test("keeps operations batch list and detail available when legacy money needs reconciliation", async () => {
    await prisma.osBatchObligation.update({ where: { batchId }, data: { migrated: true } });
    const journal = await prisma.journalEntry.create({ data: { sourceType: "TEST_LEGACY", hubId, businessDate: new Date("2037-01-01"), description: "Legacy mismatch fixture" } });
    const settlement = await prisma.osSettlement.create({ data: { shopId, hubId, businessDate: new Date("2037-01-01"), grossCollectedCod: 100, advanceDeduction: 0, returnDeduction: 0, deliveryFeeDeduction: 0, netAmount: 200, wallet: "CASH", idempotencyKey: `legacy-${suffix}`, postedBy: actor.id, journalEntryId: journal.id, batches: { create: { batchId, collectedCod: 100, advanceAmount: 0, returnedAdvance: 0, deliveryFees: 0 } } } });
    try {
      const rows = await listBatches(actor, { shopId });
      expect(rows.items).toHaveLength(1);
      expect(rows.items[0]).toMatchObject({ id: batchId, outstanding: null, balanceError: expect.stringContaining("balances differ") });
      const detail = await getBatchDetail(batchId, actor);
      expect(detail).toMatchObject({ id: batchId, remainingToOs: null, balanceError: expect.stringContaining("balances differ") });
    } finally {
      await prisma.osSettlementBatch.deleteMany({ where: { settlementId: settlement.id } });
      await prisma.osSettlement.delete({ where: { id: settlement.id } });
      await prisma.journalEntry.delete({ where: { id: journal.id } });
      await prisma.osBatchObligation.update({ where: { batchId }, data: { migrated: false } });
    }
  });

  test("rescheduling preserves original batch and receipt age, closes assignment and retries without duplicate history", async () => {
    const p = await parcel("FAILED");
    await prisma.parcel.update({ where: { id: p.id }, data: { riderId } });
    await prisma.packageAssignment.create({ data: { parcelId: p.id, riderId, assignedById: actor.id } });
    await prisma.deliveryWay.create({ data: { parcelId: p.id, riderId, commissionRate: 0 } });
    const input = { parcelIds: [p.id], plannedDeliveryDate: "2037-01-05", reason: "Customer requested tomorrow" };
    await rescheduleParcels(input, actor);
    await rescheduleParcels(input, actor);
    expect(await prisma.parcel.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ batchId, createdAt: p.createdAt, riderId: null, status: "PICKED_UP", reasonCode: "RESCHEDULE", plannedDeliveryDate: new Date("2037-01-05") });
    expect(await prisma.statusHistory.count({ where: { parcelId: p.id } })).toBe(1);
    await expect(rescheduleParcels(input, { id: riderUserId, role: "RIDER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.packageAssignment.count({ where: { parcelId: p.id, endedAt: null } })).toBe(0);
    expect(await prisma.deliveryWay.count({ where: { parcelId: p.id, completedAt: null } })).toBe(0);
    const terminal = await parcel("DELIVERED");
    await expect(rescheduleParcels({ ...input, parcelIds: [p.id, terminal.id], plannedDeliveryDate: "2037-01-06" }, actor)).rejects.toMatchObject({ code: "PARCEL_NOT_RESCHEDULABLE" });
    expect((await prisma.parcel.findUniqueOrThrow({ where: { id: p.id } })).plannedDeliveryDate).toEqual(new Date("2037-01-05"));
  });

  test("assign and dispatch creates one open way and rolls back an ineligible selection", async () => {
    const p = await parcel("PICKED_UP"), terminal = await parcel("RETURNED");
    await expect(bulkAssignParcels({ parcelIds: [p.id, terminal.id], riderId, dispatch: true }, actor)).rejects.toMatchObject({ code: "PARCELS_NOT_ELIGIBLE" });
    expect((await prisma.parcel.findUniqueOrThrow({ where: { id: p.id } })).riderId).toBeNull();
    await bulkAssignParcels({ parcelIds: [p.id], riderId, dispatch: true }, actor);
    expect(await prisma.parcel.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ riderId, status: "OUT_FOR_DELIVERY" });
    expect(await prisma.deliveryWay.count({ where: { parcelId: p.id, completedAt: null } })).toBe(1);
    expect(await prisma.statusHistory.findMany({ where: { parcelId: p.id }, select: { toStatus: true } })).toEqual(expect.arrayContaining([{ toStatus: "ASSIGNED" }, { toStatus: "OUT_FOR_DELIVERY" }]));
  });

  test("bulk physical return is atomic, exact-retry safe, and never changes wallets", async () => {
    const a = await parcel("PENDING_RETURN"), b = await parcel("REJECTED"), invalid = await parcel("DELIVERED");
    const input = { parcelIds: [a.id, b.id], businessDate: "2037-01-05", idempotencyKey: `return-${suffix}` };
    await expect(receiveOsReturnsBulk(input, { id: riderUserId, role: "RIDER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(receiveOsReturnsBulk({ ...input, parcelIds: [a.id, invalid.id] }, actor)).rejects.toMatchObject({ code: "INVALID_RETURN_STATUS" });
    expect((await prisma.parcel.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PENDING_RETURN");
    expect(await prisma.osReturnCredit.count({ where: { batchId } })).toBe(0);
    const result = await receiveOsReturnsBulk(input, actor);
    expect(result.updatedCount).toBe(2);
    expect(await receiveOsReturnsBulk({ ...input, parcelIds: [b.id, a.id] }, actor)).toEqual(JSON.parse(JSON.stringify(result)));
    await expect(receiveOsReturnsBulk({ ...input, businessDate: "2037-01-06" }, actor)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await prisma.osReturnCredit.aggregate({ where: { batchId }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: 2000 } });
    expect(await prisma.statusHistory.count({ where: { parcelId: { in: [a.id, b.id] }, toStatus: "RETURNED" } })).toBe(2);
    expect(await prisma.journalLine.count({ where: { entry: { hubId }, account: { startsWith: "WALLET_" } } })).toBe(0);
  });
});
