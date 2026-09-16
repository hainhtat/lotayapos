import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { accountRows } from "./os-account.service.js";
import { assertCashbookOpen } from "./finance.service.js";

type Actor = { id: string; role: string };
type Db = Prisma.TransactionClient;
type ApplyInput = { fingerprint: string; batchIds: string[]; retainedBatchIds: string[]; businessDate: string; reason: string; idempotencyKey: string };
type ApplyResult = { adjustmentId: string; batchIds: string[]; retainedBatchIds: string[]; totalAdjustment: number; walletChange: number; businessDate: string; replay: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function assertSuperadmin(db: Db, actor: Actor) {
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true } });
  if (actor.role !== "SUPERADMIN" || !user?.active || user.role !== "SUPERADMIN") throw new ApiError(403, "FORBIDDEN", "Only Superadmin may reconcile historical OS balances");
}

async function preview(db: Db) {
  const all = await db.batch.findMany({
    include: { historicalOsSettlement: true, osObligation: true, shop: { select: { name: true } } },
    orderBy: [{ pickupDate: "desc" }, { id: "desc" }],
  });
  const retainedBatches = all.slice(0, 3).map(batch => ({ id: batch.id, label: batch.label, pickupDate: batch.pickupDate, shopId: batch.shopId, shopName: batch.shop.name }));
  const older = all.slice(3);
  const rows = new Map<string, Awaited<ReturnType<typeof accountRows>>[number]>();
  const hubErrors = new Map<string, string>();
  for (const hubId of [...new Set(older.flatMap(batch => batch.hubId ? [batch.hubId] : []))]) {
    try { for (const row of await accountRows(db, { hubId }, older.map(batch => batch.id))) rows.set(row.batchId, row); }
    catch (error) {
      if (!(error instanceof ApiError)) throw error;
      hubErrors.set(hubId, error.message);
    }
  }
  const batches = older.map(batch => {
    const row = rows.get(batch.id);
    const blocker = !batch.hubId ? "Batch has no hub; assign its hub before historical reconciliation"
      : hubErrors.get(batch.hubId) ?? (!row ? "Batch has no OS obligation; reconcile or finalize this batch before historical settlement" : undefined);
    return {
      id: batch.id, label: batch.label, pickupDate: batch.pickupDate, shopId: batch.shopId, shopName: batch.shop.name, hubId: batch.hubId,
      outstanding: row?.outstanding ?? null, adjustmentAmount: batch.historicalOsSettlement ? 0 : row?.outstanding ?? 0,
      alreadyAdjusted: Boolean(batch.historicalOsSettlement), creditAvailable: row?.creditAvailable ?? null,
      createsOpeningObligation: !batch.osObligation,
      ...(blocker ? { blocker } : {}),
    };
  });
  const blockers = batches.flatMap(batch => batch.blocker ? [{ batchId: batch.id, message: batch.blocker }] : []);
  const totalAdjustment = batches.reduce((sum, batch) => sum + batch.adjustmentAmount, 0);
  if (!Number.isSafeInteger(totalAdjustment) || batches.some(batch => !Number.isSafeInteger(batch.adjustmentAmount) || batch.adjustmentAmount > 2_147_483_647)) throw new ApiError(422, "BALANCE_OUT_OF_RANGE", "Historical adjustment exceeds the supported amount range");
  // Include full account components, not only net due: any intervening settlement invalidates this preview.
  const fingerprint = hash({ retainedBatches, batches, rows: [...rows.values()], batchState: all.map(batch => ({ id: batch.id, advancePaid: batch.advancePaid, finalizedAt: batch.finalizedAt, obligation: batch.osObligation })) });
  return { fingerprint, retainedBatches, batches, totalAdjustment, canApply: blockers.length === 0 && batches.some(batch => !batch.alreadyAdjusted), blockers };
}

export async function previewHistoricalOsSettlement(actor: Actor, database = prisma) {
  return database.$transaction(async tx => { await assertSuperadmin(tx, actor); return preview(tx); }, { isolationLevel: "Serializable" });
}

