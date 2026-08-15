import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import type { Prisma } from "@prisma/client";
import { assertCashbookOpen } from "./finance.service.js";
import { resolveCommissionRateBps } from "../utils/commission.js";
import {
  buildReturnDeductionLines,
  postReturnDeductionInTx,
  recoverableAdvance,
} from "./os-advance.js";

export {
  buildReturnDeductionLines,
  postReturnDeductionInTx,
  recoverableAdvance,
  recoverableAdvanceAmount,
  sumUnreversedCreditsToOsAdvanceReceivable,
  sumUnreversedCreditsToOsAdvanceReceivableByParcel,
} from "./os-advance.js";

export type LedgerWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";
export type LedgerActor = { id: string; role: string };
export type LedgerLineInput = { account: string; debit?: number; credit?: number };

const walletAccounts: Record<LedgerWallet, string> = {
  CASH: "WALLET_CASH",
  KBZ_PAY: "WALLET_KBZ_PAY",
  WAVE_PAY: "WALLET_WAVE_PAY",
};

const financeRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER"];
const ledgerReadRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"];

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function assertAmount(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) throw new ApiError(400, "INVALID_AMOUNT", `${field} must be a non-negative integer`);
}

export function assertBalancedLines(lines: LedgerLineInput[]) {
  if (lines.length < 2) throw new ApiError(400, "INVALID_JOURNAL", "A journal entry needs at least two lines");
  const debit = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
  if (debit <= 0 || debit !== credit) throw new ApiError(400, "UNBALANCED_JOURNAL", "Journal debits must equal credits");
  for (const line of lines) {
    const lineDebit = line.debit ?? 0;
    const lineCredit = line.credit ?? 0;
    if (!Number.isInteger(lineDebit) || !Number.isInteger(lineCredit) || lineDebit < 0 || lineCredit < 0 || (lineDebit > 0 && lineCredit > 0)) {
      throw new ApiError(400, "INVALID_JOURNAL", "Each journal line must contain either a non-negative debit or credit");
    }
  }
  return { debit, credit };
}

function walletAccount(wallet: LedgerWallet) {
  const account = walletAccounts[wallet];
  if (!account) throw new ApiError(400, "INVALID_WALLET", "Wallet must be Cash, KBZ Pay, or Wave Pay");
  return account;
}

async function actorScope(actor: LedgerActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role) throw new ApiError(403, "FORBIDDEN", "Active finance scope required");
  return user;
}

