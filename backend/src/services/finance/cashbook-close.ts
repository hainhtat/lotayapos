import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import { assertFinanceActor, resolveFinanceHub, type FinanceActor } from "../finance-authorization.js";
import { assertCashbookOpen, lockCashbookDay } from "./cashbook-policy.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
export function calculateWalletBalances(
  lines: Array<{ account: string; debit: number; credit: number }>,
) {
  const accounts = [
    "WALLET_CASH",
    "WALLET_KBZ_PAY",
    "WALLET_WAVE_PAY",
  ] as const;
  return accounts.map((account) => {
    const matching = lines.filter((line) => line.account === account);
    const debit = matching.reduce((sum, line) => sum + line.debit, 0);
    const credit = matching.reduce((sum, line) => sum + line.credit, 0);
    return { account, debit, credit, balance: debit - credit };
  });
}

export function calculateWalletReconciliationVariance(
  input: { wallet: string; journalAmount: number; settlementAmount: number }[],
) {
  return input.map((wallet) => ({
    ...wallet,
    variance: wallet.journalAmount - wallet.settlementAmount,
  }));
}

export async function closeCashbook(
  input: { businessDate: string; hubId?: string },
  actor: FinanceActor,
) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, hubId);
    const settlements = await tx.settlement.findMany({
      where: { businessDate: date, rider: { hubId } },
      select: { variance: true },
    });
    const varianceAmount = settlements.reduce(
      (sum, settlement) => sum + settlement.variance,
      0,
    );
    const existingDay = await tx.cashbookDay.findUnique({
      where: { hubId_businessDate: { hubId, businessDate: date } },
      select: {
        id: true,
        varianceApprovedAt: true,
        varianceAmount: true,
        varianceReason: true,
      },
    });
    if (
      settlements.some((settlement) => settlement.variance !== 0) &&
      (!existingDay?.varianceApprovedAt ||
        existingDay.varianceAmount !== varianceAmount ||
        !existingDay.varianceReason)
    )
      throw new ApiError(
        409,
        "UNRECONCILED_DAY",
        "Approve the cashbook variance before closing",
      );
    const walletLines = await tx.journalLine.findMany({
      where: {
        account: { in: ["WALLET_CASH", "WALLET_KBZ_PAY", "WALLET_WAVE_PAY"] },
        entry: { businessDate: date, hubId },
      },
      select: { account: true, debit: true, credit: true },
    });
    const walletBalances = calculateWalletBalances(walletLines);
    const settlementLines = await tx.settlementLine.findMany({
      where: { settlement: { businessDate: date, rider: { hubId } } },
      select: { wallet: true, amount: true },
    });
    const settlementJournalLines = await tx.journalLine.findMany({
      where: {
        account: { in: ["WALLET_CASH", "WALLET_KBZ_PAY", "WALLET_WAVE_PAY"] },
        entry: { businessDate: date, hubId, sourceType: "RIDER_SETTLEMENT" },
      },
      select: { account: true, debit: true, credit: true },
    });
    const walletReconciliation = calculateWalletReconciliationVariance([
      {
        wallet: "CASH",
        journalAmount: settlementJournalLines
          .filter((line) => line.account === "WALLET_CASH")
          .reduce((sum, line) => sum + line.debit - line.credit, 0),
        settlementAmount: settlementLines
          .filter((line) => line.wallet === "CASH")
          .reduce((sum, line) => sum + line.amount, 0),
      },
      {
        wallet: "KBZ_PAY",
        journalAmount: settlementJournalLines
          .filter((line) => line.account === "WALLET_KBZ_PAY")
          .reduce((sum, line) => sum + line.debit - line.credit, 0),
        settlementAmount: settlementLines
          .filter((line) => line.wallet === "KBZ_PAY")
          .reduce((sum, line) => sum + line.amount, 0),
      },
      {
        wallet: "WAVE_PAY",
        journalAmount: settlementJournalLines
          .filter((line) => line.account === "WALLET_WAVE_PAY")
          .reduce((sum, line) => sum + line.debit - line.credit, 0),
        settlementAmount: settlementLines
          .filter((line) => line.wallet === "WAVE_PAY")
          .reduce((sum, line) => sum + line.amount, 0),
      },
    ]);
    if (walletReconciliation.some((wallet) => wallet.variance !== 0))
      throw new ApiError(
        409,
        "WALLET_RECONCILIATION_FAILED",
        "Wallet settlement postings do not reconcile",
      );
    await tx.settlement.updateMany({
      where: { businessDate: date, status: "OPEN", rider: { hubId } },
      data: { status: "CLOSED" },
    });
    const closedAt = new Date();
    const closeSummary = JSON.stringify({
      varianceAmount,
      settlementCount: settlements.length,
      walletBalances,
      walletReconciliation,
    });
    const cashbook = await tx.cashbookDay.upsert({
      where: { hubId_businessDate: { hubId, businessDate: date } },
      update: {
        closedAt,
        closedBy: actor.id,
        varianceAmount,
        closeSummaryJson: closeSummary,
      },
      create: {
        hubId,
        businessDate: date,
        closedAt,
        closedBy: actor.id,
        varianceAmount,
        closeSummaryJson: closeSummary,
      },
    });
    await tx.cashbookAudit.create({
      data: {
        cashbookDayId: cashbook.id,
        action: "CLOSE",
        actorId: actor.id,
        reason: "Cashbook day closed",
        fromState: "OPEN",
        toState: "CLOSED",
        metadataJson: closeSummary,
      },
    });
    return { cashbook, walletBalances, walletReconciliation };
  }, { isolationLevel: "Serializable" });
}

