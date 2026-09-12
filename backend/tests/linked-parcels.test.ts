import { calculateLinkedDeliveryFee, isAssignmentEligible, normalizeDeliveryAddress } from "../src/services/operations.service.js";
import { calculateLinkedDeliveryAmounts } from "../src/services/ledger.service.js";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("linked parcels", () => {
  test("charges the base fee plus 1000 MMK for each additional parcel", () => {
    expect(calculateLinkedDeliveryFee(3000, 1)).toBe(3000);
    expect(calculateLinkedDeliveryFee(3000, 3)).toBe(5000);
  });

  test("rejects invalid linked fee inputs", () => {
    expect(() => calculateLinkedDeliveryFee(-1, 2)).toThrow("Linked delivery fee inputs are invalid");
    expect(() => calculateLinkedDeliveryFee(3000, 0)).toThrow("Linked delivery fee inputs are invalid");
  });

  test("normalizes harmless address casing and whitespace differences", () => {
    expect(normalizeDeliveryAddress("  No. 12,   BAHAN Road ")).toBe(normalizeDeliveryAddress("no. 12, bahan road"));
  });

  test("keeps linking separate from assignment eligibility", () => {
    expect(isAssignmentEligible({ riderId: null, status: "CREATED" })).toBe(true);
  });

  test("calculates commission from the adjusted group fee", () => {
    expect(calculateLinkedDeliveryAmounts({ baseDeliveryFee: 3000, parcelCount: 3, commissionRateBps: 4000 })).toEqual({ deliveryFee: 5000, commission: 2000 });
  });
});

