import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { summarizeProfitEntries } from "../src/services/reports.service.js";
import { signAccessToken } from "../src/utils/jwt.js";

const hubId = "profit-report-hub";
const userId = (role: string) => `profit-report-${role.toLowerCase()}`;
const token = (role: string) => signAccessToken({
  sub: userId(role),
  email: `${role.toLowerCase()}@profit-report.test`,
  role,
  tokenVersion: 0,
});

describe("profit report", () => {
  beforeAll(async () => {
    await prisma.hub.upsert({ where: { id: hubId }, update: {}, create: { id: hubId, name: "Profit Report Hub" } });
    for (const role of ["FINANCE", "AUDITOR", "DISPATCHER", "SUPERADMIN"]) {
      await prisma.user.upsert({
        where: { id: userId(role) },
        update: { active: true, role, tokenVersion: 0, hubId: role === "SUPERADMIN" ? null : hubId },
        create: {
          id: userId(role), name: role, username: userId(role),
          email: `${role.toLowerCase()}@profit-report.test`, passwordHash: "test-only",
          role, tokenVersion: 0, hubId: role === "SUPERADMIN" ? null : hubId,
        },
      });
    }
    const createEntry = (sourceType: string, sourceId: string, lines: Array<{ account: string; debit: number; credit: number }>) =>
      prisma.journalEntry.create({
        data: {
          sourceType, sourceId, hubId, businessDate: new Date("2026-08-11T00:00:00.000Z"),
          description: sourceType, lines: { create: lines },
        },
      });
    await createEntry("DELIVERY_COLLECTION", "profit-fee", [
      { account: "WALLET_CASH", debit: 10_000, credit: 0 },
      { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 10_000 },
    ]);
    await createEntry("RIDER_COMMISSION", "profit-commission", [
      { account: "RIDER_COMMISSION_EXPENSE", debit: 4_000, credit: 0 },
      { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 4_000 },
    ]);
    await createEntry("RIDER_SALARY_DEDUCTION", "profit-salary", [
      { account: "RIDER_COMMISSION_PAYABLE", debit: 1_000, credit: 0 },
      { account: "RIDER_RECEIVABLE", debit: 0, credit: 1_000 },
    ]);
    await createEntry("OS_RETURN_DEDUCTION", "profit-return", [
      { account: "OS_SETTLEMENT_OFFSET", debit: 2_000, credit: 0 },
      { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: 2_000 },
    ]);
    await createEntry("CASHBOOK_EXPENSE", "profit-expense", [
      { account: "EXPENSE:RENT", debit: 500, credit: 0 },
      { account: "WALLET_CASH", debit: 0, credit: 500 },
    ]);
    await createEntry("CASHBOOK_ADJUSTMENT", "profit-adjustment", [
      { account: "WALLET_CASH", debit: 300, credit: 0 },
      { account: "CASHBOOK_ADJUSTMENT", debit: 0, credit: 300 },
    ]);
    await createEntry("DELIVERY_COLLECTION", "profit-outside-period", [
      { account: "WALLET_CASH", debit: 99_000, credit: 0 },
      { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: 99_000 },
    ]).then((entry) => prisma.journalEntry.update({ where: { id: entry.id }, data: { businessDate: new Date("2026-08-12T00:00:00.000Z") } }));
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.user.deleteMany({ where: { id: { in: ["FINANCE", "AUDITOR", "DISPATCHER", "SUPERADMIN"].map(userId) } } });
    await prisma.hub.deleteMany({ where: { id: hubId } });
  });

  test("returns ledger-derived components and exact journal drill-down for an inclusive period", async () => {
    const response = await request(app)
      .get("/api/v1/reports/profit?from=2026-08-11&to=2026-08-11")
      .set("Authorization", `Bearer ${token("FINANCE")}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      period: { from: "2026-08-11", to: "2026-08-11", inclusive: true },
      hubId,
      components: {
        deliveryFeeRevenue: 10_000,
        riderCommissionCost: 4_000,
        riderSalaryCost: 1_000,
        riderCompensationCost: 5_000,
        returns: { advanceRecovery: 2_000, includedInProfit: false },
        adjustments: { contribution: 300 },
        expenses: { cost: 500 },
      },
      grossProfit: 5_000,
      netProfit: 4_800,
    });
    expect(response.body.data.journalEntries).toHaveLength(6);
    expect(response.body.data.journalEntries[0].lines[0]).toEqual(expect.objectContaining({ account: expect.any(String), debit: expect.any(Number), credit: expect.any(Number) }));
  });

  test("enforces financial roles and hub scope", async () => {
    const forbidden = await request(app)
      .get("/api/v1/reports/profit?from=2026-08-11&to=2026-08-11")
      .set("Authorization", `Bearer ${token("DISPATCHER")}`);
    expect(forbidden.status).toBe(403);

    const missingHub = await request(app)
      .get("/api/v1/reports/profit?from=2026-08-11&to=2026-08-11")
      .set("Authorization", `Bearer ${token("SUPERADMIN")}`);
    expect(missingHub.status).toBe(400);
    expect(missingHub.body.error.code).toBe("HUB_REQUIRED");

    const auditor = await request(app)
      .get(`/api/v1/reports/profit?from=2026-08-11&to=2026-08-11&hubId=${hubId}`)
      .set("Authorization", `Bearer ${token("AUDITOR")}`);
    expect(auditor.status).toBe(200);
  });

  test("validates dates and their ordering", async () => {
    const malformed = await request(app)
      .get("/api/v1/reports/profit?from=08-11-2026&to=2026-08-11")
      .set("Authorization", `Bearer ${token("FINANCE")}`);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");

    const reversed = await request(app)
      .get("/api/v1/reports/profit?from=2026-08-12&to=2026-08-11")
      .set("Authorization", `Bearer ${token("FINANCE")}`);
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.code).toBe("INVALID_DATE_RANGE");
  });

  test("uses Yangon-local inclusive day boundaries for journal detail and totals", async () => {
    const rows = [
      ["before", "2026-08-10T17:29:59.999Z", 1],
      ["start", "2026-08-10T17:30:00.000Z", 10],
      ["end", "2026-08-11T17:29:59.999Z", 20],
      ["after", "2026-08-11T17:30:00.000Z", 2],
    ] as const;
    for (const [name, date, amount] of rows) await prisma.journalEntry.create({ data: {
      sourceType: "DELIVERY_COLLECTION", sourceId: `profit-boundary-${name}`, hubId,
      businessDate: new Date(date), description: name,
      lines: { create: [{ account: "WALLET_CASH", debit: amount, credit: 0 }, { account: "DELIVERY_FEE_REVENUE", debit: 0, credit: amount }] },
    } });
    try {
      const response = await request(app).get("/api/v1/reports/profit?from=2026-08-11&to=2026-08-11").set("Authorization", `Bearer ${token("FINANCE")}`);
      expect(response.status).toBe(200);
      const boundaryRows = response.body.data.journalEntries.filter((entry: { sourceId: string }) => entry.sourceId.startsWith("profit-boundary-"));
      expect(boundaryRows.map((entry: { sourceId: string }) => entry.sourceId).sort()).toEqual(["profit-boundary-end", "profit-boundary-start"]);
      expect(response.body.data.components.deliveryFeeRevenue).toBe(10_030);
    } finally {
      const entries = await prisma.journalEntry.findMany({ where: { sourceId: { startsWith: "profit-boundary-" } }, select: { id: true } });
      await prisma.journalLine.deleteMany({ where: { entryId: { in: entries.map((entry) => entry.id) } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entries.map((entry) => entry.id) } } });
    }
  });
});

describe("profit report reversal attribution", () => {
  test("uses the original source type so salary and return reversals offset their components", () => {
    const date = new Date("2026-08-11T00:00:00.000Z");
    const result = summarizeProfitEntries([
      {
        id: "salary-reversal", sourceType: "LEDGER_REVERSAL", sourceId: "salary-original",
        businessDate: date, description: "reversal", hubId,
        lines: [
          { id: "l1", entryId: "salary-reversal", account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: 1_000 },
          { id: "l2", entryId: "salary-reversal", account: "RIDER_RECEIVABLE", debit: 1_000, credit: 0 },
        ],
      },
    ], new Map([["salary-original", "RIDER_SALARY_DEDUCTION"]]));
    expect(result.components.riderSalaryCost).toBe(-1_000);
    expect(result.grossProfit).toBe(1_000);
  });

  test("uses persisted settlement salary metadata for the new receivable-only journal treatment", () => {
    const result = summarizeProfitEntries([
      {
        id: "settlement-journal", sourceType: "RIDER_SETTLEMENT", sourceId: "settlement-1",
        businessDate: new Date("2026-08-11T00:00:00Z"), description: "salary settlement", hubId,
        lines: [
          { id: "wallet", entryId: "settlement-journal", account: "WALLET_CASH", debit: 95_000, credit: 0 },
          { id: "before", entryId: "settlement-journal", account: "RIDER_RECEIVABLE", debit: 0, credit: 105_000 },
          { id: "salary", entryId: "settlement-journal", account: "RIDER_RECEIVABLE", debit: 10_000, credit: 0 },
        ],
      },
    ], new Map(), new Map([["settlement-journal", 10_000]]));
    expect(result.components.riderSalaryCost).toBe(10_000);
    expect(result.grossProfit).toBe(-10_000);
  });
});
