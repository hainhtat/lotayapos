import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { assertCashbookOpen } from "./finance.service.js";

type Actor = { id: string; role: string };
type Db = Prisma.TransactionClient | typeof prisma;
type WalletSplit = { cash: number; kbzPay: number; wavePay: number };
type PaymentInput = { shopId: string; hubId?: string; batchIds: string[]; businessDate: string; wallets: WalletSplit; note: string; reference?: string; idempotencyKey: string; replacesId?: string };
const walletAccounts = { cash: "WALLET_CASH", kbzPay: "WALLET_KBZ_PAY", wavePay: "WALLET_WAVE_PAY" } as const;

export function attributableLegacyBatchPayment(link: { collectedCod: number; advanceAmount: number; returnedAdvance: number; deliveryFees: number }) {
  return Math.max(0, link.collectedCod - link.advanceAmount - link.returnedAdvance - link.deliveryFees);
}

export function requiredOpeningAdjustment(legacyNetAmount: number, attributableAmount: number) {
  return attributableAmount - legacyNetAmount;
}

export function buildCutoverAdjustmentLines(adjustment: number) {
  if (!Number.isInteger(adjustment) || adjustment === 0) throw new ApiError(400, "INVALID_ADJUSTMENT", "Opening adjustment must be a non-zero integer");
  const amount = Math.abs(adjustment);
  return adjustment > 0
    ? [{ account: "OS_BATCH_COD_CLEARING", debit: amount, credit: 0 }, { account: "OS_COD_PAYABLE", debit: 0, credit: amount }]
    : [{ account: "OS_COD_PAYABLE", debit: amount, credit: 0 }, { account: "OS_BATCH_COD_CLEARING", debit: 0, credit: amount }];
}

function businessDay(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  return date;
}

async function accountActor(actor: Actor, mutate = false) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, hubId: true } });
  const allowed = mutate ? ["SUPERADMIN", "FINANCE"] : ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"];
  if (!user?.active || user.role !== actor.role || !allowed.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not access OS accounts");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required");
  return user;
}