describe("linked parcel replacement and financial unlink", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const hubId = `link-review-hub-${suffix}`;
  const shopId = `link-review-shop-${suffix}`;
  const dispatcherId = `link-review-dispatcher-${suffix}`;
  const financeId = `link-review-finance-${suffix}`;
  const riderUserId = `link-review-rider-user-${suffix}`;
  const riderId = `link-review-rider-${suffix}`;
  const regionId = `link-review-region-${suffix}`;
  const districtId = `link-review-district-${suffix}`;
  const townshipId = `link-review-township-${suffix}`;
  const batchId = `link-review-batch-${suffix}`;
  const rollbackIds = [`link-review-rollback-a-${suffix}`, `link-review-rollback-b-${suffix}`];
  const postedIds = [`link-review-posted-a-${suffix}`, `link-review-posted-b-${suffix}`];
  const token = () => signAccessToken({ sub: dispatcherId, email: `link-review-${suffix}@test.local`, role: "DISPATCHER", tokenVersion: 0 });
  const financeToken = () => signAccessToken({ sub: financeId, email: `link-finance-${suffix}@test.local`, role: "FINANCE", tokenVersion: 0 });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Link review hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Link review shop ${suffix}` } });
    await prisma.user.createMany({ data: [
      { id: dispatcherId, name: "Link Reviewer", username: `link-review-${suffix}`, email: `link-review-${suffix}@test.local`, passwordHash: "test-only", role: "DISPATCHER", hubId },
      { id: financeId, name: "Link Finance", username: `link-finance-${suffix}`, email: `link-finance-${suffix}@test.local`, passwordHash: "test-only", role: "FINANCE", hubId },
      { id: riderUserId, name: "Responsible Rider", username: `link-rider-${suffix}`, email: `link-rider-${suffix}@test.local`, passwordHash: "test-only", role: "RIDER", hubId },
    ] });
    await prisma.rider.create({ data: { id: riderId, userId: riderUserId, hubId, commissionRateBps: 4000 } });
    await prisma.regionState.create({ data: { id: regionId, code: `LR-${suffix}`, nameEn: "Link Region", nameMy: "" } });
    await prisma.district.create({ data: { id: districtId, code: `LD-${suffix}`, regionStateId: regionId, nameEn: "Link District", nameMy: "" } });
    await prisma.township.create({ data: { id: townshipId, code: `LT-${suffix}`, districtId, nameEn: "Link Township", deliveryFee: 3000 } });
    await prisma.batch.create({ data: { id: batchId, shopId, hubId, label: `Link review batch ${suffix}`, pickupDate: new Date("2036-01-01T00:00:00.000Z") } });
    await prisma.parcel.createMany({ data: [...rollbackIds, ...postedIds].map((id, index) => ({
      id, batchId, trackingNumber: `LINK-REVIEW-${index}-${suffix}`, customerName: `Customer ${index}`, address: index % 2 ? "Different address" : "Original address",
      codAmount: 10_000 + index * 1_000, deliveryFee: 3000, townshipId, status: "CREATED",
    })) });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS link_review_abort_${suffix.replace(/[^a-z0-9]/gi, "_")}`);
    const parcelIds = [...rollbackIds, ...postedIds];
    await prisma.riderReceivableRecognition.deleteMany({ where: { riderId } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.deliveryWay.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.packageAssignment.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.parcelLinkGroup.deleteMany({ where: { address: { in: ["Original address", "Different address"] } } });
    await prisma.batch.delete({ where: { id: batchId } });
    await prisma.township.delete({ where: { id: townshipId } });
    await prisma.district.delete({ where: { id: districtId } });
    await prisma.regionState.delete({ where: { id: regionId } });
    await prisma.rider.delete({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, financeId, riderUserId] } } });
    await prisma.onlineShop.delete({ where: { id: shopId } });
    await prisma.hub.delete({ where: { id: hubId } });
  });

  test("rolls back the group and prior parcel replacements when a later update fails", async () => {
    const trigger = `link_review_abort_${suffix.replace(/[^a-z0-9]/gi, "_")}`;
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF linkGroupId ON Parcel WHEN NEW.id = '${rollbackIds[1]}' BEGIN SELECT RAISE(ABORT, 'forced link failure'); END`);
    const response = await request(app).post("/api/v1/operations/parcels/link").set("Authorization", `Bearer ${token()}`).send({
      parcelIds: rollbackIds, responsibleRiderId: riderId, reason: "Consolidate this stop",
    });
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${trigger}`);

    expect(response.status).toBe(500);
    expect(await prisma.parcel.findMany({ where: { id: { in: rollbackIds } }, select: { linkGroupId: true, riderId: true, status: true } })).toEqual([
      { linkGroupId: null, riderId: null, status: "CREATED" },
      { linkGroupId: null, riderId: null, status: "CREATED" },
    ]);
    expect(await prisma.packageAssignment.count({ where: { parcelId: { in: rollbackIds } } })).toBe(0);
    expect(await prisma.statusHistory.count({ where: { parcelId: { in: rollbackIds } } })).toBe(0);
  });

  test("reverses posted linked money and recreates individual recognition idempotently on unlink", async () => {
    const linked = await request(app).post("/api/v1/operations/parcels/link").set("Authorization", `Bearer ${token()}`).send({
      parcelIds: postedIds, responsibleRiderId: riderId, reason: "Shared delivery stop",
    });
    expect(linked.status).toBe(201);
    for (const parcelId of postedIds) {
      expect((await request(app).post(`/api/v1/parcels/${parcelId}/status`).set("Authorization", `Bearer ${token()}`).send({ status: "OUT_FOR_DELIVERY" })).status).toBe(200);
      expect((await request(app).post(`/api/v1/parcels/${parcelId}/status`).set("Authorization", `Bearer ${token()}`).send({ status: "DELIVERED" })).status).toBe(200);
    }
    const groupId = linked.body.data.id as string;
    const originals = await prisma.journalEntry.findMany({ where: { sourceType: { in: ["LINKED_RIDER_COMMISSION", "LINKED_RIDER_RECEIVABLE_FEE"] }, sourceId: { startsWith: groupId } } });
    expect(originals).toHaveLength(2);
    const beforeTotal = (await prisma.riderReceivableRecognition.aggregate({ where: { riderId }, _sum: { receivableAmount: true } }))._sum.receivableAmount ?? 0;

    const payload = { reason: "Customers require separate delivery records", businessDate: "2036-01-02", idempotencyKey: `unlink-review-${suffix}` };
    const forbidden = await request(app).post(`/api/v1/operations/parcel-link-groups/${groupId}/unlink`).set("Authorization", `Bearer ${token()}`).send(payload);
    expect(forbidden.status).toBe(403);
    const unlinked = await request(app).post(`/api/v1/operations/parcel-link-groups/${groupId}/unlink`).set("Authorization", `Bearer ${financeToken()}`).send(payload);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data).toMatchObject({ groupId, parcelCount: 2, reversedCount: 4, recalculatedCount: 2, replay: false });
    expect(await prisma.parcel.count({ where: { id: { in: postedIds }, linkGroupId: null } })).toBe(2);
    expect(await prisma.journalEntry.count({ where: { sourceType: "LEDGER_REVERSAL", sourceId: { in: originals.map((entry) => entry.id) } } })).toBe(2);
    expect(await prisma.journalEntry.count({ where: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: { contains: `unlink:${payload.idempotencyKey}` } } })).toBe(2);
    expect(await prisma.journalEntry.count({ where: { sourceType: "RIDER_COMMISSION", sourceId: { contains: `unlink:${payload.idempotencyKey}` } } })).toBe(2);
    const afterTotal = (await prisma.riderReceivableRecognition.aggregate({ where: { riderId }, _sum: { receivableAmount: true } }))._sum.receivableAmount ?? 0;
    expect(afterTotal).toBe(postedIds.reduce((sum, _, index) => sum + 10_000 + (index + 2) * 1_000 + 3000 - 1200, 0));
    expect(afterTotal).not.toBe(beforeTotal + afterTotal);

    const replay = await request(app).post(`/api/v1/operations/parcel-link-groups/${groupId}/unlink`).set("Authorization", `Bearer ${financeToken()}`).send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ groupId, replay: true });
    expect(await prisma.journalEntry.count({ where: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: { contains: `unlink:${payload.idempotencyKey}` } } })).toBe(2);
  });
});
