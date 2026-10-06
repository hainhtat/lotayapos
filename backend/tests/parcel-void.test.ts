import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("entered-in-error parcel correction", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `void-hub-${suffix}`;
  const shopId = `void-shop-${suffix}`;
  const userId = `void-user-${suffix}`;
  const batchId = `void-batch-${suffix}`;
  const parcelId = `void-parcel-${suffix}`;
  const token = () => signAccessToken({ sub: userId, email: `void-${suffix}@example.com`, role: "SUPERADMIN", tokenVersion: 0 });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Void hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Void shop ${suffix}` } });
    await prisma.user.create({ data: { id: userId, name: "Void admin", email: `void-${suffix}@example.com`, username: `void-${suffix}`, passwordHash: "test-only", role: "SUPERADMIN", active: true } });
    await prisma.batch.create({ data: { id: batchId, label: `Void batch ${suffix}`, pickupDate: new Date(), shopId, hubId, advancePaid: 0, automaticAccounting: true, finalizedAt: new Date(), finalizedBy: userId } });
    await prisma.parcel.create({ data: { id: parcelId, batchId, trackingNumber: `VOID-${suffix}`, customerName: "Mistaken entry", address: "Test", codAmount: 12000, deliveryFee: 1000, status: "CREATED" } });
    await prisma.osBatchObligation.create({ data: { batchId, shopId, hubId, originalCod: 12000 } });
  });

  it("posts one balanced correction and replays the same request", async () => {
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    const preview = await request(app).get(`/api/v1/parcels/${parcelId}/void-preview`).set("Authorization", `Bearer ${token()}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ currentCod: 12000, proposedObligationReduction: 12000, currentOsBalance: 12000, projectedOsBalance: 0 });
    const first = await request(app).post(`/api/v1/parcels/${parcelId}/void`).set("Authorization", `Bearer ${token()}`).send({ reason: "Never received from OS", idempotencyKey });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ status: "VOIDED", reversedCod: 12000, remainingOsBalance: 0, replay: false });
    const replay = await request(app).post(`/api/v1/parcels/${parcelId}/void`).set("Authorization", `Bearer ${token()}`).send({ reason: "Never received from OS", idempotencyKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data.replay).toBe(true);
    expect((await prisma.osBatchObligation.findUniqueOrThrow({ where: { batchId } })).originalCod).toBe(0);
    const journals = await prisma.journalEntry.findMany({ where: { sourceType: "PARCEL_ENTERED_IN_ERROR", sourceId: parcelId }, include: { lines: true } });
    expect(journals).toHaveLength(1);
    expect(journals[0].lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect((await prisma.statusHistory.findMany({ where: { parcelId, toStatus: "VOIDED" } })).length).toBe(1);
    const reschedule = await request(app).post("/api/v1/parcels/reschedule").set("Authorization", `Bearer ${token()}`).send({ parcelIds: [parcelId], plannedDeliveryDate: "2030-01-01", reason: "Try to reactivate" });
    expect(reschedule.status).toBe(409);
    expect((await prisma.parcel.findUniqueOrThrow({ where: { id: parcelId } })).status).toBe("VOIDED");
  });

  it("voids an automatic-accounting draft even when its actual advance is posted", async () => {
    const draftBatchId = `void-draft-${suffix}`;
    const draftParcelId = `void-draft-parcel-${suffix}`;
    await prisma.batch.create({ data: { id: draftBatchId, label: `Void draft ${suffix}`, pickupDate: new Date(), shopId, hubId, advancePaid: 5000, automaticAccounting: true } });
    await prisma.parcel.create({ data: { id: draftParcelId, batchId: draftBatchId, trackingNumber: `VOID-DRAFT-${suffix}`, customerName: "Mistaken draft", address: "Test", codAmount: 0, deliveryFee: 0 } });
    await prisma.parcelFieldAudit.create({ data: { parcelId: draftParcelId, actorId: userId, beforeJson: JSON.stringify({ codAmount: 9000, deliveryFee: 1000 }), afterJson: JSON.stringify({ codAmount: 0, deliveryFee: 0 }) } });
    await prisma.journalEntry.create({ data: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: draftBatchId, hubId, businessDate: new Date(), description: "Actual draft advance", lines: { create: [{ account: "OS_COD_PAYABLE", debit: 5000, credit: 0 }, { account: "WALLET_CASH", debit: 0, credit: 5000 }] } } });
    const preview = await request(app).get(`/api/v1/parcels/${draftParcelId}/void-preview`).set("Authorization", `Bearer ${token()}`);
    expect(preview.body.data).toMatchObject({ currentCod: 0, proposedObligationReduction: 0, lastZeroing: { codBefore: 9000, feeBefore: 1000 } });
    const response = await request(app).post(`/api/v1/parcels/${draftParcelId}/void`).set("Authorization", `Bearer ${token()}`).send({ reason: "Not on OS manifest", idempotencyKey: "22222222-2222-4222-8222-222222222222" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: "VOIDED", reversedCod: 0, remainingOsBalance: null });
    expect(await prisma.journalEntry.count({ where: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: draftBatchId } })).toBe(1);
  });
});
