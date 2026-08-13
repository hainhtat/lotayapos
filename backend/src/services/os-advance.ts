import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

async function journalEntryIsUnreversed(tx: DbClient, entryId: string) {
  const reversal = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: entryId } },
    select: { id: true },
  });
  return !reversal;
}

function assertAmount(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError(400, "INVALID_AMOUNT", `${field} must be a non-negative integer`);
  }
}

export function buildReturnDeductionLines(amount: number) {
  assertAmount(amount, "amount");
  if (amount <= 0) throw new ApiError(400, "INVALID_DEDUCTION", "Return deduction must be greater than zero");
  const lines = [
    { account: "OS_SETTLEMENT_OFFSET", debit: amount, credit: 0 },
    { account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: amount },
  ];
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (debit !== credit) throw new ApiError(400, "UNBALANCED_JOURNAL", "Journal debits must equal credits");
  return lines;
}

/** Settlement journal lines that clear staged OFFSET and/or legacy return deduction. */
export function buildOsSettlementReturnDeductionLines(returnDeduction: number, stagedOffsetClearance: number) {
  assertAmount(returnDeduction, "returnDeduction");
  assertAmount(stagedOffsetClearance, "stagedOffsetClearance");
  if (stagedOffsetClearance > returnDeduction) {
    throw new ApiError(400, "INVALID_SETTLEMENT_COMPONENT", "Staged offset clearance cannot exceed return deduction");
  }
  const lines: Array<{ account: string; debit: number; credit: number }> = [];
  const staged = stagedOffsetClearance;
  const unstaged = returnDeduction - staged;
  if (staged > 0) lines.push({ account: "OS_SETTLEMENT_OFFSET", debit: 0, credit: staged });
  if (unstaged > 0) lines.push({ account: "OS_RETURN_DEDUCTION", debit: 0, credit: unstaged });
  return lines;
}

/**
 * Remaining OS advance recoverable for a parcel after unreversed credits to OS_ADVANCE_RECEIVABLE.
 * recoverableAdvance = max(0, advanceAmount - priorCredits)
 */
export function recoverableAdvanceAmount(advanceAmount: number, priorCreditsToOsAdvanceReceivable: number) {
  if (!Number.isInteger(advanceAmount) || advanceAmount < 0) {
    throw new ApiError(400, "INVALID_ADVANCE", "Advance amount must be a non-negative integer");
  }
  if (!Number.isInteger(priorCreditsToOsAdvanceReceivable) || priorCreditsToOsAdvanceReceivable < 0) {
    throw new ApiError(400, "INVALID_AMOUNT", "Prior OS advance credits must be a non-negative integer");
  }
  return Math.max(0, advanceAmount - priorCreditsToOsAdvanceReceivable);
}

/** Settlement returned-advance cash component: staged OFFSET debits plus any open receivable remainder. */
export function settlementReturnedAdvanceContribution(
  parcel: { status: string; advanceAmount: number },
  priorCreditsToOsAdvanceReceivable: number,
  priorDebitsToOsSettlementOffset: number,
) {
  if (parcel.status === "PARTIAL") return Math.max(0, priorDebitsToOsSettlementOffset);
  if (!["RETURNED", "CANCELLED"].includes(parcel.status)) return 0;
  return (
    recoverableAdvanceAmount(parcel.advanceAmount, priorCreditsToOsAdvanceReceivable) +
    priorDebitsToOsSettlementOffset
  );
}

export function baseParcelIdFromSourceId(sourceId: string) {
  const separator = sourceId.indexOf(":");
  return separator === -1 ? sourceId : sourceId.slice(0, separator);
}

function parcelJournalWhere(parcelIds: string[]) {
  const versioned = parcelIds.map((id) => ({ sourceId: { startsWith: `${id}:` } }));
  return {
    OR: [
      { sourceId: { in: parcelIds } },
      { AND: [{ sourceType: "OS_RETURN_DEDUCTION" }, { OR: versioned }] },
      { AND: [{ sourceType: "RIDER_COMMISSION" }, { OR: versioned }] },
    ],
  };
}

function accumulateByParcelId(parcelIds: string[], sourceId: string, amount: number, map: Map<string, number>) {
  const parcelId = parcelIds.includes(sourceId) ? sourceId : baseParcelIdFromSourceId(sourceId);
  if (!parcelIds.includes(parcelId)) return;
  map.set(parcelId, (map.get(parcelId) ?? 0) + amount);
}