async function assertFinanceAccess(actor: LedgerActor, hubId: string | null) {
  const user = await actorScope(actor);
  if (!financeRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not post ledger entries");
  if (user.role !== "SUPERADMIN" && (!user.hubId || user.hubId !== hubId)) throw new ApiError(403, "FORBIDDEN", "Resource is outside your hub scope");
  return user;
}

async function assertLedgerReadAccess(actor: LedgerActor) {
  const user = await actorScope(actor);
  if (!ledgerReadRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not view the ledger");
  return user;
}

function createLines(tx: Prisma.TransactionClient, entryId: string, lines: LedgerLineInput[]) {
  assertBalancedLines(lines);
  return tx.journalLine.createMany({ data: lines.map((line) => ({ entryId, account: line.account, debit: line.debit ?? 0, credit: line.credit ?? 0 })) });
}

function sourceKey(sourceType: string, sourceId: string) {
  return { sourceType_sourceId: { sourceType, sourceId } };
}

async function parcelForActor(parcelId: string, actor: LedgerActor) {
  const parcel = await prisma.parcel.findUnique({
    where: { id: parcelId },
    include: {
      batch: { select: { hubId: true } },
      rider: { select: { payModel: true, commissionRateBps: true } },
    },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  if (!parcel.batch.hubId) throw new ApiError(409, "PARCEL_HUB_REQUIRED", "Parcel batch must belong to a hub");
  await assertFinanceAccess(actor, parcel.batch.hubId);
  return parcel;
}

export function buildDeliveryCollectionLines(input: { collectedCod: number; collectedDeliveryFee: number; advanceAmount: number; wallet: LedgerWallet }) {
  assertAmount(input.collectedCod, "collectedCod");
  assertAmount(input.collectedDeliveryFee, "collectedDeliveryFee");
  assertAmount(input.advanceAmount, "advanceAmount");
  const total = input.collectedCod + input.collectedDeliveryFee;
  if (total <= 0) throw new ApiError(400, "INVALID_COLLECTION", "At least one collected amount is required");
  const appliedAdvance = Math.min(input.collectedCod, input.advanceAmount);
  const lines: LedgerLineInput[] = [{ account: walletAccount(input.wallet), debit: total, credit: 0 }];
  if (appliedAdvance > 0) lines.push({ account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: appliedAdvance });
  const CODPayable = input.collectedCod - appliedAdvance;
  if (CODPayable > 0) lines.push({ account: "OS_COD_PAYABLE", debit: 0, credit: CODPayable });
  if (input.collectedDeliveryFee > 0) lines.push({ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: input.collectedDeliveryFee });
  assertBalancedLines(lines);
  return { lines, appliedAdvance, shortfall: Math.max(input.advanceAmount - input.collectedCod, 0), totalCollected: total };
}

export function calculateLinkedDeliveryAmounts(input: { baseDeliveryFee: number; parcelCount: number; commissionRateBps: number; increment?: number }) {
  const increment = input.increment ?? 1000;
  assertAmount(input.baseDeliveryFee, "baseDeliveryFee");
  assertAmount(input.commissionRateBps, "commissionRateBps");
  if (!Number.isInteger(input.parcelCount) || input.parcelCount < 1 || !Number.isInteger(increment) || increment < 0) throw new ApiError(400, "INVALID_LINKED_FEE", "Linked parcel fee inputs are invalid");
  const deliveryFee = input.baseDeliveryFee + (input.parcelCount - 1) * increment;
  return { deliveryFee, commission: Math.round(deliveryFee * input.commissionRateBps / 10000) };
}

export function calculatePartialReturnAmounts(input: { codAmount: number; advanceAmount: number; actualCodCollected: number }) {
  assertAmount(input.codAmount, "codAmount");
  assertAmount(input.advanceAmount, "advanceAmount");
  assertAmount(input.actualCodCollected, "actualCodCollected");
  if (input.actualCodCollected > input.codAmount) throw new ApiError(400, "COLLECTION_EXCEEDS_PARCEL", "Actual COD collected cannot exceed the original COD amount");
  if (input.advanceAmount > input.codAmount) throw new ApiError(400, "INVALID_ADVANCE", "Advance amount cannot exceed the original COD amount");
  const shortfall = input.codAmount - input.actualCodCollected;
  return { originalCod: input.codAmount, actualCodCollected: input.actualCodCollected, shortfall, settlementOffset: Math.min(shortfall, input.advanceAmount) };
}

export function buildPartialReturnAdjustmentLines(amount: number) {
  return buildReturnDeductionLines(amount);
}

export function buildPartialReturnCollectionLines(actualCodCollected: number, wallet: LedgerWallet) {
  assertAmount(actualCodCollected, "actualCodCollected");
  if (actualCodCollected === 0) return [];
  const lines = [
    { account: walletAccount(wallet), debit: actualCodCollected, credit: 0 },
    { account: "CUSTOMER_COD_RECEIVABLE", debit: 0, credit: actualCodCollected },
  ];
  assertBalancedLines(lines);
  return lines;
}

export async function postDeliveryCollection(input: { parcelId: string; businessDate: string; wallet: LedgerWallet; collectedCod: number; collectedDeliveryFee: number }, actor: LedgerActor) {
  const parcel = await parcelForActor(input.parcelId, actor);
  const parcelHubId = parcel.batch.hubId!;
  if (parcel.status !== "DELIVERED") throw new ApiError(409, "PARCEL_NOT_DELIVERED", "Collections can only be posted for delivered parcels");
  const group = parcel.linkGroupId ? await prisma.parcelLinkGroup.findUnique({ where: { id: parcel.linkGroupId }, include: { parcels: true } }) : null;
  if (group && group.parcels.some((linkedParcel) => linkedParcel.status !== "DELIVERED")) throw new ApiError(409, "LINKED_GROUP_NOT_DELIVERED", "Every parcel in the linked group must be delivered before collection");
  const maximumCod = group ? group.parcels.reduce((sum, linkedParcel) => sum + linkedParcel.codAmount, 0) : parcel.codAmount;
  const maximumFee = group ? group.totalDeliveryFee : (parcel.deliveryFee ?? 0);
  const advanceAmount = group ? group.parcels.reduce((sum, linkedParcel) => sum + linkedParcel.advanceAmount, 0) : parcel.advanceAmount;
  if (input.collectedCod > maximumCod || input.collectedDeliveryFee > maximumFee) throw new ApiError(400, "COLLECTION_EXCEEDS_PARCEL", "Collected amounts cannot exceed the parcel or linked-group totals");
  const date = businessDay(input.businessDate);
  const collection = buildDeliveryCollectionLines({ ...input, advanceAmount });
  const sourceType = group ? "LINKED_DELIVERY_COLLECTION" : "DELIVERY_COLLECTION";
  const sourceId = group?.id ?? parcel.id;

  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, parcelHubId);
    const existing = await tx.journalEntry.findUnique({ where: sourceKey(sourceType, sourceId) });
    if (existing) throw new ApiError(409, "COLLECTION_EXISTS", "A delivery collection already exists for this parcel");
    const entry = await tx.journalEntry.create({ data: { sourceType, sourceId, hubId: parcelHubId, businessDate: date, description: group ? `Linked delivery collection for ${group.id}` : `Delivery collection for ${parcel.trackingNumber}` } });
    await createLines(tx, entry.id, collection.lines);
    let commissionEntry = null;
    if (group) {
      const commissionRateBps = resolveCommissionRateBps(parcel.rider);
      const commission = Math.round(group.totalDeliveryFee * commissionRateBps / 10000);
      if (commission > 0) commissionEntry = await tx.journalEntry.create({ data: { sourceType: "LINKED_RIDER_COMMISSION", sourceId: group.id, hubId: parcelHubId, businessDate: date, description: `Linked rider commission for ${group.id}`, lines: { create: [{ account: "RIDER_COMMISSION_EXPENSE", debit: commission, credit: 0 }, { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: commission }] } } });
    }
    let shortfallEntry = null;
    if (collection.shortfall > 0) {
      shortfallEntry = await tx.journalEntry.create({ data: { sourceType: group ? "LINKED_OS_SHORTFALL" : "OS_SHORTFALL", sourceId, hubId: parcelHubId, businessDate: date, description: `OS shortfall for ${group ? `linked group ${group.id}` : parcel.trackingNumber}`, lines: { create: [{ account: "OS_SHORTFALL_RECEIVABLE", debit: collection.shortfall, credit: 0 }, { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: collection.shortfall }] } } });
    }
    return { entry, commissionEntry, shortfallEntry, ...collection };
  });
}

export async function postReturnDeduction(input: { parcelId: string; businessDate: string; amount?: number }, actor: LedgerActor) {
  const parcel = await parcelForActor(input.parcelId, actor);
  const parcelHubId = parcel.batch.hubId!;
  if (parcel.status !== "RETURNED") throw new ApiError(409, "PARCEL_NOT_RETURNED", "Return deductions can only be posted for returned parcels");
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, parcelHubId);
    const recoverable = await recoverableAdvance(tx, parcel);
    const amount = input.amount ?? recoverable;
    if (amount > recoverable) {
      throw new ApiError(400, "DEDUCTION_EXCEEDS_ADVANCE", "Return deduction cannot exceed the recoverable advance remainder");
    }
    if (amount <= 0) throw new ApiError(400, "INVALID_DEDUCTION", "Return deduction must be greater than zero");
    return postReturnDeductionInTx(tx, { parcel, hubId: parcelHubId, businessDate: date, amount });
  });
}