async function scopedHub(actor: Actor, requestedHubId: string | undefined, mutate = false) {
  const user = await accountActor(actor, mutate);
  if (user.role === "SUPERADMIN") {
    if (!requestedHubId) throw new ApiError(400, "HUB_REQUIRED", "Superadmin must select a hub");
    const hub = await prisma.hub.findUnique({ where: { id: requestedHubId }, select: { id: true } });
    if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");
    return requestedHubId;
  }
  if (requestedHubId && requestedHubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  return user.hubId!;
}

export async function syncBatchObligation(tx: Prisma.TransactionClient, batchId: string) {
  const batch = await tx.batch.findUnique({ where: { id: batchId }, select: { id: true, shopId: true, hubId: true, pickupDate: true, finalizedAt: true, parcels: { select: { codAmount: true } }, osObligation: true } });
  if (!batch?.hubId) throw new ApiError(409, "BATCH_HUB_REQUIRED", "Batch must belong to a hub");
  if (!batch.finalizedAt) throw new ApiError(409, "BATCH_NOT_FINALIZED", "Finalize the batch before creating its OS obligation");
  const originalCod = batch.parcels.reduce((sum, parcel) => sum + parcel.codAmount, 0);
  if (batch.osObligation) return batch.osObligation;
  const obligation = await tx.osBatchObligation.create({ data: { batchId, shopId: batch.shopId, hubId: batch.hubId, originalCod, migrated: false } });
  if (originalCod > 0) await tx.journalEntry.create({ data: { sourceType: "OS_BATCH_OBLIGATION", sourceId: batchId, hubId: batch.hubId, businessDate: batch.pickupDate, description: `OS batch COD obligation ${batchId}`, lines: { create: [{ account: "OS_BATCH_COD_CLEARING", debit: originalCod, credit: 0 }, { account: "OS_COD_PAYABLE", debit: 0, credit: originalCod }] } } });
  return obligation;
}

export async function postedAdvanceByBatch(db: Db, batchIds: string[]) {
  const result = new Map<string, number>();
  if (!batchIds.length) return result;
  const entries = await db.journalEntry.findMany({
    where: { sourceType: "BATCH_PICKUP_ADVANCE", OR: batchIds.flatMap((id) => [{ sourceId: id }, { sourceId: { startsWith: `${id}:` } }]) },
    include: { lines: true },
  });
  const reversals = await db.journalEntry.findMany({ where: { sourceType: "LEDGER_REVERSAL", sourceId: { in: entries.map((entry) => entry.id) } }, select: { sourceId: true } });
  const reversed = new Set(reversals.map((entry) => entry.sourceId));
  for (const entry of entries) {
    if (reversed.has(entry.id)) continue;
    const batchId = batchIds.find((id) => entry.sourceId === id || entry.sourceId?.startsWith(`${id}:`));
    if (!batchId) continue;
    const amount = entry.lines.filter((line) => line.account === "OS_COD_PAYABLE").reduce((sum, line) => sum + line.debit - line.credit, 0);
    result.set(batchId, (result.get(batchId) ?? 0) + amount);
  }
  return result;
}

async function accountRows(db: Db, input: { shopId?: string; hubId: string }) {
  const obligations = await db.osBatchObligation.findMany({
    where: { ...(input.shopId ? { shopId: input.shopId } : {}), hubId: input.hubId },
    include: { batch: { include: { shop: true } } },
    orderBy: [{ batch: { pickupDate: "asc" } }, { batchId: "asc" }],
  });
  const batchIds = obligations.map((row) => row.batchId);
  const [allocations, returnCredits, advances, consumedCredits, legacySettlements] = await Promise.all([
    db.osPaymentAllocation.findMany({ where: { batchId: { in: batchIds }, payment: { status: "POSTED" } }, select: { batchId: true, amount: true } }),
    db.osReturnCredit.findMany({ where: { batchId: { in: batchIds }, status: "POSTED" }, select: { id: true, batchId: true, amount: true } }),
    postedAdvanceByBatch(db, batchIds),
    db.osCreditAllocation.findMany({ where: { credit: { ...(input.shopId ? { shopId: input.shopId } : {}), hubId: input.hubId }, payment: { status: "POSTED" } }, select: { creditId: true, amount: true } }),
    db.osSettlement.findMany({ where: { hubId: input.hubId, status: "POSTED", reversedAt: null, batches: { some: { batchId: { in: batchIds } } } }, include: { batches: true }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }] }),
  ]);
  const paid = new Map<string, number>();
  for (const allocation of allocations) paid.set(allocation.batchId, (paid.get(allocation.batchId) ?? 0) + allocation.amount);
  const consumedByCredit = new Map<string, number>();
  for (const allocation of consumedCredits) consumedByCredit.set(allocation.creditId, (consumedByCredit.get(allocation.creditId) ?? 0) + allocation.amount);
  const requiredAdjustmentByShop = new Map<string, number>();
  // Legacy batch links carry the auditable per-batch components. Import only
  // that attributable amount; settlement-level adjustments require explicit
  // Superadmin opening-adjustment evidence instead of arbitrary allocation.
  for (const settlement of legacySettlements) {
    let attributableTotal = 0;
    for (const link of settlement.batches) {
      const obligation = obligations.find((row) => row.batchId === link.batchId && row.migrated);
      if (!obligation) continue;
      const applied = attributableLegacyBatchPayment(link);
      paid.set(obligation.batchId, (paid.get(obligation.batchId) ?? 0) + applied);
      attributableTotal += applied;
    }
    requiredAdjustmentByShop.set(settlement.shopId, (requiredAdjustmentByShop.get(settlement.shopId) ?? 0) + requiredOpeningAdjustment(settlement.netAmount, attributableTotal));
  }
  for (const [shopId, required] of requiredAdjustmentByShop) {
    const actual = obligations.filter((row) => row.shopId === shopId && row.migrated).reduce((sum, row) => sum + row.openingAdjustment, 0);
    if (actual !== required) throw new ApiError(409, "OS_CUTOVER_RECONCILIATION_REQUIRED", "Legacy and simplified OS opening balances differ; Superadmin approval is required", { shopId, hubId: input.hubId, requiredOpeningAdjustment: required, currentOpeningAdjustment: actual });
  }
  return obligations.map((row) => {
    const credits = returnCredits.filter((credit) => credit.batchId === row.batchId);
    const returnedCod = credits.reduce((sum, credit) => sum + credit.amount, 0);
    const consumedCredit = credits.reduce((sum, credit) => sum + (consumedByCredit.get(credit.id) ?? 0), 0);
    const advancePaid = advances.get(row.batchId) ?? 0;
    const paidAmount = paid.get(row.batchId) ?? 0;
    const adjustedOriginalCod = row.originalCod + row.openingAdjustment;
    const raw = adjustedOriginalCod - advancePaid - returnedCod - paidAmount;
    return { batchId: row.batchId, label: row.batch.label, pickupDate: row.batch.pickupDate, shop: { id: row.batch.shop.id, name: row.batch.shop.name }, hubId: row.hubId, originalCod: row.originalCod, openingAdjustment: row.openingAdjustment, adjustedOriginalCod, advancePaid, paymentPaid: paidAmount, returnedCod, creditAvailable: Math.max(0, -raw - consumedCredit), outstanding: Math.max(0, raw), migrated: row.migrated };
  });
}