export async function approveCashbookVariance(
  input: { businessDate: string; hubId?: string; reason: string },
  actor: FinanceActor,
) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  if (input.reason.trim().length < 3)
    throw new ApiError(
      400,
      "INVALID_REASON",
      "A variance approval reason is required",
    );
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, hubId);
    const settlements = await tx.settlement.findMany({
      where: { businessDate: date, rider: { hubId } },
      select: { variance: true },
    });
    const varianceAmount = settlements.reduce(
      (sum, settlement) => sum + settlement.variance,
      0,
    );
    if (varianceAmount === 0)
      throw new ApiError(
        409,
        "NO_VARIANCE",
        "There is no cashbook variance to approve",
      );
    const day = await tx.cashbookDay.upsert({
      where: { hubId_businessDate: { hubId, businessDate: date } },
      update: {
        varianceAmount,
        varianceReason: input.reason.trim(),
        varianceApprovedAt: new Date(),
        varianceApprovedBy: actor.id,
      },
      create: {
        hubId,
        businessDate: date,
        varianceAmount,
        varianceReason: input.reason.trim(),
        varianceApprovedAt: new Date(),
        varianceApprovedBy: actor.id,
      },
    });
    await tx.cashbookAudit.create({
      data: {
        cashbookDayId: day.id,
        action: "VARIANCE_APPROVED",
        actorId: actor.id,
        reason: input.reason.trim(),
        fromState: "OPEN",
        toState: "OPEN",
        metadataJson: JSON.stringify({ varianceAmount }),
      },
    });
    return day;
  }, { isolationLevel: "Serializable" });
}

export async function reopenCashbook(
  input: { businessDate: string; hubId?: string; reason: string },
  actor: FinanceActor,
) {
  await assertFinanceActor(actor);
  if (actor.role !== "SUPERADMIN")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only a Superadmin may reopen a cashbook day",
    );
  if (input.reason.trim().length < 3)
    throw new ApiError(400, "INVALID_REASON", "A reopen reason is required");
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    await lockCashbookDay(tx, date, hubId);
    const day = await tx.cashbookDay.findUnique({
      where: { hubId_businessDate: { hubId, businessDate: date } },
    });
    if (!day?.closedAt)
      throw new ApiError(409, "DAY_NOT_CLOSED", "Cashbook day is not closed");
    const reopenedAt = new Date();
    const updated = await tx.cashbookDay.update({
      where: { id: day.id },
      data: {
        closedAt: null,
        closedBy: null,
        reopenedAt,
        reopenedBy: actor.id,
        reopenReason: input.reason.trim(),
        varianceApprovedAt: null,
        varianceApprovedBy: null,
        varianceAmount: 0,
        varianceReason: null,
      },
    });
    await tx.settlement.updateMany({
      where: { businessDate: date, status: "CLOSED", rider: { hubId } },
      data: { status: "OPEN" },
    });
    await tx.cashbookAudit.create({
      data: {
        cashbookDayId: day.id,
        action: "REOPEN",
        actorId: actor.id,
        reason: input.reason.trim(),
        fromState: "CLOSED",
        toState: "OPEN",
        metadataJson: JSON.stringify({
          closedAt: day.closedAt,
          closedBy: day.closedBy,
          closeSummaryJson: day.closeSummaryJson,
        }),
      },
    });
    return updated;
  }, { isolationLevel: "Serializable" });
}