async function assertOriginalScope(actor: LedgerActor, entry: { sourceType: string; sourceId: string | null }) {
  const user = await actorScope(actor);
  if (!financeRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not reverse ledger entries");
  if (user.role === "SUPERADMIN") return;
  if (!entry.sourceId) throw new ApiError(403, "FORBIDDEN", "Entry scope cannot be verified");
  if (entry.sourceType === "BATCH_PICKUP_ADVANCE") {
    const batchId = entry.sourceId.split(":")[0]!;
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { hubId: true } });
    if (!batch || batch.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Entry is outside your hub scope");
    return;
  }
  if (["PICKUP_ADVANCE", "DELIVERY_COLLECTION", "PARTIAL_RETURN_COLLECTION", "OS_PARTIAL_RETURN_ADJUSTMENT", "OS_SHORTFALL", "OS_RETURN_DEDUCTION", "RIDER_COMMISSION", "RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD"].includes(entry.sourceType)) {
    const parcelId = ["OS_RETURN_DEDUCTION", "RIDER_COMMISSION", "RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD"].includes(entry.sourceType)
      ? entry.sourceId.split(":")[0]!
      : entry.sourceId;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, include: { batch: { select: { hubId: true } } } });
    if (!parcel || parcel.batch.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Entry is outside your hub scope");
    return;
  }
  if (["LINKED_RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_FEE", "LINKED_DELIVERY_COLLECTION", "LINKED_RIDER_COMMISSION", "LINKED_OS_SHORTFALL"].includes(entry.sourceType)) {
    const groupId = entry.sourceId.split(":")[0]!;
    const group = await prisma.parcelLinkGroup.findUnique({ where: { id: groupId }, include: { parcels: { include: { batch: { select: { hubId: true } } } } } });
    if (!group || group.parcels.some((parcel) => parcel.batch.hubId !== user.hubId)) throw new ApiError(403, "FORBIDDEN", "Entry is outside your hub scope");
    return;
  }
  if (entry.sourceType === "RIDER_SETTLEMENT") {
    const settlement = await prisma.settlement.findUnique({ where: { id: entry.sourceId }, include: { rider: { select: { hubId: true } } } });
    if (!settlement || settlement.rider.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Entry is outside your hub scope");
    return;
  }
  throw new ApiError(403, "FORBIDDEN", "This entry type cannot be reversed");
}