/** Deterministic pro-rata: stable id order, remainder on last positive-weight member. */
export function allocateProRata(total: number, weights: Array<{ id: string; weight: number }>) {
  const sorted = [...weights].sort((a, b) => a.id.localeCompare(b.id));
  const map = new Map<string, number>();
  for (const item of sorted) map.set(item.id, 0);
  const positive = sorted.filter((item) => item.weight > 0);
  const weightSum = positive.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || weightSum <= 0) return map;
  let allocated = 0;
  for (let index = 0; index < positive.length; index += 1) {
    const item = positive[index]!;
    if (index === positive.length - 1) {
      map.set(item.id, total - allocated);
      continue;
    }
    const share = Math.floor((total * item.weight) / weightSum);
    map.set(item.id, share);
    allocated += share;
  }
  return map;
}

async function applyLinkedShortfallCredits(
  db: DbClient,
  parcelIds: string[],
  creditsByParcel: Map<string, number>,
) {
  if (parcelIds.length === 0) return creditsByParcel;
  const linkedParcels = await db.parcel.findMany({
    where: { id: { in: parcelIds }, linkGroupId: { not: null } },
    select: { id: true, linkGroupId: true, advanceAmount: true },
  });
  const groupIds = [...new Set(linkedParcels.map((parcel) => parcel.linkGroupId!).filter(Boolean))];
  if (groupIds.length === 0) return creditsByParcel;

  const groupMembers = await db.parcel.findMany({
    where: { linkGroupId: { in: groupIds } },
    select: { id: true, linkGroupId: true, advanceAmount: true },
    orderBy: { id: "asc" },
  });

  for (const groupId of groupIds) {
    const entry = await db.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "LINKED_OS_SHORTFALL", sourceId: groupId } },
      select: {
        id: true,
        lines: { where: { account: "OS_ADVANCE_RECEIVABLE", credit: { gt: 0 } }, select: { credit: true } },
      },
    });
    if (!entry || entry.lines.length === 0) continue;
    if (!(await journalEntryIsUnreversed(db, entry.id))) continue;
    const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
    const members = groupMembers.filter((parcel) => parcel.linkGroupId === groupId);
    const requestedMembers = members.filter((parcel) => parcelIds.includes(parcel.id));
    if (requestedMembers.length === 0) continue;
    const shares = allocateProRata(
      totalCredit,
      members.map((parcel) => ({ id: parcel.id, weight: parcel.advanceAmount })),
    );
    for (const parcel of requestedMembers) {
      creditsByParcel.set(parcel.id, (creditsByParcel.get(parcel.id) ?? 0) + (shares.get(parcel.id) ?? 0));
    }
  }
  return creditsByParcel;
}

/** Sum unreversed journal credits to OS_ADVANCE_RECEIVABLE for parcel-scoped and allocated linked shortfall sources. */
export async function sumUnreversedCreditsToOsAdvanceReceivable(db: DbClient, parcelId: string) {
  const map = await sumUnreversedCreditsToOsAdvanceReceivableByParcel(db, [parcelId]);
  return map.get(parcelId) ?? 0;
}

/** Batch map of parcelId → unreversed OS_ADVANCE_RECEIVABLE credits (parcel-scoped + linked shortfall share). */
export async function sumUnreversedCreditsToOsAdvanceReceivableByParcel(db: DbClient, parcelIds: string[]) {
  const map = new Map<string, number>();
  if (parcelIds.length === 0) return map;
  const entries = await db.journalEntry.findMany({
    where: parcelJournalWhere(parcelIds),
    select: {
      id: true,
      sourceId: true,
      lines: { where: { account: "OS_ADVANCE_RECEIVABLE", credit: { gt: 0 } }, select: { credit: true } },
    },
  });
  for (const entry of entries) {
    if (!entry.sourceId || entry.lines.length === 0) continue;
    if (!(await journalEntryIsUnreversed(db, entry.id))) continue;
    accumulateByParcelId(parcelIds, entry.sourceId, entry.lines.reduce((sum, line) => sum + line.credit, 0), map);
  }
  return applyLinkedShortfallCredits(db, parcelIds, map);
}

/** Sum unreversed journal debits to OS_SETTLEMENT_OFFSET staged for future settlement (receive / partial offset). */
export async function sumUnreversedDebitsToOsSettlementOffset(db: DbClient, parcelId: string) {
  const map = await sumUnreversedDebitsToOsSettlementOffsetByParcel(db, [parcelId]);
  return map.get(parcelId) ?? 0;
}

