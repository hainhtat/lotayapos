import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { businessDateUtcBoundary } from "../src/utils/business-date.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("wallet transaction statement", () => {
  const suffix = randomUUID();
  const hubId = `statement-hub-${suffix}`;
  const otherHubId = `statement-other-${suffix}`;
  const shopId = `statement-shop-${suffix}`;
  const batchId = `statement-batch-${suffix}`;
  const userId = `statement-finance-${suffix}`;
  const token = signAccessToken({ sub: userId, email: `${userId}@test.invalid`, role: "FINANCE", tokenVersion: 0 });
  const day = (value: string) => businessDateUtcBoundary(value, env.hubTimezone);

  beforeAll(async () => {
    await prisma.hub.createMany({ data: [{ id: hubId, name: `Statement Hub ${suffix}` }, { id: otherHubId, name: `Other Hub ${suffix}` }] });
    await prisma.user.create({ data: { id: userId, name: "Finance Tester", email: `${userId}@test.invalid`, passwordHash: "test", role: "FINANCE", hubId } });
    await prisma.onlineShop.create({ data: { id: shopId, name: `Statement Shop ${suffix}` } });
    await prisma.batch.create({ data: { id: batchId, shopId, hubId, pickupDate: day("2039-04-11"), label: "Statement batch" } });
    await prisma.journalEntry.create({ data: { sourceType: "CASHBOOK_OPENING_BALANCE", sourceId: `opening-${suffix}`, hubId, businessDate: day("2039-04-09"), description: "Opening balance", lines: { create: [{ account: "WALLET_CASH", debit: 100_000 }, { account: "OPENING_BALANCE_EQUITY", credit: 100_000 }] } } });
    await prisma.journalEntry.create({ data: { sourceType: "CASHBOOK_TRANSFER", sourceId: `transfer-${suffix}`, hubId, businessDate: day("2039-04-10"), description: "Transfer", lines: { create: [{ account: "WALLET_CASH", credit: 30_000 }, { account: "WALLET_KBZ_PAY", debit: 30_000 }] } } });
    await prisma.journalEntry.create({ data: { sourceType: "CASHBOOK_EXPENSE", sourceId: `expense-${suffix}`, hubId: otherHubId, businessDate: day("2039-04-10"), description: "Other hub expense", lines: { create: [{ account: "WALLET_CASH", credit: 9_000 }, { account: "OPERATING_EXPENSE", debit: 9_000 }] } } });
    const advance = await prisma.journalEntry.create({ data: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: batchId, hubId, businessDate: day("2039-04-11"), createdAt: new Date("2039-04-11T01:00:00Z"), description: "Advance paid", lines: { create: [{ account: "WALLET_CASH", credit: 20_000 }, { account: "OS_COD_PAYABLE", debit: 20_000 }] } } });
    await prisma.journalEntry.create({ data: { sourceType: "LEDGER_REVERSAL", sourceId: advance.id, hubId, businessDate: day("2039-04-11"), createdAt: new Date("2039-04-11T02:00:00Z"), description: "Advance correction", lines: { create: [{ account: "WALLET_CASH", debit: 20_000 }, { account: "OS_COD_PAYABLE", credit: 20_000 }] } } });
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entry: { hubId: { in: [hubId, otherHubId] } } } });
    await prisma.journalEntry.deleteMany({ where: { hubId: { in: [hubId, otherHubId] } } });
    await prisma.batch.delete({ where: { id: batchId } });
    await prisma.onlineShop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.hub.deleteMany({ where: { id: { in: [hubId, otherHubId] } } });
  });

  test("reconciles opening and transfer movements, without mixing hubs or row filters", async () => {
    const response = await request(app).get("/api/v1/finance/transactions")
      .set("Authorization", `Bearer ${token}`)
      .query({ from: "2039-04-10", to: "2039-04-10", hubId, wallet: "KBZ_PAY" });
    expect(response.status).toBe(200);
    expect(response.body.data.summary.wallets).toEqual(expect.arrayContaining([
      { wallet: "CASH", opening: 100_000, in: 0, out: 30_000, closing: 70_000 },
      { wallet: "KBZ_PAY", opening: 0, in: 30_000, out: 0, closing: 30_000 },
    ]));
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].wallets).toEqual(expect.arrayContaining([
      { wallet: "CASH", amount: -30_000 }, { wallet: "KBZ_PAY", amount: 30_000 },
    ]));
    expect(response.body.data.items[0].businessDate).toBe("2039-04-10");
    expect(response.body.data.items[0].balancesAfter).toEqual(expect.arrayContaining([
      { wallet: "CASH", balance: 70_000 }, { wallet: "KBZ_PAY", balance: 30_000 },
    ]));
    expect(response.body.data.pagination.total).toBe(1);
  });

  test("enforces hub scope and exports a complete CSV", async () => {
    const forbidden = await request(app).get("/api/v1/finance/transactions")
      .set("Authorization", `Bearer ${token}`)
      .query({ from: "2039-04-10", to: "2039-04-10", hubId: otherHubId });
    expect(forbidden.status).toBe(403);
    const csv = await request(app).get("/api/v1/finance/transactions")
      .set("Authorization", `Bearer ${token}`)
      .query({ from: "2039-04-10", to: "2039-04-10", hubId, format: "csv", pageSize: 1 });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("CASHBOOK_TRANSFER");
    expect(csv.text).toContain("Cash balance after");
    expect(csv.text).not.toContain("Other hub expense");
  });

  test("includes a shop advance and its reversal in the same filtered statement", async () => {
    const response = await request(app).get("/api/v1/finance/transactions")
      .set("Authorization", `Bearer ${token}`)
      .query({ from: "2039-04-11", to: "2039-04-11", hubId, shopId });
    expect(response.status).toBe(200);
    expect(response.body.data.items.map((item: { sourceType: string }) => item.sourceType)).toEqual(expect.arrayContaining(["BATCH_PICKUP_ADVANCE", "LEDGER_REVERSAL"]));
    expect(response.body.data.pagination.total).toBe(2);
    expect(response.body.data.summary.wallets.find((item: { wallet: string }) => item.wallet === "CASH")).toMatchObject({ opening: 70_000, in: 20_000, out: 20_000, closing: 70_000 });
    expect(response.body.data.items.map((item: { sourceType: string; balancesAfter: Array<{ wallet: string; balance: number }> }) => ({
      sourceType: item.sourceType,
      cashBalance: item.balancesAfter.find((balance) => balance.wallet === "CASH")?.balance,
    }))).toEqual(expect.arrayContaining([
      { sourceType: "BATCH_PICKUP_ADVANCE", cashBalance: 50_000 },
      { sourceType: "LEDGER_REVERSAL", cashBalance: 70_000 },
    ]));
  });
});