export async function reverseJournalEntryInTx(
  tx: Prisma.TransactionClient,
  input: { sourceType: string; sourceId: string; businessDate: Date; reason: string },
) {
  const original = await tx.journalEntry.findUnique({ where: sourceKey(input.sourceType, input.sourceId), include: { lines: true } });
  if (!original) return null;
  if (!original.hubId) throw new ApiError(409, "ENTRY_HUB_REQUIRED", "Legacy unscoped entry requires migration before reversal");
  const existing = await tx.journalEntry.findUnique({ where: sourceKey("LEDGER_REVERSAL", original.id) });
  if (existing) return existing;
  await assertCashbookOpen(tx, input.businessDate, original.hubId);
  return tx.journalEntry.create({
    data: {
      sourceType: "LEDGER_REVERSAL",
      sourceId: original.id,
      hubId: original.hubId,
      businessDate: input.businessDate,
      description: `Reversal: ${input.reason}`,
      lines: { create: original.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit })) },
    },
    include: { lines: true },
  });
}

export async function reverseJournalEntry(input: { sourceType: string; sourceId: string; businessDate: string; reason: string }, actor: LedgerActor) {
  if (input.sourceType === "LEDGER_REVERSAL") throw new ApiError(400, "INVALID_REVERSAL", "A reversal cannot reverse another reversal");
  const date = businessDay(input.businessDate);
  const original = await prisma.journalEntry.findUnique({ where: sourceKey(input.sourceType, input.sourceId), include: { lines: true } });
  if (!original) throw new ApiError(404, "ENTRY_NOT_FOUND", "Ledger entry not found");
  await assertOriginalScope(actor, original);
  const priorReversal = await prisma.journalEntry.findUnique({ where: sourceKey("LEDGER_REVERSAL", original.id) });
  if (priorReversal) throw new ApiError(409, "REVERSAL_EXISTS", "This ledger entry has already been reversed");
  return prisma.$transaction(async (tx) => {
    const reversed = await reverseJournalEntryInTx(tx, { sourceType: input.sourceType, sourceId: input.sourceId, businessDate: date, reason: input.reason });
    if (!reversed) throw new ApiError(404, "ENTRY_NOT_FOUND", "Ledger entry not found");
    return reversed;
  });
}

