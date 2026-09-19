import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import { randomUUID } from "node:crypto";
import { buildOsSettlementReturnDeductionLines, settlementReturnedAdvanceContribution, sumUnreversedCreditsToOsAdvanceReceivableByParcel, sumUnreversedDebitsToOsSettlementOffsetByParcel } from "../os-advance.js";
import { assertFinanceActor, assertFinanceReadActor, resolveFinanceHub, resolveFinanceListHub, type FinanceActor } from "../finance-authorization.js";
import { assertCashbookOpen } from "./cashbook-policy.js";
import { walletAccount, type CashbookWallet } from "./cashbook-rules.js";
import { replayMatchesComponents, validateEditableSettlementComponents, type EditableOsSettlementComponents } from "./os-settlement-components.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
export async function listOsSettlementDrafts(
  input: { shopId?: string },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  const batches = await prisma.batch.findMany({
    where: {
      ...(input.shopId ? { shopId: input.shopId } : {}),
      settlementLinks: { none: { settlement: { status: "POSTED" } } },
      ...(user.role === "SUPERADMIN"
        ? {}
        : { hubId: user.hubId ?? "__none__" }),
    },
    include: {
      shop: true,
      hub: { select: { id: true, name: true } },
      parcels: {
        select: {
          id: true,
          status: true,
          codAmount: true,
          actualCodCollected: true,
          deliveryFee: true,
          paidToOsFeeIncluded: true,
          advanceAmount: true,
        },
      },
      settlementLinks: {
        where: { settlement: { status: "POSTED" } },
        select: { settlementId: true },
      },
    },
    orderBy: [{ pickupDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const shopIds = [...new Set(batches.map((batch) => batch.shopId))];
  const priorSettlements =
    shopIds.length === 0
      ? []
      : await prisma.osSettlement.findMany({
          where: { shopId: { in: shopIds }, status: "POSTED" },
          select: {
            shopId: true,
            returnDeduction: true,
            batches: { select: { batchId: true } },
          },
        });
  const priorReturnsByShop = new Map<string, number>();
  for (const settlement of priorSettlements) {
    priorReturnsByShop.set(
      settlement.shopId,
      (priorReturnsByShop.get(settlement.shopId) ?? 0) + settlement.returnDeduction,
    );
  }
  const parcelIds = batches.flatMap((batch) => batch.parcels.map((parcel) => parcel.id));
  const [creditsByParcel, offsetsByParcel] = await Promise.all([
    sumUnreversedCreditsToOsAdvanceReceivableByParcel(prisma, parcelIds),
    sumUnreversedDebitsToOsSettlementOffsetByParcel(prisma, parcelIds),
  ]);
  return batches.map((batch) => {
    const components = osBatchComponents(batch, creditsByParcel, offsetsByParcel);
    const unresolvedCount = batch.parcels.filter(
      (parcel) => !["DELIVERED", "PARTIAL", "RETURNED", "CANCELLED"].includes(parcel.status),
    ).length;
    const priorSettledReturns = priorReturnsByShop.get(batch.shopId) ?? 0;
    const covered = isOsSettlementCodCovered({
      collectedCod: components.collectedCod,
      advancePaid: batch.advancePaid,
      returnedAdvance: components.returnedAdvance,
      priorSettledReturns: batch.settlementLinks.length > 0 ? 0 : priorSettledReturns,
    });
    return {
      id: batch.id,
      label: batch.label,
      pickupDate: batch.pickupDate,
      shop: { id: batch.shop.id, name: batch.shop.name },
      hubId: batch.hubId,
      hub: batch.hub,
      parcelCount: batch.parcels.length,
      advancePaid: batch.advancePaid,
      collectedCod: components.collectedCod,
      deliveryFees: components.deliveryFees,
      returnedAdvance: components.returnedAdvance,
      priorSettledReturns,
      unresolvedCount,
      eligible:
        unresolvedCount === 0 &&
        batch.settlementLinks.length === 0 &&
        covered,
      ineligibleReason: batch.settlementLinks.length > 0
        ? "settled"
        : unresolvedCount > 0
          ? "unresolved"
          : covered
            ? null
            : "underCollected",
      settled: batch.settlementLinks.length > 0,
    };
  });
}

type OsSettlementInput = {
  shopId: string;
  hubId?: string;
  batchIds: string[];
  businessDate: string;
  wallet: CashbookWallet;
  advanceDeduction?: number;
  returnDeduction?: number;
  deliveryFeeDeduction?: number;
  adjustmentAmount?: number;
  adjustmentReason?: string;
  idempotencyKey: string;
};

export function osBatchComponents(
  batch: {
    advancePaid: number;
    parcels: Array<{
      id: string;
      status: string;
      codAmount: number;
      actualCodCollected: number | null;
      deliveryFee: number | null;
      paidToOsFeeIncluded?: boolean;
      advanceAmount: number;
    }>;
  },
  creditsByParcel: Map<string, number>,
  offsetsByParcel: Map<string, number>,
) {
  const collectedCod = batch.parcels.reduce((sum, parcel) => {
    if (parcel.status === "DELIVERED") return sum + parcel.codAmount;
    if (parcel.status === "PARTIAL" || (parcel.status === "RETURNED" && parcel.actualCodCollected != null)) {
      return sum + (parcel.actualCodCollected ?? 0);
    }
    return sum;
  }, 0);
  const deliveryFees = batch.parcels.reduce((sum, parcel) => {
    return parcel.paidToOsFeeIncluded ? sum + (parcel.deliveryFee ?? 0) : sum;
  }, 0);
  const returnedAdvance = batch.parcels.reduce((sum, parcel) => sum + settlementReturnedAdvanceContribution(
    parcel,
    creditsByParcel.get(parcel.id) ?? 0,
    offsetsByParcel.get(parcel.id) ?? 0,
  ), 0);
  const advanceAmount = batch.parcels.reduce((sum, parcel) => {
    if (!["DELIVERED", "PARTIAL"].includes(parcel.status)) return sum;
    return sum + Math.max(0, parcel.advanceAmount - (creditsByParcel.get(parcel.id) ?? 0));
  }, 0);
  return { collectedCod, deliveryFees, returnedAdvance, advanceAmount: Math.min(advanceAmount, batch.advancePaid) };
}

/** Pure helper for tests: returned-advance contribution after prior OS advance credits and staged offsets. */
export function returnedAdvanceContribution(
  parcel: { status: string; advanceAmount: number },
  priorCreditsToOsAdvanceReceivable: number,
  priorDebitsToOsSettlementOffset = 0,
) {
  return settlementReturnedAdvanceContribution(
    parcel,
    priorCreditsToOsAdvanceReceivable,
    priorDebitsToOsSettlementOffset,
  );
}

export function calculateOsSettlementNet(input: { grossCollectedCod: number; advanceDeduction: number; returnDeduction: number; deliveryFeeDeduction: number; adjustmentAmount: number }) {
  return input.grossCollectedCod - input.advanceDeduction - input.returnDeduction - input.deliveryFeeDeduction + input.adjustmentAmount;
}

/**
 * OS settlement requires collected COD to strictly exceed advances plus returns
 * (including return deductions already settled on prior posted statements for the shop).
 * When advancePaid + returnedAdvance + priorSettledReturns >= collectedCod, settlement is blocked.
 */
export function isOsSettlementCodCovered(input: {
  collectedCod: number;
  advancePaid: number;
  returnedAdvance: number;
  priorSettledReturns?: number;
}) {
  const recovered =
    input.advancePaid + input.returnedAdvance + (input.priorSettledReturns ?? 0);
  return input.collectedCod > recovered;
}

export async function previewOsSettlement(input: { shopId: string; hubId?: string; batchIds: string[] }, actor: FinanceActor) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const batchIds = [...new Set(input.batchIds)];
  if (!batchIds.length) throw new ApiError(400, "BATCH_REQUIRED", "Select at least one batch");
  const batches = await prisma.batch.findMany({ where: { id: { in: batchIds } }, include: { shop: true, parcels: { select: { id: true, status: true, codAmount: true, actualCodCollected: true, deliveryFee: true, paidToOsFeeIncluded: true, advanceAmount: true } }, settlementLinks: { where: { settlement: { status: "POSTED" } }, select: { id: true } } } });
  if (batches.length !== batchIds.length) throw new ApiError(404, "BATCH_NOT_FOUND", "One or more batches were not found");
  if (batches.some((batch) => batch.shopId !== input.shopId || batch.hubId !== hubId)) throw new ApiError(403, "SETTLEMENT_SCOPE_MISMATCH", "All batches must belong to the selected shop and hub");
  if (batches.some((batch) => batch.settlementLinks.length > 0)) throw new ApiError(409, "BATCH_ALREADY_SETTLED", "One or more batches are already in a posted settlement");
  const incomplete = batches.find((batch) => batch.parcels.some((parcel) => !["DELIVERED", "PARTIAL", "RETURNED", "CANCELLED"].includes(parcel.status)));
  if (incomplete) throw new ApiError(409, "BATCH_NOT_COMPLETE", `Batch ${incomplete.label} still has unresolved parcels`);
  const priorSettledReturns = await prisma.osSettlement.aggregate({
    where: {
      shopId: input.shopId,
      status: "POSTED",
      batches: { none: { batchId: { in: batchIds } } },
    },
    _sum: { returnDeduction: true },
  });
  const priorReturns = priorSettledReturns._sum.returnDeduction ?? 0;
  const creditsByParcel = await sumUnreversedCreditsToOsAdvanceReceivableByParcel(
    prisma,
    batches.flatMap((batch) => batch.parcels.map((parcel) => parcel.id)),
  );
  const offsetsByParcel = await sumUnreversedDebitsToOsSettlementOffsetByParcel(
    prisma,
    batches.flatMap((batch) => batch.parcels.map((parcel) => parcel.id)),
  );
  const components = batches.map((batch) => ({ batchId: batch.id, label: batch.label, ...osBatchComponents(batch, creditsByParcel, offsetsByParcel), advancePaid: batch.advancePaid }));
  const totals = components.reduce(
    (sum, component) => ({
      grossCollectedCod: sum.grossCollectedCod + component.collectedCod,
      advanceDeduction: sum.advanceDeduction + component.advanceAmount,
      returnDeduction: sum.returnDeduction + component.returnedAdvance,
      deliveryFeeDeduction: sum.deliveryFeeDeduction + component.deliveryFees,
      advancePaid: sum.advancePaid + component.advancePaid,
      returnedAdvance: sum.returnedAdvance + component.returnedAdvance,
    }),
    { grossCollectedCod: 0, advanceDeduction: 0, returnDeduction: 0, deliveryFeeDeduction: 0, advancePaid: 0, returnedAdvance: 0 },
  );
  if (
    !isOsSettlementCodCovered({
      collectedCod: totals.grossCollectedCod,
      advancePaid: totals.advancePaid,
      returnedAdvance: totals.returnedAdvance,
      priorSettledReturns: priorReturns,
    })
  ) {
    throw new ApiError(
      409,
      "OS_SETTLEMENT_UNDER_COLLECTED",
      "Collected COD must exceed advance paid plus returned advances (including previously settled returns) before settlement",
    );
  }
  return {
    shop: { id: batches[0]!.shop.id, name: batches[0]!.shop.name },
    hubId,
    batches: components,
    priorSettledReturns: priorReturns,
    defaults: {
      grossCollectedCod: totals.grossCollectedCod,
      advanceDeduction: totals.advanceDeduction,
      returnDeduction: totals.returnDeduction,
      deliveryFeeDeduction: totals.deliveryFeeDeduction,
      adjustmentAmount: 0,
      netAmount: calculateOsSettlementNet({
        grossCollectedCod: totals.grossCollectedCod,
        advanceDeduction: totals.advanceDeduction,
        returnDeduction: totals.returnDeduction,
        deliveryFeeDeduction: totals.deliveryFeeDeduction,
        adjustmentAmount: 0,
      }),
    },
  };
}

export async function postOsSettlement(input: OsSettlementInput, actor: FinanceActor) {
  const existingForKey = async () => {
    const existing = await prisma.osSettlement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { batches: true, journalEntry: { include: { lines: true } } } });
    if (!existing) return null;
    const requestedIds = [...new Set(input.batchIds)].sort();
    const existingIds = existing.batches.map((batch) => batch.batchId).sort();
    if (existing.shopId !== input.shopId || existing.businessDate.getTime() !== businessDay(input.businessDate).getTime() || existing.wallet !== input.wallet || requestedIds.join("|") !== existingIds.join("|") || (input.advanceDeduction ?? existing.advanceDeduction) !== existing.advanceDeduction || (input.returnDeduction ?? existing.returnDeduction) !== existing.returnDeduction || (input.deliveryFeeDeduction ?? existing.deliveryFeeDeduction) !== existing.deliveryFeeDeduction || (input.adjustmentAmount ?? 0) !== existing.adjustmentAmount || (input.adjustmentReason?.trim() || null) !== existing.adjustmentReason) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different OS settlement");
    return existing;
  };
  const existing = await existingForKey();
  if (existing) return existing;
  if (await prisma.osBatchObligation.count({ where: { batchId: { in: input.batchIds } } })) throw new ApiError(409, "OS_ACCOUNT_CUTOVER", "Use OS outstanding payments for finalized batches; legacy settlements are read-only");
  const preview = await previewOsSettlement(input, actor);
  const date = businessDay(input.businessDate);
  const maximums = preview.defaults;
  const adjustmentAmount = input.adjustmentAmount ?? 0;
  if (adjustmentAmount !== 0 && !input.adjustmentReason?.trim()) throw new ApiError(400, "ADJUSTMENT_REASON_REQUIRED", "A reason is required for a settlement adjustment");
  try {
    return await prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, preview.hubId);
    const batchIds = [...new Set(input.batchIds)];
    const stillEligible = await tx.batch.count({ where: { id: { in: batchIds }, shopId: input.shopId, hubId: preview.hubId, parcels: { every: { status: { in: ["DELIVERED", "PARTIAL", "RETURNED", "CANCELLED"] } } } } });
    if (stillEligible !== batchIds.length) throw new ApiError(409, "BATCH_CHANGED", "One or more batches changed; refresh the settlement preview");
    const activeLinks = await tx.osSettlementBatch.findMany({ where: { batchId: { in: batchIds }, settlement: { status: "POSTED" } } });
    if (activeLinks.length) throw new ApiError(409, "BATCH_ALREADY_SETTLED", "One or more batches were settled while this statement was open");
    const liveBatches = await tx.batch.findMany({
      where: { id: { in: batchIds } },
      include: { parcels: { select: { id: true, status: true, codAmount: true, actualCodCollected: true, deliveryFee: true, paidToOsFeeIncluded: true, advanceAmount: true } } },
    });
    const liveCredits = await sumUnreversedCreditsToOsAdvanceReceivableByParcel(
      tx,
      liveBatches.flatMap((batch) => batch.parcels.map((parcel) => parcel.id)),
    );
    const liveOffsets = await sumUnreversedDebitsToOsSettlementOffsetByParcel(
      tx,
      liveBatches.flatMap((batch) => batch.parcels.map((parcel) => parcel.id)),
    );
    const liveTotals = liveBatches.reduce(
      (sum, batch) => {
        const components = osBatchComponents(batch, liveCredits, liveOffsets);
        return {
          collectedCod: sum.collectedCod + components.collectedCod,
          advancePaid: sum.advancePaid + batch.advancePaid,
          returnedAdvance: sum.returnedAdvance + components.returnedAdvance,
          advanceDeduction: sum.advanceDeduction + components.advanceAmount,
          deliveryFees: sum.deliveryFees + components.deliveryFees,
        };
      },
      { collectedCod: 0, advancePaid: 0, returnedAdvance: 0, advanceDeduction: 0, deliveryFees: 0 },
    );
    const priorInTx = await tx.osSettlement.aggregate({
      where: {
        shopId: input.shopId,
        status: "POSTED",
        batches: { none: { batchId: { in: batchIds } } },
      },
      _sum: { returnDeduction: true },
    });
    if (
      !isOsSettlementCodCovered({
        collectedCod: liveTotals.collectedCod,
        advancePaid: liveTotals.advancePaid,
        returnedAdvance: liveTotals.returnedAdvance,
        priorSettledReturns: priorInTx._sum.returnDeduction ?? 0,
      })
    ) {
      throw new ApiError(
        409,
        "OS_SETTLEMENT_UNDER_COLLECTED",
        "Collected COD must exceed advance paid plus returned advances (including previously settled returns) before settlement",
      );
    }
    const liveMaximums = {
      grossCollectedCod: liveTotals.collectedCod,
      advanceDeduction: liveTotals.advanceDeduction,
      returnDeduction: liveTotals.returnedAdvance,
      deliveryFeeDeduction: liveTotals.deliveryFees,
    };
    if (
      maximums.grossCollectedCod !== liveMaximums.grossCollectedCod ||
      maximums.advanceDeduction !== liveMaximums.advanceDeduction ||
      maximums.returnDeduction !== liveMaximums.returnDeduction ||
      maximums.deliveryFeeDeduction !== liveMaximums.deliveryFeeDeduction
    ) {
      throw new ApiError(409, "BATCH_CHANGED", "Settlement totals changed; refresh the preview and retry");
    }
    const advanceDeduction = input.advanceDeduction ?? liveMaximums.advanceDeduction;
    const returnDeduction = input.returnDeduction ?? liveMaximums.returnDeduction;
    const deliveryFeeDeduction = input.deliveryFeeDeduction ?? liveMaximums.deliveryFeeDeduction;
    for (const [field, value, max] of [["advanceDeduction", advanceDeduction, liveMaximums.advanceDeduction], ["returnDeduction", returnDeduction, liveMaximums.returnDeduction], ["deliveryFeeDeduction", deliveryFeeDeduction, liveMaximums.deliveryFeeDeduction]] as const) {
      if (!Number.isInteger(value) || value < 0 || value > max) throw new ApiError(409, "BATCH_CHANGED", `${field} exceeds live settlement bounds; refresh the preview`);
    }
    const adjustmentLimit = liveMaximums.grossCollectedCod + liveMaximums.advanceDeduction + liveMaximums.returnDeduction + liveMaximums.deliveryFeeDeduction;
    if (!Number.isInteger(adjustmentAmount) || Math.abs(adjustmentAmount) > adjustmentLimit) throw new ApiError(400, "INVALID_SETTLEMENT_ADJUSTMENT", "Adjustment is outside the statement bounds");
    const netAmount = calculateOsSettlementNet({ grossCollectedCod: liveMaximums.grossCollectedCod, advanceDeduction, returnDeduction, deliveryFeeDeduction, adjustmentAmount });
    const settlementId = randomUUID();
    const offsetParcelIds = liveBatches.flatMap((batch) =>
      batch.parcels
        .filter((parcel) => ["RETURNED", "CANCELLED", "PARTIAL"].includes(parcel.status))
        .map((parcel) => parcel.id),
    );
    const stagedOffsetTotal = offsetParcelIds.reduce(
      (sum, parcelId) => sum + (liveOffsets.get(parcelId) ?? 0),
      0,
    );
    if (returnDeduction < stagedOffsetTotal) {
      throw new ApiError(409, "BATCH_CHANGED", "Staged return offsets increased; refresh the preview");
    }
    const journalLines = [
      { account: "OS_COD_PAYABLE", debit: liveMaximums.grossCollectedCod, credit: 0 },
      ...(advanceDeduction ? [{ account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: advanceDeduction }] : []),
      ...buildOsSettlementReturnDeductionLines(returnDeduction, Math.min(returnDeduction, stagedOffsetTotal)),
      ...(deliveryFeeDeduction ? [{ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: deliveryFeeDeduction }] : []),
      ...(adjustmentAmount > 0 ? [{ account: "OS_SETTLEMENT_ADJUSTMENT", debit: adjustmentAmount, credit: 0 }] : adjustmentAmount < 0 ? [{ account: "OS_SETTLEMENT_ADJUSTMENT", debit: 0, credit: -adjustmentAmount }] : []),
      ...(netAmount > 0 ? [{ account: walletAccount(input.wallet), debit: 0, credit: netAmount }] : netAmount < 0 ? [{ account: "OS_SETTLEMENT_RECEIVABLE", debit: -netAmount, credit: 0 }] : []),
    ];
    const journal = await tx.journalEntry.create({ data: { sourceType: "OS_SETTLEMENT", sourceId: settlementId, hubId: preview.hubId, businessDate: date, description: `OS settlement for ${preview.shop.name}`, lines: { create: journalLines } } });
    return tx.osSettlement.create({ data: { id: settlementId, shopId: input.shopId, hubId: preview.hubId, businessDate: date, grossCollectedCod: liveMaximums.grossCollectedCod, advanceDeduction, returnDeduction, deliveryFeeDeduction, adjustmentAmount, adjustmentReason: input.adjustmentReason?.trim() || null, netAmount, wallet: input.wallet, idempotencyKey: input.idempotencyKey, postedBy: actor.id, journalEntryId: journal.id, batches: { create: liveBatches.map((batch) => {
      const components = osBatchComponents(batch, liveCredits, liveOffsets);
      return { batchId: batch.id, collectedCod: components.collectedCod, advanceAmount: components.advanceAmount, returnedAdvance: components.returnedAdvance, deliveryFees: components.deliveryFees };
    }) } }, include: { shop: true, batches: { include: { batch: true } }, journalEntry: { include: { lines: true } } } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await existingForKey();
      if (raced) return raced;
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Settlement changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}

export async function listOsSettlements(input: { shopId?: string; hubId?: string }, actor: FinanceActor) {
  await assertFinanceReadActor(actor);
  const hubId = await resolveFinanceListHub(actor, input.hubId);
  return prisma.osSettlement.findMany({
    where: {
      ...(hubId ? { hubId } : {}),
      ...(input.shopId ? { shopId: input.shopId } : {}),
    },
    include: { shop: true, batches: { include: { batch: true } } },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getOsSettlement(id: string, actor: FinanceActor) {
  const user = await assertFinanceReadActor(actor);
  const settlement = await prisma.osSettlement.findUnique({ where: { id }, include: { shop: true, batches: { include: { batch: true } }, journalEntry: { include: { lines: true } } } });
  if (!settlement) throw new ApiError(404, "OS_SETTLEMENT_NOT_FOUND", "OS settlement not found");
  if (user.role !== "SUPERADMIN" && settlement.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Settlement is outside your hub scope");
  const chainIds = new Set<string>([settlement.id]);
  let predecessorId = settlement.supersedesId;
  let rootId = settlement.id;
  while (predecessorId && !chainIds.has(predecessorId) && chainIds.size < 200) {
    chainIds.add(predecessorId);
    rootId = predecessorId;
    const predecessor = await prisma.osSettlement.findUnique({ where: { id: predecessorId }, select: { supersedesId: true } });
    predecessorId = predecessor?.supersedesId ?? null;
  }
  let successorOf = rootId;
  while (chainIds.size < 200) {
    const successor = await prisma.osSettlement.findUnique({ where: { supersedesId: successorOf }, select: { id: true } });
    if (!successor) break;
    const seen = chainIds.has(successor.id);
    if (seen) break;
    chainIds.add(successor.id);
    successorOf = successor.id;
  }
  const editHistory = await prisma.osSettlementEditAudit.findMany({
    where: { targetType: "POSTED", targetId: { in: [...chainIds] } },
    orderBy: { createdAt: "asc" },
  });
  return { ...settlement, editHistory, supersessionChainIds: [...chainIds] };
}

export async function amendOsSettlement(
  input: EditableOsSettlementComponents & {
    id: string; expectedVersion: number; businessDate: string; wallet: CashbookWallet;
    reason: string; idempotencyKey: string;
  },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  if (!["SUPERADMIN", "FINANCE"].includes(user.role))
    throw new ApiError(403, "FORBIDDEN", "Only Superadmin or Finance may amend a posted OS settlement");
  const replay = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.targetType !== "POSTED" || replay.targetId !== input.id)
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another settlement edit");
    if (!replayMatchesComponents(replay.afterJson, input))
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for different settlement values");
    const replacementId = (JSON.parse(replay.afterJson) as { replacementId?: string }).replacementId;
    if (!replacementId) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Prior edit result is incomplete");
    return getOsSettlement(replacementId, actor);
  }
  const correctionDate = businessDay(input.businessDate);
  try {
    return await prisma.$transaction(async (tx) => {
    const original = await tx.osSettlement.findUnique({
      where: { id: input.id },
      include: { batches: true, journalEntry: { include: { lines: true } } },
    });
    if (!original) throw new ApiError(404, "OS_SETTLEMENT_NOT_FOUND", "OS settlement not found");
    if (user.role !== "SUPERADMIN" && original.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Settlement is outside your hub scope");
    if (original.status !== "POSTED") throw new ApiError(409, "SETTLEMENT_NOT_EDITABLE", "Only the current posted settlement version can be amended");
    if (original.version !== input.expectedVersion) throw new ApiError(409, "EDIT_CONFLICT", "Settlement changed; refresh and retry");
    await assertCashbookOpen(tx, correctionDate, original.hubId);
    const maximums = {
      grossCollectedCod: original.batches.reduce((sum, row) => sum + row.collectedCod, 0),
      advanceDeduction: original.batches.reduce((sum, row) => sum + row.advanceAmount, 0),
      returnDeduction: original.batches.reduce((sum, row) => sum + row.returnedAdvance, 0),
      deliveryFeeDeduction: original.batches.reduce((sum, row) => sum + row.deliveryFees, 0),
    };
    validateEditableSettlementComponents(input, maximums);
    const stagedReturnMaximum = original.journalEntry.lines
      .filter((line) => line.account === "OS_SETTLEMENT_OFFSET")
      .reduce((sum, line) => sum + line.credit, 0);
    if (input.returnDeduction < stagedReturnMaximum)
      throw new ApiError(400, "INVALID_SETTLEMENT_COMPONENT", "Return deduction cannot be below the staged return offset");
    const netAmount = calculateOsSettlementNet({ ...maximums, ...input });
    const replacementId = randomUUID();
    const replacementLines = [
      { account: "OS_COD_PAYABLE", debit: maximums.grossCollectedCod, credit: 0 },
      ...(input.advanceDeduction ? [{ account: "OS_ADVANCE_RECEIVABLE", debit: 0, credit: input.advanceDeduction }] : []),
      ...buildOsSettlementReturnDeductionLines(input.returnDeduction, Math.min(input.returnDeduction, stagedReturnMaximum)),
      ...(input.deliveryFeeDeduction ? [{ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: input.deliveryFeeDeduction }] : []),
      ...(input.adjustmentAmount > 0
        ? [{ account: "OS_SETTLEMENT_ADJUSTMENT", debit: input.adjustmentAmount, credit: 0 }]
        : input.adjustmentAmount < 0
          ? [{ account: "OS_SETTLEMENT_ADJUSTMENT", debit: 0, credit: -input.adjustmentAmount }]
          : []),
      ...(netAmount > 0 ? [{ account: walletAccount(input.wallet), debit: 0, credit: netAmount }] : netAmount < 0 ? [{ account: "OS_SETTLEMENT_RECEIVABLE", debit: -netAmount, credit: 0 }] : []),
    ];
    const claimed = await tx.osSettlement.updateMany({
      where: { id: original.id, status: "POSTED", version: input.expectedVersion },
      data: { status: "REPLACED", reversedAt: new Date(), reversedBy: actor.id, reversalReason: input.reason.trim() },
    });
    if (claimed.count !== 1) throw new ApiError(409, "EDIT_CONFLICT", "Settlement changed; refresh and retry");
    await tx.journalEntry.create({ data: {
      sourceType: "LEDGER_REVERSAL", sourceId: original.journalEntry.id, hubId: original.hubId,
      businessDate: correctionDate, description: `OS settlement amendment reversal: ${input.reason.trim()}`,
      lines: { create: original.journalEntry.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit })) },
    } });
    const journal = await tx.journalEntry.create({ data: {
      sourceType: "OS_SETTLEMENT", sourceId: replacementId, hubId: original.hubId,
      businessDate: correctionDate, description: `OS settlement replacement for ${original.id}: ${input.reason.trim()}`,
      lines: { create: replacementLines },
    } });
    const replacement = await tx.osSettlement.create({ data: {
      id: replacementId, shopId: original.shopId, hubId: original.hubId, businessDate: correctionDate,
      grossCollectedCod: maximums.grossCollectedCod, advanceDeduction: input.advanceDeduction,
      returnDeduction: input.returnDeduction, deliveryFeeDeduction: input.deliveryFeeDeduction,
      adjustmentAmount: input.adjustmentAmount, adjustmentReason: input.adjustmentReason?.trim() || null,
      netAmount, wallet: input.wallet, status: "POSTED", idempotencyKey: `amend:${input.idempotencyKey}`,
      postedBy: actor.id, journalEntryId: journal.id, version: original.version + 1, supersedesId: original.id,
      batches: { create: original.batches.map((row) => ({
        batchId: row.batchId, collectedCod: row.collectedCod, advanceAmount: row.advanceAmount,
        returnedAdvance: row.returnedAdvance, deliveryFees: row.deliveryFees,
      })) },
    }, include: { shop: true, batches: { include: { batch: true } }, journalEntry: { include: { lines: true } } } });
    await tx.osSettlementEditAudit.create({ data: {
      targetType: "POSTED", targetId: original.id, action: "REVERSED_AND_REPLACED", actorId: actor.id,
      reason: input.reason.trim(), beforeJson: JSON.stringify({
        settlementId: original.id, version: original.version, advanceDeduction: original.advanceDeduction,
        returnDeduction: original.returnDeduction, deliveryFeeDeduction: original.deliveryFeeDeduction,
        adjustmentAmount: original.adjustmentAmount, adjustmentReason: original.adjustmentReason,
        wallet: original.wallet, netAmount: original.netAmount,
      }),
      afterJson: JSON.stringify({ replacementId, version: replacement.version, advanceDeduction: replacement.advanceDeduction,
        returnDeduction: replacement.returnDeduction, deliveryFeeDeduction: replacement.deliveryFeeDeduction,
        adjustmentAmount: replacement.adjustmentAmount, adjustmentReason: replacement.adjustmentReason,
        wallet: replacement.wallet, netAmount: replacement.netAmount }),
      idempotencyKey: input.idempotencyKey,
    } });
    return replacement;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (raced) return amendOsSettlement(input, actor);
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Settlement amendment changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}

export async function reverseOsSettlement(input: { id: string; businessDate: string; reason: string }, actor: FinanceActor) {
  const user = await assertFinanceActor(actor);
  if (!['SUPERADMIN', 'FINANCE'].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Only Superadmin or Finance may reverse an OS settlement");
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.osSettlement.findUnique({ where: { id: input.id }, include: { journalEntry: { include: { lines: true } } } });
    if (!settlement) throw new ApiError(404, "OS_SETTLEMENT_NOT_FOUND", "OS settlement not found");
    if (await tx.osSettlementBatch.count({ where: { settlementId: settlement.id, batch: { osObligation: { isNot: null } } } })) throw new ApiError(409, "OS_ACCOUNT_CUTOVER", "Legacy settlements are read-only after OS account cutover");
    if (user.role !== "SUPERADMIN" && settlement.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Settlement is outside your hub scope");
    if (settlement.status !== "POSTED") throw new ApiError(409, "SETTLEMENT_ALREADY_REVERSED", "OS settlement is already reversed");
    await assertCashbookOpen(tx, date, settlement.hubId);
    await tx.journalEntry.create({ data: { sourceType: "LEDGER_REVERSAL", sourceId: settlement.journalEntry.id, hubId: settlement.hubId, businessDate: date, description: `OS settlement reversal: ${input.reason.trim()}`, lines: { create: settlement.journalEntry.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit })) } } });
    return tx.osSettlement.update({ where: { id: settlement.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedBy: actor.id, reversalReason: input.reason.trim() }, include: { shop: true, batches: true, journalEntry: { include: { lines: true } } } });
  }, { isolationLevel: "Serializable" });
}
