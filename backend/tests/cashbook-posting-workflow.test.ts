import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { lockCashbookDay } from "../src/services/finance/cashbook-policy.js";
import { postCashbookAdjustment } from "../src/services/finance/cashbook-postings.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("cashbook posting workflow", () => {
  const suffix = randomUUID();
  const hubId = `cashbook-hub-${suffix}`;
  const otherHubId = `cashbook-other-hub-${suffix}`;
  const userId = `cashbook-finance-${suffix}`;
  const auth = () => `Bearer ${signAccessToken({
    sub: userId,
    email: `${userId}@test.invalid`,
    role: "FINANCE",
    tokenVersion: 0,
  })}`;

  beforeAll(async () => {
    await prisma.hub.createMany({
      data: [
        { id: hubId, name: `Cashbook Hub ${suffix}` },
        { id: otherHubId, name: `Other Cashbook Hub ${suffix}` },
      ],
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: "Cashbook Finance",
        email: `${userId}@test.invalid`,
        passwordHash: "test-only",
        role: "FINANCE",
        hubId,
      },
    });
  });

  afterAll(async () => {
    await prisma.cashbookAudit.deleteMany({ where: { cashbookDay: { hubId } } });
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.hub.deleteMany({ where: { id: { in: [hubId, otherHubId] } } });
  });

  test("persists balanced wallet postings within hub scope and locks the closed day", async () => {
    const opening = await request(app)
      .post("/api/v1/finance/cashbook/opening-balances")
      .set("Authorization", auth())
      .send({ businessDate: "2039-04-10", wallet: "CASH", amount: 50_000, reason: "Opening till balance", idempotencyKey: `opening-${suffix}` });

    expect(opening.status).toBe(201);
    expect(opening.body.data.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: "WALLET_CASH", debit: 50_000, credit: 0 }),
      expect.objectContaining({ account: "OPENING_BALANCE_EQUITY", debit: 0, credit: 50_000 }),
    ]));
    expect(opening.body.data.lines.reduce(
      (total: number, line: { debit: number }) => total + line.debit,
      0,
    )).toBe(opening.body.data.lines.reduce(
      (total: number, line: { credit: number }) => total + line.credit,
      0,
    ));

    const replay = await request(app)
      .post("/api/v1/finance/cashbook/opening-balances")
      .set("Authorization", auth())
      .send({ businessDate: "2039-04-10", wallet: "CASH", amount: 50_000, reason: "Opening till balance", idempotencyKey: `opening-${suffix}` });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(opening.body.data.id);
    expect(await prisma.journalEntry.count({ where: { sourceType: "CASHBOOK_OPENING_BALANCE", sourceId: `opening-${suffix}` } })).toBe(1);

    const conflict = await request(app)
      .post("/api/v1/finance/cashbook/opening-balances")
      .set("Authorization", auth())
      .send({ businessDate: "2039-04-10", wallet: "CASH", amount: 50_001, reason: "Opening till balance", idempotencyKey: `opening-${suffix}` });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const adjustmentPayload = {
      businessDate: "2039-04-10", wallet: "KBZ_PAY", amount: 1_250,
      direction: "INCREASE", reason: "Verified wallet correction", idempotencyKey: `adjust-${suffix}`,
    };
    const [adjustment, adjustmentReplay] = await Promise.all([
      request(app).post("/api/v1/finance/cashbook/adjustments").set("Authorization", auth()).send(adjustmentPayload),
      request(app).post("/api/v1/finance/cashbook/adjustments").set("Authorization", auth()).send(adjustmentPayload),
    ]);
    expect([adjustment.status, adjustmentReplay.status]).toEqual([201, 201]);
    expect(adjustmentReplay.body.data.id).toBe(adjustment.body.data.id);
    expect(await prisma.journalEntry.count({ where: { sourceType: "CASHBOOK_ADJUSTMENT", sourceId: adjustmentPayload.idempotencyKey } })).toBe(1);

    const transferPayload = {
      businessDate: "2039-04-10", fromWallet: "CASH", toWallet: "WAVE_PAY",
      amount: 2_000, reason: "Move verified funds", idempotencyKey: `transfer-${suffix}`,
    };
    const transfer = await request(app).post("/api/v1/finance/cashbook/transfers").set("Authorization", auth()).send(transferPayload);
    const transferReplay = await request(app).post("/api/v1/finance/cashbook/transfers").set("Authorization", auth()).send(transferPayload);
    expect(transfer.status).toBe(201);
    expect(transferReplay.status).toBe(201);
    expect(transferReplay.body.data.id).toBe(transfer.body.data.id);

    const missingKey = await request(app)
      .post("/api/v1/finance/cashbook/adjustments")
      .set("Authorization", auth())
      .send({ businessDate: "2039-04-10", wallet: "CASH", amount: 1, direction: "INCREASE", reason: "Missing key" });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("VALIDATION_ERROR");

    const crossHub = await request(app)
      .post("/api/v1/finance/cashbook/adjustments")
      .set("Authorization", auth())
      .send({
        businessDate: "2039-04-10",
        hubId: otherHubId,
        wallet: "CASH",
        amount: 1_000,
        direction: "INCREASE",
        reason: "Must not cross hub scope",
        idempotencyKey: `cross-hub-${suffix}`,
      });
    expect(crossHub.status).toBe(403);
    expect(crossHub.body.error.code).toBe("FORBIDDEN");

    const close = await request(app)
      .post("/api/v1/finance/cashbook/close")
      .set("Authorization", auth())
      .send({ businessDate: "2039-04-10" });
    expect(close.status).toBe(200);

    const afterClose = await request(app)
      .post("/api/v1/finance/cashbook/transfers")
      .set("Authorization", auth())
      .send({
        businessDate: "2039-04-10",
        fromWallet: "CASH",
        toWallet: "KBZ_PAY",
        amount: 5_000,
        reason: "Closed date must reject transfer",
        idempotencyKey: `closed-transfer-${suffix}`,
      });
    expect(afterClose.status).toBe(409);
    expect(afterClose.body.error.code).toBe("DAY_CLOSED");
    expect(await prisma.journalEntry.count({
      where: { hubId, sourceType: "CASHBOOK_TRANSFER", sourceId: `closed-transfer-${suffix}` },
    })).toBe(0);
  });

  const postgresTest = process.env.DATABASE_PROVIDER === "postgresql" ? test : test.skip;
  postgresTest("serializes a posting behind a concurrent day close", async () => {
    const date = new Date("2039-04-11T00:00:00.000Z");
    let releaseClose!: () => void;
    const closeRelease = new Promise<void>((resolve) => { releaseClose = resolve; });
    let lockAcquired!: () => void;
    const locked = new Promise<void>((resolve) => { lockAcquired = resolve; });

    const closeTransaction = prisma.$transaction(async (tx) => {
      await lockCashbookDay(tx, date, hubId);
      lockAcquired();
      await closeRelease;
      await tx.cashbookDay.upsert({
        where: { hubId_businessDate: { hubId, businessDate: date } },
        create: { hubId, businessDate: date, closedAt: new Date(), closedBy: userId },
        update: { closedAt: new Date(), closedBy: userId },
      });
    }, { isolationLevel: "Serializable" });

    await locked;
    const posting = postCashbookAdjustment({
      businessDate: "2039-04-11", wallet: "CASH", amount: 100,
      direction: "INCREASE", reason: "Concurrent close regression",
      idempotencyKey: `concurrent-close-${suffix}`,
    }, { id: userId, role: "FINANCE" });

    let waitingOnAdvisoryLock = false;
    for (let attempt = 0; attempt < 100 && !waitingOnAdvisoryLock; attempt += 1) {
      const [state] = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory'
      `;
      waitingOnAdvisoryLock = (state?.count ?? 0) > 0;
      if (!waitingOnAdvisoryLock) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waitingOnAdvisoryLock).toBe(true);
    releaseClose();
    await closeTransaction;
    await expect(posting).rejects.toMatchObject({ status: 409, code: "DAY_CLOSED" });
    await expect(prisma.journalEntry.count({ where: { sourceType: "CASHBOOK_ADJUSTMENT", sourceId: `concurrent-close-${suffix}` } })).resolves.toBe(0);
  });
});
