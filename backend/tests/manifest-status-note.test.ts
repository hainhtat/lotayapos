import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { yangonBusinessDate } from "../src/services/operations.service.js";

describe("manifest status vs exception note mapping", () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const hubId = `msn-hub-${suffix}`;
  const shopId = `msn-shop-${suffix}`;
  const dispatcherId = `msn-dispatcher-${suffix}`;
  const riderUserId = `msn-rider-user-${suffix}`;
  const riderId = `msn-rider-${suffix}`;
  const batchId = `msn-batch-${suffix}`;
  const assignedId = `msn-assigned-${suffix}`;
  const failedWithNoteId = `msn-failed-note-${suffix}`;
  const failedReasonOnlyId = `msn-failed-reason-${suffix}`;

  const dispatcherToken = () =>
    signAccessToken({
      sub: dispatcherId,
      email: `dispatcher-${suffix}@example.com`,
      role: "DISPATCHER",
      tokenVersion: 0,
    });

  beforeAll(async () => {
    await prisma.hub.create({ data: { id: hubId, name: `Manifest note hub ${suffix}` } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Manifest note shop ${suffix}` } });
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
        id: riderUserId,
        name: "Khin Su Su San",
        email: `rider-${suffix}@example.com`,
        username: `rider-${suffix}`,
        passwordHash: "test-only",
        role: "RIDER",
        hubId,
        active: true,
      },
    });
    await prisma.rider.create({
      data: {
        id: riderId,
        userId: riderUserId,
        hubId,
        payModel: "PERCENTAGE",
        commissionRateBps: 4000,
      },
    });
    await prisma.batch.create({
      data: {
        id: batchId,
        label: `Batch ${suffix}`,
        shopId,
        hubId,
        pickupDate: new Date("2026-08-14T00:00:00.000Z"),
        advancePaid: 0,
      },
    });

    await prisma.parcel.create({
      data: {
        id: assignedId,
        batchId,
        riderId,
        trackingNumber: `MSN-ASN-${suffix}`,
        customerName: "Assigned Customer",
        address: "1 Assigned Road",
        codAmount: 10000,
        deliveryFee: 1500,
        advanceAmount: 0,
        status: "ASSIGNED",
      },
    });
    await prisma.parcel.create({
      data: {
        id: failedWithNoteId,
        batchId,
        riderId,
        trackingNumber: `MSN-FLD-NOTE-${suffix}`,
        customerName: "Failed Note Customer",
        address: "2 Failed Road",
        codAmount: 12000,
        deliveryFee: 1500,
        advanceAmount: 0,
        status: "FAILED",
        reasonCode: "NO_ANSWER",
      },
    });
    await prisma.parcel.create({
      data: {
        id: failedReasonOnlyId,
        batchId,
        riderId,
        trackingNumber: `MSN-FLD-REASON-${suffix}`,
        customerName: "Failed Reason Customer",
        address: "3 Failed Road",
        codAmount: 8000,
        deliveryFee: 1500,
        advanceAmount: 0,
        status: "FAILED",
        reasonCode: "WRONG_ADDRESS",
      },
    });

    await prisma.statusHistory.createMany({
      data: [
        {
          parcelId: assignedId,
          fromStatus: "CREATED",
          toStatus: "ASSIGNED",
          actorId: dispatcherId,
          note: "Bulk assigned to rider",
        },
        {
          parcelId: failedWithNoteId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "FAILED",
          actorId: dispatcherId,
          reasonCode: "NO_ANSWER",
          note: "Customer did not pick up",
        },
        {
          parcelId: failedReasonOnlyId,
          fromStatus: "OUT_FOR_DELIVERY",
          toStatus: "FAILED",
          actorId: dispatcherId,
          reasonCode: "WRONG_ADDRESS",
          note: null,
        },
      ],
    });
  });

  afterAll(async () => {
    const parcelIds = [assignedId, failedWithNoteId, failedReasonOnlyId];
    await prisma.statusHistory.deleteMany({ where: { parcelId: { in: parcelIds } } });
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } });
    await prisma.batch.deleteMany({ where: { id: batchId } });
    await prisma.rider.deleteMany({ where: { id: riderId } });
    await prisma.user.deleteMany({ where: { id: { in: [dispatcherId, riderUserId] } } });
    await prisma.onlineShop.deleteMany({ where: { id: shopId } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("keeps status on the status field and never puts status abbreviations in note", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/manifest/preview")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        riderIds: [riderId],
        statuses: ["ASSIGNED", "FAILED"],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const parcels = response.body.data.sections.flatMap(
      (section: { parcels: Array<{ trackingNumber: string; status: string; note: string | null }> }) => section.parcels,
    );
    expect(parcels).toHaveLength(3);

    const assigned = parcels.find((parcel: { trackingNumber: string }) => parcel.trackingNumber === `MSN-ASN-${suffix}`);
    expect(assigned).toMatchObject({ status: "ASSIGNED", note: null });
    expect(assigned.note).not.toBe("ASN");
    expect(assigned.note).not.toBe("ASSIGNED");

    const failedNote = parcels.find((parcel: { trackingNumber: string }) => parcel.trackingNumber === `MSN-FLD-NOTE-${suffix}`);
    expect(failedNote).toMatchObject({ status: "FAILED", note: "Customer did not pick up" });
    expect(failedNote.note).not.toBe("FLD");
    expect(failedNote.note).not.toBe("FAILED");

    const failedReason = parcels.find((parcel: { trackingNumber: string }) => parcel.trackingNumber === `MSN-FLD-REASON-${suffix}`);
    expect(failedReason).toMatchObject({ status: "FAILED", note: "WRONG_ADDRESS" });
    expect(failedReason.note).not.toBe("FLD");
  });

  test("sets Content-Disposition from sanitized rider filename suffix", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/manifest")
      .set("Authorization", `Bearer ${dispatcherToken()}`)
      .send({
        riderIds: [riderId],
        statuses: ["ASSIGNED", "FAILED"],
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/pdf/);
    const disposition = String(response.headers["content-disposition"] ?? "");
    const expected = `lotaya-manifest-khin-su-su-san-${yangonBusinessDate()}.pdf`;
    expect(disposition).toContain(`filename="${expected}"`);
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(expected)}`);
    expect(disposition).not.toContain("dispatch-manifest-");
    expect(Buffer.from(response.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