export async function applyHistoricalOsSettlement(input: ApplyInput, actor: Actor, database = prisma) {
  const requestHash = hash({ ...input, batchIds: [...input.batchIds].sort(), retainedBatchIds: [...input.retainedBatchIds].sort(), reason: input.reason.trim() });
  try {
    return await database.$transaction(async tx => {
      await assertSuperadmin(tx, actor);
      const existing = await tx.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.targetType !== "OS_HISTORICAL_SETTLEMENT" || existing.beforeJson !== requestHash || existing.actorId !== actor.id) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This reference was already used for another historical adjustment");
        return { ...JSON.parse(existing.afterJson) as ApplyResult, replay: true };
      }
      const current = await preview(tx);
      const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
      if (current.fingerprint !== input.fingerprint || !sameIds(input.batchIds, current.batches.map(batch => batch.id)) || !sameIds(input.retainedBatchIds, current.retainedBatches.map(batch => batch.id))) throw new ApiError(409, "HISTORICAL_PREVIEW_CHANGED", "Batch balances or selection changed; review a fresh preview");
      if (!current.canApply) throw new ApiError(409, "HISTORICAL_RECONCILIATION_BLOCKED", "Resolve the listed batch issues before applying", current.blockers);
      const businessDate = new Date(`${input.businessDate}T00:00:00Z`);
      const adjustmentId = randomUUID();
      const targets = current.batches.filter(batch => !batch.alreadyAdjusted);
      for (const hubId of [...new Set(targets.map(batch => batch.hubId!))]) await assertCashbookOpen(tx, businessDate, hubId);
      for (const batch of targets) {
        if (batch.createsOpeningObligation) {
          const source = await tx.batch.findUniqueOrThrow({ where: { id: batch.id }, include: { parcels: true } });
          const cod = source.parcels.reduce((sum, parcel) => sum + parcel.codAmount, 0);
          await tx.osBatchObligation.create({ data: { batchId: source.id, shopId: source.shopId, hubId: source.hubId!, originalCod: cod, migrated: true } });
          if (cod > 0) await tx.journalEntry.create({ data: {
            sourceType: "OS_HISTORICAL_OPENING", sourceId: source.id, hubId: source.hubId!, businessDate,
            description: `Historical OS opening: ${input.reason.trim()}`,
            lines: { create: [{ account: "OS_BATCH_COD_CLEARING", debit: cod, credit: 0 }, { account: "OS_COD_PAYABLE", debit: 0, credit: cod }] },
          } });
          for (const parcel of source.parcels.filter(parcel => parcel.status === "RETURNED")) {
            const existingCredit = await tx.osReturnCredit.findUnique({ where: { parcelId: parcel.id } });
            if (existingCredit) continue;
            const returnJournal = parcel.codAmount > 0 ? await tx.journalEntry.create({ data: {
              sourceType: "OS_HISTORICAL_RETURN", sourceId: parcel.id, hubId: source.hubId!, businessDate,
              description: `Historical confirmed return: ${input.reason.trim()}`,
              lines: { create: [{ account: "OS_COD_PAYABLE", debit: parcel.codAmount, credit: 0 }, { account: "OS_BATCH_COD_CLEARING", debit: 0, credit: parcel.codAmount }] },
            } }) : null;
            await tx.osReturnCredit.create({ data: { parcelId: parcel.id, batchId: source.id, shopId: source.shopId, hubId: source.hubId!, amount: parcel.codAmount, businessDate, idempotencyKey: `historical-return:${parcel.id}`, postedBy: actor.id, journalEntryId: returnJournal?.id } });
          }
        }
        const journal = batch.adjustmentAmount > 0 ? await tx.journalEntry.create({ data: {
          sourceType: "OS_HISTORICAL_SETTLEMENT", sourceId: batch.id, hubId: batch.hubId!, businessDate,
          description: `Historical OS settlement: ${input.reason.trim()}`,
          lines: { create: [
            { account: "OS_COD_PAYABLE", debit: batch.adjustmentAmount, credit: 0 },
            { account: "OS_HISTORICAL_SETTLEMENT_CLEARING", debit: 0, credit: batch.adjustmentAmount },
          ] },
        } }) : null;
        await tx.osHistoricalSettlement.create({ data: { batchId: batch.id, amount: batch.adjustmentAmount, businessDate, actorId: actor.id, reason: input.reason.trim(), adjustmentId, journalEntryId: journal?.id } });
      }
      const result = { adjustmentId, batchIds: targets.map(batch => batch.id), retainedBatchIds: current.retainedBatches.map(batch => batch.id), totalAdjustment: current.totalAdjustment, walletChange: 0, businessDate: input.businessDate, replay: false };
      await tx.osSettlementEditAudit.create({ data: { id: adjustmentId, targetType: "OS_HISTORICAL_SETTLEMENT", targetId: adjustmentId, action: "RECONCILE", actorId: actor.id, reason: input.reason.trim(), beforeJson: requestHash, afterJson: JSON.stringify({ ...result, preview: current }), idempotencyKey: input.idempotencyKey } });
      return result;
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && ["P2034", "P2002"].includes(String(error.code))) throw new ApiError(409, "HISTORICAL_ADJUSTMENT_CONFLICT", "Another operation changed these batches; retry with the same reference or refresh the preview");
    throw error;
  }
}
