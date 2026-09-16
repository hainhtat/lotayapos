import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { acquireTrackingAllocationLock, formatTrackingNumber, nextTrackingSequenceStart } from "../src/services/operations.service.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("bulk parcel tracking allocation", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `tracking-hub-${suffix}`;
  const shopId = `tracking-shop-${suffix}`;
  const dispatcherId = `tracking-dispatcher-${suffix}`;
  const regionId = `tracking-region-${suffix}`;
  const districtId = `tracking-district-${suffix}`;
  const townshipId = `tracking-township-${suffix}`;
  const batchId = `tracking-batch-${suffix}`;
  let staleTrackingNumber: string;

  const authToken = () => signAccessToken({
    sub: dispatcherId,
    email: `tracking-${suffix}@example.com`,
    role: "DISPATCHER",
    tokenVersion: 0,
  });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Tracking hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Tracking shop ${suffix}` } });
    await prisma.user.create({
      data: {
        id: dispatcherId,
        name: "Tracking Dispatcher",
        email: `tracking-${suffix}@example.com`,
        username: `tracking-${suffix}`,
        passwordHash: "test-only",
        role: "DISPATCHER",
        hubId,
      },
    });
    await prisma.regionState.create({ data: { id: regionId, code: `TR-${suffix}`, nameEn: `Tracking Region ${suffix}`, nameMy: "" } });
    await prisma.district.create({ data: { id: districtId, code: `TD-${suffix}`, regionStateId: regionId, nameEn: `Tracking District ${suffix}`, nameMy: "" } });
    await prisma.township.create({ data: { id: townshipId, code: `TT-${suffix}`, districtId, nameEn: `Tracking Township ${suffix}`, deliveryFee: 1500 } });
    await prisma.batch.create({ data: { id: batchId, shopId, hubId, pickupDate: new Date("2035-01-01T00:00:00.000Z"), label: `Tracking batch ${suffix}` } });

    staleTrackingNumber = formatTrackingNumber(await nextTrackingSequenceStart());
    await prisma.parcel.create({
      data: {
        batchId,
        trackingNumber: staleTrackingNumber,
        customerName: "Previously saved parcel",
        address: "Existing address",
        codAmount: 1,
        townshipId,
      },
    });
  });

  afterAll(async () => {
    await prisma.parcel.deleteMany({ where: { batchId } });
    await prisma.osBatchObligation.deleteMany({ where: { batchId } });
    const obligationEntries = await prisma.journalEntry.findMany({ where: { hubId }, select: { id: true } });
    await prisma.journalLine.deleteMany({ where: { entryId: { in: obligationEntries.map((entry) => entry.id) } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: obligationEntries.map((entry) => entry.id) } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.township.deleteMany({ where: { id: townshipId } });
    await prisma.district.deleteMany({ where: { id: districtId } });
    await prisma.regionState.deleteMany({ where: { id: regionId } });
    await prisma.user.deleteMany({ where: { id: dispatcherId } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("replaces stale client previews with unique server-allocated identifiers", async () => {
    const response = await request(app)
      .post(`/api/v1/operations/batches/${batchId}/parcels/bulk`)
      .set("Authorization", `Bearer ${authToken()}`)
      .send({
        parcels: [
          { trackingNumber: staleTrackingNumber, orderId: "ORDER-1", customerName: "One", address: "Address 1", codAmount: 1000, townshipId },
          { trackingNumber: staleTrackingNumber, orderId: "ORDER-2", customerName: "Two", address: "Address 2", codAmount: 2000, townshipId },
        ],
      });

    expect(response.status).toBe(201);
    const allocated = response.body.data.map((parcel: { trackingNumber: string }) => parcel.trackingNumber);
    expect(allocated).toHaveLength(2);
    expect(new Set(allocated).size).toBe(2);
    expect(allocated).not.toContain(staleTrackingNumber);
    expect(allocated.every((value: string) => /^LTY-\d+$/.test(value))).toBe(true);
  });

  test("accepts new clients that omit tracking previews", async () => {
    const response = await request(app)
      .post(`/api/v1/operations/batches/${batchId}/parcels/bulk`)
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ parcels: [{ orderId: "ORDER-3", customerName: "Three", address: "Address 3", codAmount: 3000, townshipId }] });

    expect(response.status).toBe(201);
    expect(response.body.data[0].trackingNumber).toMatch(/^LTY-\d+$/);
  });

  const postgresTest = process.env.DATABASE_PROVIDER === "postgresql" ? test : test.skip;
  postgresTest("concurrent saves allocate distinct tracking numbers and finalize the full obligation", async () => {
    const responses = await Promise.all([1, 2].map(i => request(app)
      .post(`/api/v1/operations/batches/${batchId}/parcels/bulk`)
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ parcels: [{ orderId: `CONCURRENT-${i}`, customerName: "Concurrent", address: "Address", codAmount: 500, townshipId }] })));
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    expect(new Set(responses.map(response => response.body.data[0].trackingNumber)).size).toBe(2);
    const [racingSave, finalized] = await Promise.all([
      request(app).post(`/api/v1/operations/batches/${batchId}/parcels/bulk`)
        .set("Authorization", `Bearer ${authToken()}`)
        .send({ parcels: [{ orderId: "RACING-FINALIZE", customerName: "Race", address: "Address", codAmount: 750, townshipId }] }),
      request(app).post(`/api/v1/operations/batches/${batchId}/finalize`).set("Authorization", `Bearer ${authToken()}`),
    ]);
    expect([201, 409]).toContain(racingSave.status);
    if (racingSave.status === 409) expect(racingSave.body.error.code).toBe("BATCH_FINALIZED");
    expect(finalized.status).toBe(200);
    const cod = await prisma.parcel.aggregate({ where: { batchId }, _sum: { codAmount: true } });
    const obligation = await prisma.osBatchObligation.findUniqueOrThrow({ where: { batchId } });
    expect(obligation.originalCod).toBe(cod._sum.codAmount);
  });
});

describe("PostgreSQL tracking allocation lock", () => {
  test("projects the advisory lock to a Prisma-supported integer", async () => {
    let sql = "";
    const client = {
      $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
        sql = parts.join("");
        return [{ locked: 1 }];
      }),
    };

    await acquireTrackingAllocationLock(client as never, "postgresql");

    expect(sql).toContain("SELECT 1::integer AS locked");
    expect(sql).toContain("FROM pg_advisory_xact_lock(1280268628)");
  });
});
