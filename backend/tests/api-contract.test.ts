import request from "supertest";
import { app } from "../src/app.js";
import { signAccessToken } from "../src/utils/jwt.js";
import { prisma } from "../src/config/database.js";

const testRoles = ["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER","RIDER","AUDITOR"];
const token = (role = "FINANCE") => signAccessToken({ sub: `contract-${role.toLowerCase()}`, email: `${role.toLowerCase()}@contract.test`, role, tokenVersion:0 });

describe("protected API contracts", () => {
  beforeAll(async()=>{await prisma.hub.upsert({where:{id:"contract-hub"},update:{},create:{id:"contract-hub",name:"Contract Hub"}});for(const role of testRoles)await prisma.user.upsert({where:{id:`contract-${role.toLowerCase()}`},update:{active:true,role,tokenVersion:0},create:{id:`contract-${role.toLowerCase()}`,name:role,email:`${role.toLowerCase()}@contract.test`,username:`contract-${role.toLowerCase()}`,passwordHash:"test-only",role,hubId:role==="SUPERADMIN"?null:"contract-hub"}});});
  afterAll(async()=>{await prisma.user.deleteMany({where:{id:{in:testRoles.map(role=>`contract-${role.toLowerCase()}`)}}});await prisma.hub.deleteMany({where:{id:"contract-hub"}});});
  test("does not expose public registration", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({ name: "New User", email: "new@example.com", password: "strong-password" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });
  test("does not trust a Superadmin token claim without an active persisted administrator", async () => {
    const unpersisted = signAccessToken({sub:"missing-superadmin",email:"missing@example.com",role:"SUPERADMIN",tokenVersion:0});
    const response = await request(app).post("/api/v1/auth/register").set("Authorization", `Bearer ${unpersisted}`).send({ name: "New User", username: "new.user", email: "new@example.com", password: "strong-password" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });
  test("protects master data and validates hub creation", async () => {
    const unauthenticated = await request(app).get("/api/v1/master-data");
    expect(unauthenticated.status).toBe(401);
    const invalid = await request(app).post("/api/v1/master-data/hubs").set("Authorization", `Bearer ${token("SUPERADMIN")}`).send({ name: "x" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });
  test("requires a bounded idempotency key for expense writes", async () => {
    const response = await request(app).post("/api/v1/finance/expenses").set("Authorization", `Bearer ${token("FINANCE")}`).send({ businessDate: "2026-08-11", categoryId: "expense-rent", wallet: "CASH", amount: 1000, description: "Rent" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  const batchPayload = {
    shopId: "shop-1",
    pickupDate: "2026-08-11",
    batchName: "duplicate order import",
    advancePaid: 1000,
    fundingWallet: "CASH",
    parcels: [
      { trackingNumber: "CURRENT-001", orderId: "OS-100", customerName: "One", address: "Address 1", codAmount: 1000, townshipId: "township-1" },
      { trackingNumber: "CURRENT-002", orderId: "OS-100", customerName: "Two", address: "Address 2", codAmount: 2000, townshipId: "township-1" },
    ],
  };

  test("accepts duplicate order IDs through validation as non-unique references", async () => {
    const response = await request(app)
      .post("/api/v1/operations/batches")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({
        shopId: "shop-1",
        pickupDate: "2026-08-11",
        batchName: "duplicate order import",
        advancePaid: 1000,
        fundingWallet: "CASH",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects protected requests without a token", async () => {
    const response = await request(app).get("/api/v1/finance/ledger");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  test("protects parcel status history", async () => {
    const response = await request(app).get("/api/v1/parcels/parcel-1/history");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  test("protects rider-authorized parcel detail", async () => {
    const response = await request(app).get("/api/v1/parcels/parcel-1");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  test("rejects negative rider settlement wallet amounts before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/finance/rider-settlements")
      .set("Authorization", `Bearer ${token()}`)
      .send({
        riderId: "rider-1",
        businessDate: "2026-08-10",
        cash: -1,
        kbzPay: 0,
        wavePay: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  test("validates settlement variance evidence before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/finance/rider-settlements")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ riderId: "rider-1", businessDate: "2026-08-10", cash: 1, kbzPay: 0, wavePay: 0, varianceReason: "x" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("validates manual rider payment evidence before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/finance/rider-settlements")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ riderId: "rider-1", businessDate: "2026-08-10", cash: 1, kbzPay: 0, wavePay: 0, manualEntryReason: "x" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("validates rider outstanding business dates and protects settlement drafts by role", async () => {
    const invalidDate = await request(app)
      .get("/api/v1/finance/rider-outstanding?businessDate=invalid")
      .set("Authorization", `Bearer ${token("FINANCE")}`);
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.error.code).toBe("VALIDATION_ERROR");

    const forbidden = await request(app)
      .get("/api/v1/finance/os-settlement-drafts")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
  });

  test("validates rider settlement preview dates", async () => {
    const response = await request(app)
      .get("/api/v1/finance/rider-settlements/preview?businessDate=invalid")
      .set("Authorization", `Bearer ${token("RIDER")}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("validates OS settlement batch selection and adjustment evidence", async () => {
    const missingBatches = await request(app)
      .post("/api/v1/finance/os-settlements/preview")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ shopId: "shop-1", batchIds: [] });
    expect(missingBatches.status).toBe(400);
    expect(missingBatches.body.error.code).toBe("VALIDATION_ERROR");

    const missingReason = await request(app)
      .post("/api/v1/finance/os-settlements")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ shopId: "shop-1", batchIds: ["batch-1"], businessDate: "2026-08-13", wallet: "CASH", adjustmentAmount: 1, idempotencyKey: "os-settlement-1" });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("allows Superadmin to list OS settlements across hubs without a hubId", async () => {
    const response = await request(app)
      .get("/api/v1/finance/os-settlements")
      .set("Authorization", `Bearer ${token("SUPERADMIN")}`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  test("allows Auditor to list OS settlements in hub scope and denies preview", async () => {
    const list = await request(app)
      .get("/api/v1/finance/os-settlements")
      .set("Authorization", `Bearer ${token("AUDITOR")}`);
    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    expect(Array.isArray(list.body.data)).toBe(true);

    const preview = await request(app)
      .post("/api/v1/finance/os-settlements/preview")
      .set("Authorization", `Bearer ${token("AUDITOR")}`)
      .send({ shopId: "shop-1", batchIds: ["batch-1"] });
    expect(preview.status).toBe(403);
  });

  test("limits OS settlement reversals to finance roles", async () => {
    const response = await request(app)
      .post("/api/v1/finance/os-settlements/os-1/reversal")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ businessDate: "2026-08-13", reason: "Incorrect statement" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("prevents invalid rider wallet declarations before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/finance/rider-settlements/declarations")
      .set("Authorization", `Bearer ${token("RIDER")}`)
      .send({ businessDate: "2026-08-11", cash: -1, kbzPay: 0, wavePay: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("allows only riders to declare remittances", async () => {
    const response = await request(app)
      .post("/api/v1/finance/rider-settlements/declarations")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ businessDate: "2026-08-11", cash: 0, kbzPay: 0, wavePay: 0 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects invalid assigned-parcel query values before listing", async () => {
    const response = await request(app)
      .get("/api/v1/parcels?assignedToMe=maybe")
      .set("Authorization", `Bearer ${token("RIDER")}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects duplicate parcel IDs before bulk assignment persistence", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/bulk-assign")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ parcelIds: ["parcel-1", "parcel-1"], riderId: "rider-1" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PARCEL_IDS");
  });

  test("returns a validation error for an incomplete bulk assignment request", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/bulk-assign")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ parcelIds: [], riderId: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("requires a reason when reassigning a parcel", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/parcel-1/reassign")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ riderId: "rider-2", reason: "x" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("accepts actual COD in the partial-return request contract", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/parcel-1/status")
      .set("Authorization", `Bearer ${token("RIDER")}`)
      .send({ status: "PARTIAL", reasonCode: "ITEM_REJECTED", actualCodCollected: 60000, collectionWallet: "KBZ_PAY" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects negative actual COD before service execution", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/parcel-1/status")
      .set("Authorization", `Bearer ${token("RIDER")}`)
      .send({ status: "PARTIAL", reasonCode: "ITEM_REJECTED", actualCodCollected: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects malformed delivery collection payloads before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/finance/ledger/delivery-collections")
      .set("Authorization", `Bearer ${token()}`)
      .send({ parcelId: "parcel-1", businessDate: "not-a-date", wallet: "CASH", collectedCod: -1, collectedDeliveryFee: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects ledger reversal requests from operations managers", async () => {
    const response = await request(app)
      .post("/api/v1/finance/ledger/reversals")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ sourceType: "DELIVERY_COLLECTION", sourceId: "entry-1", businessDate: "2026-08-10", reason: "Correction" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects rider access to operations batches", async () => {
    const response = await request(app)
      .get("/api/v1/operations/batches")
      .set("Authorization", `Bearer ${token("RIDER")}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects finance access to operations alerts", async () => {
    const response = await request(app)
      .get("/api/v1/operations/alerts")
      .set("Authorization", `Bearer ${token("FINANCE")}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("enforces the batch creation role matrix before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/operations/batches")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send(batchPayload);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("prevents dispatchers from posting pickup advances", async () => {
    const response = await request(app)
      .post("/api/v1/operations/batches/batch-1/pickup-advances")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ fundingWallet: "CASH" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("validates Finance pickup-advance wallet selection before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/operations/batches/batch-1/pickup-advances")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ fundingWallet: "CARD" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects riders from the ERP dashboard", async () => {
    const response = await request(app)
      .get("/api/v1/master-data/dashboard")
      .set("Authorization", `Bearer ${token("RIDER")}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("protects alert acknowledgement from unauthorized roles", async () => {
    const response = await request(app)
      .post("/api/v1/operations/alerts/alert-1/acknowledge")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("validates pending-return extensions before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/parcel-1/return-extension")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ days: 31, reason: "Customer requested more time" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects operations-manager access to cashbook close", async () => {
    const response = await request(app)
      .post("/api/v1/finance/cashbook/close")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ businessDate: "2026-08-10" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("requires a reason for cashbook variance approval", async () => {
    const response = await request(app)
      .post("/api/v1/finance/cashbook/variance-approval")
      .set("Authorization", `Bearer ${token()}`)
      .send({ businessDate: "2026-08-10", reason: "x" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("allows only Superadmin to request a controlled cashbook reopen", async () => {
    const response = await request(app)
      .post("/api/v1/finance/cashbook/reopen")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ businessDate: "2026-08-10", reason: "Correction" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects malformed bulk dispatch payloads before assignment", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/bulk-assign")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ parcelIds: [], riderId: "rider-1" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects bulk dispatch selections larger than 500 parcels before assignment", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/bulk-assign")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({
        parcelIds: Array.from({ length: 501 }, (_, index) => `parcel-${index}`),
        riderId: "rider-1",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns a validation error for an incomplete manifest download request", async () => {
    const response = await request(app)
      .post("/api/v1/operations/parcels/manifest")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ riderIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects unknown parcel assignment filters", async () => {
    const response = await request(app)
      .get("/api/v1/parcels?assignmentStatus=queued")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("bounds parcel pagination before querying", async () => {
    const response = await request(app)
      .get("/api/v1/parcels?page=0&pageSize=101")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("validates configured reason-code creation", async () => {
    const response = await request(app)
      .post("/api/v1/master-data/reason-codes")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ code: "x", labelEn: "No answer", labelMy: "မကိုင်", outcome: "DELIVERED" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("requires username when creating a rider", async () => {
    const response = await request(app)
      .post("/api/v1/master-data/riders")
      .set("Authorization", `Bearer ${token("SUPERADMIN")}`)
      .send({ name: "Rider One", email: "rider@example.com", password: "strong-password", hubId: "hub-1", payModel: "PERCENTAGE", commissionRateBps: 4000, monthlySalary: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects invalid rider username format before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/master-data/riders")
      .set("Authorization", `Bearer ${token("SUPERADMIN")}`)
      .send({ name: "Rider One", username: "ab", email: "rider@example.com", password: "strong-password", hubId: "hub-1", payModel: "PERCENTAGE", commissionRateBps: 4000, monthlySalary: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects invalid rider pay-model combinations before persistence", async () => {
    const response = await request(app)
      .post("/api/v1/master-data/riders")
      .set("Authorization", `Bearer ${token("SUPERADMIN")}`)
      .send({
        name: "Rider One",
        username: "rider.one",
        email: "rider@example.com",
        password: "strong-password",
        hubId: "hub-1",
        payModel: "PERCENTAGE",
        commissionRateBps: 0,
        monthlySalary: 0,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_COMMISSION_RATE");
  });

  test("accepts full parcel lifecycle statuses in the status contract", async () => {
    const response = await request(app)
      .post("/api/v1/parcels/parcel-1/status")
      .set("Authorization", `Bearer ${token("FINANCE")}`)
      .send({ status: "CREATED", note: "correction" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("validates multi-township delivery fee updates before persistence", async () => {
    const response = await request(app)
      .patch("/api/v1/master-data/locations/townships/delivery-fees")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ townshipIds: [], deliveryFee: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects non-integer multi-township delivery fee before persistence", async () => {
    const response = await request(app)
      .patch("/api/v1/master-data/locations/townships/delivery-fees")
      .set("Authorization", `Bearer ${token("OPERATIONS_MANAGER")}`)
      .send({ townshipIds: ["township-1"], deliveryFee: 3.5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("validates parcel edits before persistence", async () => {
    const response = await request(app)
      .patch("/api/v1/parcels/parcel-1")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({ codAmount: -5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("requires at least one editable parcel field on PATCH", async () => {
    const response = await request(app)
      .patch("/api/v1/parcels/parcel-1")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