export async function listOsAccounts(input: { shopId?: string; hubId?: string }, actor: Actor) {
  const hubId = await scopedHub(actor, input.hubId);
  const batches = await accountRows(prisma, { shopId: input.shopId, hubId });
  const keys = new Map(batches.map((row) => [`${row.shop.id}:${row.hubId}`, { shop: row.shop, hubId: row.hubId }]));
  const shops = [...keys.values()].map(({ shop, hubId: rowHubId }) => {
    const rows = batches.filter((row) => row.shop.id === shop.id && row.hubId === rowHubId);
    return { shop, hubId: rowHubId, originalCod: rows.reduce((s, r) => s + r.originalCod, 0), advancesPaid: rows.reduce((s, r) => s + r.advancePaid, 0), paymentsPaid: rows.reduce((s, r) => s + r.paymentPaid, 0), returnedCod: rows.reduce((s, r) => s + r.returnedCod, 0), outstanding: rows.reduce((s, r) => s + r.outstanding, 0), creditAvailable: rows.reduce((s, r) => s + r.creditAvailable, 0), batches: rows };
  });
  return { shops };
}

export async function approveCutoverAdjustment(input: { shopId: string; hubId: string; adjustment: number; businessDate: string; reason: string; idempotencyKey: string }, actor: Actor) {
  const user = await accountActor(actor, true);
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "FORBIDDEN", "Only Superadmin may approve an OS opening adjustment");
  const hubId = await scopedHub(actor, input.hubId, true);
  if (!Number.isInteger(input.adjustment) || input.adjustment === 0) throw new ApiError(400, "INVALID_ADJUSTMENT", "Opening adjustment must be a non-zero integer");
  return prisma.$transaction(async (tx) => {
    const replay = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "OS_CUTOVER_OPENING_ADJUSTMENT", sourceId: input.idempotencyKey } } });
    if (replay) return { replay: true, journalEntryId: replay.id };
    const obligation = await tx.osBatchObligation.findFirst({ where: { shopId: input.shopId, hubId, migrated: true }, orderBy: [{ batch: { pickupDate: "asc" } }, { batchId: "asc" }] });
    if (!obligation) throw new ApiError(404, "MIGRATED_OS_ACCOUNT_NOT_FOUND", "Migrated OS account was not found");
    let required = 0;
    try { await accountRows(tx, { shopId: input.shopId, hubId }); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== "OS_CUTOVER_RECONCILIATION_REQUIRED") throw error;
      required = Number((error.details as { requiredOpeningAdjustment?: number; currentOpeningAdjustment?: number } | undefined)?.requiredOpeningAdjustment ?? 0) - Number((error.details as { currentOpeningAdjustment?: number } | undefined)?.currentOpeningAdjustment ?? 0);
    }
    if (required === 0) throw new ApiError(409, "OS_CUTOVER_ALREADY_RECONCILED", "OS account opening balance is already reconciled");
    if (input.adjustment !== required) throw new ApiError(409, "ADJUSTMENT_MISMATCH", "Opening adjustment must exactly match the reconciliation difference", { requiredOpeningAdjustment: required });
    const date = businessDay(input.businessDate); await assertCashbookOpen(tx, date, hubId);
    const updated = await tx.osBatchObligation.update({ where: { id: obligation.id }, data: { openingAdjustment: { increment: input.adjustment }, adjustmentReason: input.reason.trim(), adjustmentApprovedBy: actor.id, adjustmentApprovedAt: new Date() } });
    const journal = await tx.journalEntry.create({ data: { sourceType: "OS_CUTOVER_OPENING_ADJUSTMENT", sourceId: input.idempotencyKey, hubId, businessDate: date, description: `Approved OS opening adjustment for ${input.shopId}: ${input.reason.trim()}`, lines: { create: buildCutoverAdjustmentLines(input.adjustment) } } });
    return { replay: false, shopId: input.shopId, hubId, requiredOpeningAdjustment: input.adjustment, obligation: updated, journalEntryId: journal.id };
  }, { isolationLevel: "Serializable" });
}