/** Batch map of parcelId → unreversed OS_SETTLEMENT_OFFSET debits. */
export async function sumUnreversedDebitsToOsSettlementOffsetByParcel(db: DbClient, parcelIds: string[]) {
  const map = new Map<string, number>();
  if (parcelIds.length === 0) return map;
  const entries = await db.journalEntry.findMany({
    where: parcelJournalWhere(parcelIds),
    select: {
      id: true,
      sourceId: true,
      lines: { where: { account: "OS_SETTLEMENT_OFFSET", debit: { gt: 0 } }, select: { debit: true } },
    },
  });
  for (const entry of entries) {
    if (!entry.sourceId || entry.lines.length === 0) continue;
    if (!(await journalEntryIsUnreversed(db, entry.id))) continue;
    accumulateByParcelId(parcelIds, entry.sourceId, entry.lines.reduce((sum, line) => sum + line.debit, 0), map);
  }
  return map;
}

export async function recoverableAdvance(
  db: DbClient,
  parcel: { id: string; advanceAmount: number },
) {
  const priorCredits = await sumUnreversedCreditsToOsAdvanceReceivable(db, parcel.id);
  return recoverableAdvanceAmount(parcel.advanceAmount, priorCredits);
}

async function findActiveReturnDeduction(tx: Prisma.TransactionClient, parcelId: string) {
  const entries = await tx.journalEntry.findMany({
    where: {
      sourceType: "OS_RETURN_DEDUCTION",
      OR: [{ sourceId: parcelId }, { sourceId: { startsWith: `${parcelId}:` } }],
    },
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
  for (const entry of entries) {
    if (await journalEntryIsUnreversed(tx, entry.id)) return entry;
  }
  return null;
}

function creditedAdvanceReceivable(entry: { lines: Array<{ account: string; credit: number }> }) {
  return entry.lines
    .filter((line) => line.account === "OS_ADVANCE_RECEIVABLE")
    .reduce((sum, line) => sum + line.credit, 0);
}

/** Allocate a free OS_RETURN_DEDUCTION sourceId so reversal can post again. */
export async function nextOsReturnDeductionSourceId(tx: Prisma.TransactionClient, parcelId: string) {
  const base = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: "OS_RETURN_DEDUCTION", sourceId: parcelId } },
    select: { id: true },
  });
  if (!base) return parcelId;
  if (await journalEntryIsUnreversed(tx, base.id)) return null;
  return `${parcelId}:${randomUUID()}`;
}

export async function getActiveReturnDeduction(tx: Prisma.TransactionClient, parcelId: string) {
  return findActiveReturnDeduction(tx, parcelId);
}

/** Post OS_RETURN_DEDUCTION inside an open transaction; returns existing entry when already posted. */
export async function postReturnDeductionInTx(
  tx: Prisma.TransactionClient,
  input: {
    parcel: { id: string; trackingNumber: string; advanceAmount: number };
    hubId: string;
    businessDate: Date;
    amount: number;
  },
) {
  if (input.amount <= 0) throw new ApiError(400, "INVALID_DEDUCTION", "Return deduction must be greater than zero");
  const active = await findActiveReturnDeduction(tx, input.parcel.id);
  if (active) {
    const credited = creditedAdvanceReceivable(active);
    if (credited < input.amount) {
      throw new ApiError(
        409,
        "DEDUCTION_INCOMPLETE",
        "An existing return deduction covers less than the recoverable advance remainder",
      );
    }
    if (credited > input.amount) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "A return deduction already exists for this parcel with a different amount");
    }
    return active;
  }
  const sourceId = await nextOsReturnDeductionSourceId(tx, input.parcel.id);
  if (!sourceId) {
    throw new ApiError(
      409,
      "DEDUCTION_INCOMPLETE",
      "An existing return deduction covers less than the recoverable advance remainder",
    );
  }
  const lines = buildReturnDeductionLines(input.amount);
  return tx.journalEntry.create({
    data: {
      sourceType: "OS_RETURN_DEDUCTION",
      sourceId,
      hubId: input.hubId,
      businessDate: input.businessDate,
      description: `Return deduction for ${input.parcel.trackingNumber}`,
      lines: { create: lines },
    },
    include: { lines: true },
  });
}
