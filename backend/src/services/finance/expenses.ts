import { randomUUID } from "node:crypto";
import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import { assertFinanceActor, resolveFinanceHub, type FinanceActor } from "../finance-authorization.js";
import { assertCashbookOpen } from "./cashbook-policy.js";
import { positiveAmount, walletAccount, type CashbookWallet } from "./cashbook-rules.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function buildExpenseLines(categoryCode: string, wallet: CashbookWallet, amount: number) {
  positiveAmount(amount, "amount");
  return [
    { account: `EXPENSE:${categoryCode}`, debit: amount, credit: 0 },
    { account: walletAccount(wallet), debit: 0, credit: amount },
  ];
}

export async function listExpenseCategories(actor: FinanceActor) {
  await assertFinanceActor(actor);
  return prisma.expenseCategory.findMany({ orderBy: { code: "asc" } });
}

export async function createExpenseCategory(input: { code: string; nameEn: string; nameMy: string }, actor: FinanceActor) {
  const user = await assertFinanceActor(actor);
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "FORBIDDEN", "Only Superadmin may create expense categories");
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.expenseCategory.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw new ApiError(409, "EXPENSE_CATEGORY_EXISTS", "Expense category already exists");
  return prisma.expenseCategory.create({ data: { code, nameEn: input.nameEn.trim(), nameMy: input.nameMy.trim() } });
}

export async function listExpenses(input: { businessDate?: string; hubId?: string; limit?: number }, actor: FinanceActor) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = input.businessDate ? businessDay(input.businessDate) : undefined;
  return prisma.expenseEntry.findMany({
    where: { hubId, ...(date ? { businessDate: date } : {}) },
    include: { category: true },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(input.limit ?? 100, 200),
  });
}

export async function postExpense(input: {
  businessDate: string; hubId?: string; categoryId: string; wallet: CashbookWallet;
  amount: number; description: string; idempotencyKey: string;
}, actor: FinanceActor) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  const description = input.description.trim();
  positiveAmount(input.amount, "amount");
  const existingForKey = async () => {
    const existing = await prisma.expenseEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { category: true } });
    if (!existing) return null;
    if (existing.actorId !== actor.id || existing.hubId !== hubId || existing.categoryId !== input.categoryId || existing.wallet !== input.wallet || existing.amount !== input.amount || existing.description !== description || existing.businessDate.getTime() !== date.getTime()) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different expense");
    }
    return existing;
  };
  const existing = await existingForKey();
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      await assertCashbookOpen(tx, date, hubId);
      const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
      if (!category || !category.active) throw new ApiError(400, "INVALID_EXPENSE_CATEGORY", "Expense category is unavailable");
      const expenseId = randomUUID();
      const journal = await tx.journalEntry.create({ data: {
        sourceType: "CASHBOOK_EXPENSE", sourceId: expenseId, hubId, businessDate: date, description,
        lines: { create: buildExpenseLines(category.code, input.wallet, input.amount) },
      } });
      return tx.expenseEntry.create({
        data: { id: expenseId, hubId, categoryId: category.id, wallet: input.wallet, businessDate: date, description, amount: input.amount, actorId: actor.id, journalEntryId: journal.id, idempotencyKey: input.idempotencyKey },
        include: { category: true },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await existingForKey();
      if (raced) return raced;
      if ((error as { code?: string }).code === "P2034") throw new ApiError(409, "RETRYABLE_CONFLICT", "Expenses changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}
