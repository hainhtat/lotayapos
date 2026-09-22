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

export function buildOpeningBalanceLines(wallet: CashbookWallet, amount: number) {
  positiveAmount(amount, "amount");
  return [
    { account: walletAccount(wallet), debit: amount, credit: 0 },
    { account: "OPENING_BALANCE_EQUITY", debit: 0, credit: amount },
  ];
}

export function buildWalletTransferLines(fromWallet: CashbookWallet, toWallet: CashbookWallet, amount: number) {
  positiveAmount(amount, "amount");
  if (fromWallet === toWallet) throw new ApiError(400, "INVALID_TRANSFER", "Source and destination wallets must differ");
  return [
    { account: walletAccount(toWallet), debit: amount, credit: 0 },
    { account: walletAccount(fromWallet), debit: 0, credit: amount },
  ];
}

export function buildCashbookAdjustmentLines(wallet: CashbookWallet, amount: number, direction: "INCREASE" | "DECREASE") {
  positiveAmount(amount, "amount");
  return direction === "INCREASE"
    ? [
        { account: walletAccount(wallet), debit: amount, credit: 0 },
        { account: "CASHBOOK_ADJUSTMENT", debit: 0, credit: amount },
      ]
    : [
        { account: "CASHBOOK_ADJUSTMENT", debit: amount, credit: 0 },
        { account: walletAccount(wallet), debit: 0, credit: amount },
      ];
}

async function postCashbookJournal(
  input: {
    businessDate: string;
    hubId?: string;
    sourceType: string;
    description: string;
    lines: Array<{ account: string; debit: number; credit: number }>;
    reason: string;
    idempotencyKey: string;
  },
  actor: FinanceActor,
) {
  await assertFinanceActor(actor);
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  const sourceId = input.idempotencyKey.trim();
  const description = `${input.description}: ${input.reason.trim()} [actor:${actor.id}]`;
  const existingForKey = async () => {
    const existing = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId } },
      include: { lines: true },
    });
    if (!existing) return null;
    const expectedLines = input.lines.map(({ account, debit, credit }) => `${account}:${debit}:${credit}`).sort();
    const actualLines = existing.lines.map(({ account, debit, credit }) => `${account}:${debit}:${credit}`).sort();
    if (
      existing.hubId !== hubId
      || existing.businessDate.getTime() !== date.getTime()
      || existing.description !== description
      || expectedLines.join("|") !== actualLines.join("|")
    ) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different cashbook posting");
    }
    return existing;
  };
  const existing = await existingForKey();
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      await assertCashbookOpen(tx, date, hubId);
      return tx.journalEntry.create({
        data: {
          sourceType: input.sourceType,
          sourceId,
          hubId,
          businessDate: date,
          description,
          lines: { create: input.lines },
        },
        include: { lines: true },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await existingForKey();
      if (raced) return raced;
      // A transaction may take its Serializable snapshot before waiting for
      // the per-day advisory lock. If the closer creates the day row while we
      // wait, our stale create can surface as P2002 rather than P2034. Re-read
      // outside that transaction and translate both database races into the
      // same stable domain result.
      const day = await prisma.cashbookDay.findUnique({ where: { hubId_businessDate: { hubId, businessDate: date } }, select: { closedAt: true } });
      if (day?.closedAt) throw new ApiError(409, "DAY_CLOSED", "Cashbook day is already closed");
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Cashbook changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}

export async function postOpeningBalance(
  input: { businessDate: string; hubId?: string; wallet: CashbookWallet; amount: number; reason: string; idempotencyKey: string },
  actor: FinanceActor,
) {
  return postCashbookJournal({
    ...input,
    sourceType: "CASHBOOK_OPENING_BALANCE",
    description: `Opening balance for ${input.wallet}`,
    lines: buildOpeningBalanceLines(input.wallet, input.amount),
  }, actor);
}

export async function postWalletTransfer(
  input: { businessDate: string; hubId?: string; fromWallet: CashbookWallet; toWallet: CashbookWallet; amount: number; reason: string; idempotencyKey: string },
  actor: FinanceActor,
) {
  return postCashbookJournal({
    ...input,
    sourceType: "CASHBOOK_TRANSFER",
    description: `Wallet transfer ${input.fromWallet} to ${input.toWallet}`,
    lines: buildWalletTransferLines(input.fromWallet, input.toWallet, input.amount),
  }, actor);
}

export async function postCashbookAdjustment(
  input: { businessDate: string; hubId?: string; wallet: CashbookWallet; amount: number; direction: "INCREASE" | "DECREASE"; reason: string; idempotencyKey: string },
  actor: FinanceActor,
) {
  return postCashbookJournal({
    ...input,
    sourceType: "CASHBOOK_ADJUSTMENT",
    description: `${input.direction.toLowerCase()} ${input.wallet} adjustment`,
    lines: buildCashbookAdjustmentLines(input.wallet, input.amount, input.direction),
  }, actor);
}