async function entryInScope(entry: { sourceType: string; sourceId: string | null }, hubId: string | null): Promise<boolean> {
  if (!hubId || !entry.sourceId) return false;
  if (entry.sourceType === "BATCH_PICKUP_ADVANCE") {
    const batchId = entry.sourceId.split(":")[0]!;
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { hubId: true } });
    return batch?.hubId === hubId;
  }
  if (["PICKUP_ADVANCE", "DELIVERY_COLLECTION", "PARTIAL_RETURN_COLLECTION", "OS_PARTIAL_RETURN_ADJUSTMENT", "OS_SHORTFALL", "OS_RETURN_DEDUCTION", "RIDER_COMMISSION", "RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD"].includes(entry.sourceType)) {
    const parcelId = ["OS_RETURN_DEDUCTION", "RIDER_COMMISSION", "RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD"].includes(entry.sourceType)
      ? entry.sourceId.split(":")[0]!
      : entry.sourceId;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, include: { batch: { select: { hubId: true } } } });
    return parcel?.batch.hubId === hubId;
  }
  if (["LINKED_RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_FEE", "LINKED_DELIVERY_COLLECTION", "LINKED_RIDER_COMMISSION", "LINKED_OS_SHORTFALL"].includes(entry.sourceType)) {
    const groupId = entry.sourceId.split(":")[0]!;
    const group = await prisma.parcelLinkGroup.findUnique({ where: { id: groupId }, include: { parcels: { include: { batch: { select: { hubId: true } } } } } });
    return Boolean(group && group.parcels.every((parcel) => parcel.batch.hubId === hubId));
  }
  if (entry.sourceType === "RIDER_SETTLEMENT") {
    const settlement = await prisma.settlement.findUnique({ where: { id: entry.sourceId }, include: { rider: { select: { hubId: true } } } });
    return settlement?.rider.hubId === hubId;
  }
  if (entry.sourceType === "LEDGER_REVERSAL") {
    const original = await prisma.journalEntry.findUnique({ where: { id: entry.sourceId }, select: { sourceType: true, sourceId: true } });
    return original ? entryInScope(original, hubId) : false;
  }
  return false;
}

export async function getLedgerReport(input: { from?: string; to?: string; account?: string }, actor: LedgerActor) {
  const user = await assertLedgerReadAccess(actor);
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required");
  const from = input.from ? businessDay(input.from) : undefined;
  const to = input.to ? businessDay(input.to) : undefined;
  if (from && to && from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "Ledger start date must be before the end date");
  const entries = await prisma.journalEntry.findMany({
    where: { ...(user.role === "SUPERADMIN" ? {} : { hubId: user.hubId! }), ...(from || to ? { businessDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { lines: true },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const scopedEntries = entries;
  const filteredEntries = input.account ? scopedEntries.filter((entry) => entry.lines.some((line) => line.account === input.account)) : scopedEntries;
  const balances = new Map<string, { debit: number; credit: number }>();
  for (const entry of filteredEntries) for (const line of entry.lines) {
    if (input.account && line.account !== input.account) continue;
    const current = balances.get(line.account) ?? { debit: 0, credit: 0 };
    current.debit += line.debit;
    current.credit += line.credit;
    balances.set(line.account, current);
  }
  const accounts = [...balances.entries()].map(([account, values]) => ({ account, ...values, balance: values.debit - values.credit })).sort((a, b) => a.account.localeCompare(b.account));
  const totalDebit = accounts.reduce((sum, account) => sum + account.debit, 0);
  const totalCredit = accounts.reduce((sum, account) => sum + account.credit, 0);
  return { accounts, entries: filteredEntries, totalDebit, totalCredit, difference: totalDebit - totalCredit, balanced: totalDebit === totalCredit };
}