function splitTotal(wallets: WalletSplit) { return wallets.cash + wallets.kbzPay + wallets.wavePay; }
function paymentHash(input: PaymentInput, hubId: string) {
  return createHash("sha256").update(JSON.stringify({ shopId: input.shopId, hubId, batchIds: [...input.batchIds].sort(), businessDate: input.businessDate.slice(0, 10), wallets: input.wallets, note: input.note.trim(), reference: input.reference?.trim() || null, replacesId: input.replacesId ?? null })).digest("hex");
}

async function createPayment(tx: Prisma.TransactionClient, input: PaymentInput, actor: Actor, hubId: string) {
  const hash = paymentHash(input, hubId);
  const existing = await tx.osAccountPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { wallets: true, allocations: true, creditAllocations: true } });
  if (existing) {
    if (existing.requestHash !== hash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different OS payment");
    return existing;
  }
  const amount = splitTotal(input.wallets);
  if (!Object.values(input.wallets).every((value) => Number.isInteger(value) && value >= 0)) throw new ApiError(400, "INVALID_PAYMENT", "Wallet amounts must be non-negative integers");
  const batchIds = [...new Set(input.batchIds)];
  if (!batchIds.length || batchIds.length !== input.batchIds.length) throw new ApiError(400, "INVALID_BATCHES", "Select unique batches");
  const rows = (await accountRows(tx, { shopId: input.shopId, hubId })).filter((row) => batchIds.includes(row.batchId)).sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime());
  if (rows.length !== batchIds.length || rows.some((row) => row.shop.id !== input.shopId || row.hubId !== hubId)) throw new ApiError(403, "PAYMENT_SCOPE_MISMATCH", "Every batch must belong to the selected OS and hub");
  const payable = rows.reduce((sum, row) => sum + row.outstanding, 0);
  const allRows = await accountRows(tx, { shopId: input.shopId, hubId });
  const creditAvailable = allRows.reduce((sum, row) => sum + row.creditAvailable, 0);
  const creditApplied = Math.min(creditAvailable, payable);
  if (amount <= 0 && creditApplied <= 0) throw new ApiError(400, "INVALID_PAYMENT", "Enter a wallet payment or apply available OS credit");
  if (amount > Math.max(0, payable - creditApplied)) throw new ApiError(409, "PAYMENT_EXCEEDS_PAYABLE", "Wallet payment exceeds the selected outstanding amount after OS credit");
  const date = businessDay(input.businessDate);
  await assertCashbookOpen(tx, date, hubId);
  let remaining = amount + creditApplied;
  const allocations: Array<{ batchId: string; amount: number }> = [];
  for (const row of rows) { const allocated = Math.min(row.outstanding, remaining); if (allocated > 0) allocations.push({ batchId: row.batchId, amount: allocated }); remaining -= allocated; }
  const creditRows = await tx.osReturnCredit.findMany({ where: { shopId: input.shopId, hubId, status: "POSTED" }, include: { allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: [{ businessDate: "asc" }, { id: "asc" }] });
  const eligibleByBatch = new Map(allRows.map((row) => [row.batchId, row.creditAvailable]));
  const consumedEligibleByBatch = new Map<string, number>();
  let creditRemaining = creditApplied;
  const creditAllocations: Array<{ creditId: string; amount: number }> = [];
  for (const credit of creditRows) {
    const batchAllowance = Math.max(0, (eligibleByBatch.get(credit.batchId) ?? 0) - (consumedEligibleByBatch.get(credit.batchId) ?? 0));
    const available = Math.min(batchAllowance, Math.max(0, credit.amount - credit.allocations.reduce((sum, row) => sum + row.amount, 0)));
    const used = Math.min(available, creditRemaining);
    if (used > 0) { creditAllocations.push({ creditId: credit.id, amount: used }); consumedEligibleByBatch.set(credit.batchId, (consumedEligibleByBatch.get(credit.batchId) ?? 0) + used); }
    creditRemaining -= used; if (!creditRemaining) break;
  }
  if (creditRemaining !== 0) throw new ApiError(409, "OS_CREDIT_CONFLICT", "Available OS credit changed; refresh and retry");
  const paymentId = randomUUID();
  const walletLines = Object.entries(input.wallets).filter(([, value]) => value > 0).map(([wallet, value]) => ({ account: walletAccounts[wallet as keyof WalletSplit], debit: 0, credit: value }));
  const journalLines = amount > 0
    ? [{ account: "OS_COD_PAYABLE", debit: amount, credit: 0 }, ...walletLines]
    : [{ account: "OS_CREDIT_ALLOCATION_MEMO", debit: creditApplied, credit: 0 }, { account: "OS_CREDIT_ALLOCATION_MEMO", debit: 0, credit: creditApplied }];
  const journal = await tx.journalEntry.create({ data: { sourceType: amount > 0 ? "OS_ACCOUNT_PAYMENT" : "OS_ACCOUNT_CREDIT_APPLICATION", sourceId: paymentId, hubId, businessDate: date, description: `OS payment: ${input.note.trim()}`, lines: { create: journalLines } } });
  return tx.osAccountPayment.create({ data: { id: paymentId, shopId: input.shopId, hubId, businessDate: date, note: input.note.trim(), reference: input.reference?.trim() || null, idempotencyKey: input.idempotencyKey, requestHash: hash, postedBy: actor.id, journalEntryId: journal.id, creditApplied, replacesId: input.replacesId, wallets: { create: Object.entries(input.wallets).filter(([, value]) => value > 0).map(([wallet, value]) => ({ wallet, amount: value })) }, allocations: { create: allocations }, creditAllocations: { create: creditAllocations } }, include: { wallets: true, allocations: true, creditAllocations: true } });
}

