import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { postExpense } from "../src/services/finance/expenses.js";
import { signAccessToken } from "../src/utils/jwt.js";

describe("expense posting workflow", () => {
  const suffix = randomUUID();
  const hubId = `expense-hub-${suffix}`;
  const otherHubId = `expense-other-hub-${suffix}`;
  const actor = { id: `expense-finance-${suffix}`, role: "FINANCE" };
  const categoryId = `expense-category-${suffix}`;
  const businessDate = "2038-03-10";
  const auth = () => `Bearer ${signAccessToken({ sub: actor.id, email: `${actor.id}@test.invalid`, role: actor.role, tokenVersion: 0 })}`;

  beforeAll(async () => {
    await prisma.hub.createMany({ data: [{ id: hubId, name: `Expense Hub ${suffix}` }, { id: otherHubId, name: `Other Hub ${suffix}` }] });
    await prisma.user.create({ data: { id: actor.id, name: "Expense Finance", email: `${actor.id}@test.invalid`, passwordHash: "fixture", role: actor.role, hubId } });
    await prisma.expenseCategory.create({ data: { id: categoryId, code: `RENT_${suffix.replaceAll("-", "").slice(0, 12).toUpperCase()}`, nameEn: "Rent", nameMy: "ငှားရမ်းခ" } });
  });

  afterAll(async () => {
    await prisma.expenseEntry.deleteMany({ where: { hubId } });
    await prisma.cashbookDay.deleteMany({ where: { hubId } });
    await prisma.journalLine.deleteMany({ where: { entry: { hubId } } });
    await prisma.journalEntry.deleteMany({ where: { hubId } });
    await prisma.expenseCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: actor.id } });
    await prisma.hub.deleteMany({ where: { id: { in: [hubId, otherHubId] } } });
  });

  test("posts balanced lines, replays the same command, and rejects a changed replay", async () => {
    const input = { businessDate, categoryId, wallet: "KBZ_PAY" as const, amount: 25_000, description: "Office rent", idempotencyKey: `expense-${suffix}` };
    const created = await postExpense(input, actor);
    expect(await postExpense(input, actor)).toEqual(created);
    await expect(postExpense({ ...input, amount: 30_000 }, actor)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const lines = await prisma.journalLine.findMany({ where: { entryId: created.journalEntryId }, orderBy: { account: "asc" } });
    expect(lines.map(({ account, debit, credit }) => ({ account, debit, credit }))).toEqual([
      { account: expect.stringMatching(/^EXPENSE:RENT_/), debit: 25_000, credit: 0 },
      { account: "WALLET_KBZ_PAY", debit: 0, credit: 25_000 },
    ]);
  });

  test("rejects cross-hub posting and a closed cashbook day", async () => {
    await expect(postExpense({ businessDate, hubId: otherHubId, categoryId, wallet: "CASH", amount: 100, description: "Wrong hub", idempotencyKey: `wrong-hub-${suffix}` }, actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.cashbookDay.create({ data: { hubId, businessDate: new Date("2038-03-11T00:00:00.000Z"), closedAt: new Date(), closedBy: actor.id } });
    await expect(postExpense({ businessDate: "2038-03-11", categoryId, wallet: "CASH", amount: 100, description: "Closed day", idempotencyKey: `closed-${suffix}` }, actor)).rejects.toMatchObject({ code: "DAY_CLOSED" });
    expect(await prisma.expenseEntry.count({ where: { idempotencyKey: `closed-${suffix}` } })).toBe(0);
  });

  test("bounds expense history and honors the requested page limit", async () => {
    await postExpense({ businessDate, categoryId, wallet: "CASH", amount: 500, description: "Office supplies", idempotencyKey: `expense-list-${suffix}` }, actor);

    const limited = await request(app)
      .get("/api/v1/finance/expenses?limit=1")
      .set("Authorization", auth());
    expect(limited.status).toBe(200);
    expect(limited.body.data).toHaveLength(1);

    const oversized = await request(app)
      .get("/api/v1/finance/expenses?limit=201")
      .set("Authorization", auth());
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.code).toBe("VALIDATION_ERROR");
  });
});
