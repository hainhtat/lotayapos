import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import { assertFinanceActor, resolveFinanceHub, resolveFinanceListHub, type FinanceActor } from "../finance-authorization.js";
import type { CashbookWallet } from "./cashbook-rules.js";
import { previewOsSettlement } from "./os-settlements.js";
import { replayMatchesComponents, validateEditableSettlementComponents, type EditableOsSettlementComponents } from "./os-settlement-components.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function replayMatchesDraftCreate(
  afterJson: string,
  input: SaveOsSettlementDraftInput,
  resolvedHubId: string,
) {
  const prior = JSON.parse(afterJson) as Record<string, unknown>;
  const batchIds = [...new Set(input.batchIds)].sort();
  return replayMatchesComponents(afterJson, input)
    && prior.shopId === input.shopId
    && prior.hubId === resolvedHubId
    && JSON.stringify(prior.batchIds) === JSON.stringify(batchIds)
    && prior.businessDate === input.businessDate.slice(0, 10);
}

type SaveOsSettlementDraftInput = EditableOsSettlementComponents & {
  shopId: string;
  hubId?: string;
  batchIds: string[];
  businessDate: string;
  wallet: CashbookWallet;
  reason: string;
  idempotencyKey: string;
};

export async function createOsSettlementDraft(input: SaveOsSettlementDraftInput, actor: FinanceActor) {
  const resolvedHubId = await resolveFinanceHub(actor, input.hubId);
  const replay = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.targetType !== "DRAFT" || replay.action !== "CREATED")
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another settlement edit");
    if (!replayMatchesDraftCreate(replay.afterJson, input, resolvedHubId))
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for different draft values");
    return prisma.osSettlementDraft.findUniqueOrThrow({ where: { id: replay.targetId } });
  }
  if (await prisma.osBatchObligation.count({ where: { batchId: { in: input.batchIds } } })) throw new ApiError(409, "OS_ACCOUNT_CUTOVER", "Use OS outstanding payments for finalized batches; legacy settlement drafts are read-only");
  const preview = await previewOsSettlement(input, actor);
  validateEditableSettlementComponents(input, preview.defaults);
  const batchIds = [...new Set(input.batchIds)].sort();
  const snapshot = {
    shopId: input.shopId, hubId: preview.hubId, batchIds,
    businessDate: input.businessDate.slice(0, 10), wallet: input.wallet,
    advanceDeduction: input.advanceDeduction, returnDeduction: input.returnDeduction,
    deliveryFeeDeduction: input.deliveryFeeDeduction, adjustmentAmount: input.adjustmentAmount,
    adjustmentReason: input.adjustmentReason?.trim() || null,
  };
  try {
    return await prisma.$transaction(async (tx) => {
    const draft = await tx.osSettlementDraft.create({ data: {
      shopId: input.shopId, hubId: preview.hubId, batchIdsJson: JSON.stringify(batchIds),
      businessDate: businessDay(input.businessDate), wallet: input.wallet,
      advanceDeduction: input.advanceDeduction, returnDeduction: input.returnDeduction,
      deliveryFeeDeduction: input.deliveryFeeDeduction, adjustmentAmount: input.adjustmentAmount,
      adjustmentReason: input.adjustmentReason?.trim() || null, createdBy: actor.id, updatedBy: actor.id,
    } });
    await tx.osSettlementEditAudit.create({ data: {
      targetType: "DRAFT", targetId: draft.id, action: "CREATED", actorId: actor.id,
      reason: input.reason.trim(), beforeJson: "null", afterJson: JSON.stringify(snapshot), idempotencyKey: input.idempotencyKey,
    } });
    return draft;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (raced) return createOsSettlementDraft(input, actor);
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Settlement draft changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}

export async function listSavedOsSettlementDrafts(input: { shopId?: string; hubId?: string }, actor: FinanceActor) {
  const hubId = await resolveFinanceListHub(actor, input.hubId);
  return prisma.osSettlementDraft.findMany({
    where: { ...(hubId ? { hubId } : {}), ...(input.shopId ? { shopId: input.shopId } : {}) },
    orderBy: { updatedAt: "desc" }, take: 200,
  });
}

export async function updateOsSettlementDraft(
  input: EditableOsSettlementComponents & { id: string; expectedVersion: number; reason: string; idempotencyKey: string },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  const replay = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.targetType !== "DRAFT" || replay.targetId !== input.id || replay.action !== "UPDATED")
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for another settlement edit");
    const prior = JSON.parse(replay.afterJson) as { version?: number };
    if (prior.version !== input.expectedVersion + 1 || !replayMatchesComponents(replay.afterJson, input))
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for different draft values");
    return prisma.osSettlementDraft.findUniqueOrThrow({ where: { id: input.id } });
  }
  const draft = await prisma.osSettlementDraft.findUnique({ where: { id: input.id } });
  if (!draft) throw new ApiError(404, "OS_SETTLEMENT_DRAFT_NOT_FOUND", "Saved settlement draft not found");
  if (user.role !== "SUPERADMIN" && draft.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Draft is outside your hub scope");
  const draftBatchIds = JSON.parse(draft.batchIdsJson) as string[];
  if (await prisma.osBatchObligation.count({ where: { batchId: { in: draftBatchIds } } })) throw new ApiError(409, "OS_ACCOUNT_CUTOVER", "Legacy settlement drafts are read-only after OS account cutover");
  const preview = await previewOsSettlement({ shopId: draft.shopId, hubId: draft.hubId, batchIds: draftBatchIds }, actor);
  validateEditableSettlementComponents(input, preview.defaults);
  const before = JSON.stringify(draft);
  try {
    return await prisma.$transaction(async (tx) => {
    const updated = await tx.osSettlementDraft.updateMany({
      where: { id: draft.id, version: input.expectedVersion },
      data: {
        advanceDeduction: input.advanceDeduction, returnDeduction: input.returnDeduction,
        deliveryFeeDeduction: input.deliveryFeeDeduction, adjustmentAmount: input.adjustmentAmount,
        adjustmentReason: input.adjustmentReason?.trim() || null, updatedBy: actor.id,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApiError(409, "EDIT_CONFLICT", "Draft changed; refresh and retry");
    const result = await tx.osSettlementDraft.findUniqueOrThrow({ where: { id: draft.id } });
    await tx.osSettlementEditAudit.create({ data: {
      targetType: "DRAFT", targetId: draft.id, action: "UPDATED", actorId: actor.id,
      reason: input.reason.trim(), beforeJson: before, afterJson: JSON.stringify(result), idempotencyKey: input.idempotencyKey,
    } });
    return result;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await prisma.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (raced) return updateOsSettlementDraft(input, actor);
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Settlement draft changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}