export async function postOsPayment(input: PaymentInput, actor: Actor) {
  const hubId = await scopedHub(actor, input.hubId, true);
  return prisma.$transaction((tx) => createPayment(tx, input, actor, hubId), { isolationLevel: "Serializable" });
}

async function voidPayment(tx: Prisma.TransactionClient, input: { id: string; businessDate: string; reason: string; idempotencyKey: string }, actor: Actor, hubId: string) {
  const payment = await tx.osAccountPayment.findFirst({ where: { id: input.id, hubId }, include: { wallets: true, allocations: true, creditAllocations: true } });
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "OS payment not found");
  if (payment.status === "VOIDED") {
    if (payment.voidIdempotencyKey !== input.idempotencyKey) throw new ApiError(409, "PAYMENT_ALREADY_VOIDED", "OS payment was already voided by another request");
    const priorVoid = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "OS_ACCOUNT_PAYMENT_VOID", sourceId: input.idempotencyKey } }, select: { businessDate: true, description: true } });
    if (!priorVoid || priorVoid.businessDate.getTime() !== businessDay(input.businessDate).getTime() || priorVoid.description !== `Void OS payment: ${input.reason.trim()}`) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different OS payment void");
    return payment;
  }
  const date = businessDay(input.businessDate); await assertCashbookOpen(tx, date, payment.hubId);
  const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: payment.journalEntryId }, include: { lines: true } });
  await tx.journalEntry.create({ data: { sourceType: "OS_ACCOUNT_PAYMENT_VOID", sourceId: input.idempotencyKey, hubId: payment.hubId, businessDate: date, description: `Void OS payment: ${input.reason.trim()}`, lines: original.lines.length ? { create: original.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit })) } : undefined } });
  return tx.osAccountPayment.update({ where: { id: payment.id }, data: { status: "VOIDED", voidedAt: new Date(), voidedBy: actor.id, voidReason: input.reason.trim(), voidIdempotencyKey: input.idempotencyKey }, include: { wallets: true, allocations: true, creditAllocations: true } });
}

export async function voidOsPayment(input: { id: string; hubId?: string; businessDate: string; reason: string; idempotencyKey: string }, actor: Actor) {
  const hubId = await scopedHub(actor, input.hubId, true);
  return prisma.$transaction((tx) => voidPayment(tx, input, actor, hubId), { isolationLevel: "Serializable" });
}

export async function replaceOsPayment(input: { id: string; hubId?: string; businessDate: string; reason: string; idempotencyKey: string; replacement: Omit<PaymentInput, "replacesId"> }, actor: Actor) {
  const hubId = await scopedHub(actor, input.hubId ?? input.replacement.hubId, true);
  return prisma.$transaction(async (tx) => {
    const original = await tx.osAccountPayment.findFirst({ where: { id: input.id, hubId } });
    if (!original) throw new ApiError(404, "PAYMENT_NOT_FOUND", "OS payment not found");
    const priorReplacement = await tx.osAccountPayment.findFirst({ where: { replacesId: original.id, idempotencyKey: input.replacement.idempotencyKey }, include: { wallets: true, allocations: true, creditAllocations: true } });
    if (priorReplacement) return priorReplacement;
    await voidPayment(tx, input, actor, hubId);
    const replacement = await createPayment(tx, { ...input.replacement, hubId, replacesId: input.id }, actor, hubId);
    await tx.osAccountPayment.update({ where: { id: input.id }, data: { replacedById: replacement.id } });
    return replacement;
  }, { isolationLevel: "Serializable" });
}

export async function osAccountHistory(shopId: string, input: { hubId?: string }, actor: Actor) {
  const hubId = await scopedHub(actor, input.hubId);
  const [account, payments, returns, legacySettlements] = await Promise.all([
    listOsAccounts({ shopId, hubId }, actor),
    prisma.osAccountPayment.findMany({ where: { shopId, hubId }, include: { wallets: true, allocations: true, creditAllocations: true }, orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }] }),
    prisma.osReturnCredit.findMany({ where: { shopId, hubId }, include: { allocations: { where: { payment: { status: "POSTED" } } } }, orderBy: { businessDate: "desc" } }),
    prisma.osSettlement.findMany({ where: { shopId, hubId }, include: { batches: true }, orderBy: { businessDate: "desc" } }),
  ]);
  return { account: account.shops[0] ?? null, payments, returns, legacySettlements };
}
