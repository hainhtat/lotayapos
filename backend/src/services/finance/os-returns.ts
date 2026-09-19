import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { getActiveReturnDeduction, postReturnDeductionInTx, recoverableAdvance, recoverableAdvanceAmount, sumUnreversedCreditsToOsAdvanceReceivableByParcel } from "../os-advance.js";
import { assertFinanceActor, assertFinanceReadActor, resolveFinanceListHub, type FinanceActor } from "../finance-authorization.js";
import { assertCashbookOpen } from "./cashbook-policy.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function receiveOsReturnHistoryNote(input: {
  idempotencyKey: string;
  businessDate: string;
  recoverableAmount: number;
}) {
  return [
    "Finance OS return receive",
    `idempotencyKey=${input.idempotencyKey}`,
    `businessDate=${input.businessDate.slice(0, 10)}`,
    `recoverableAmount=${input.recoverableAmount}`,
  ].join(" | ");
}

function receiveNoteBusinessDate(note: string | null | undefined) {
  return note?.match(/businessDate=([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1] ?? null;
}

async function replayReceiveOsReturn(
  tx: Prisma.TransactionClient,
  input: { parcelId: string; businessDate: string; idempotencyKey: string },
  priorNote: string | null | undefined,
) {
  const noteBusinessDate = receiveNoteBusinessDate(priorNote);
  if (noteBusinessDate && noteBusinessDate !== input.businessDate.slice(0, 10)) {
    throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different receive request");
  }
  const parcel = await tx.parcel.findUnique({
    where: { id: input.parcelId },
    select: { id: true, status: true, trackingNumber: true, advanceAmount: true },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  const journalEntry = await getActiveReturnDeduction(tx, parcel.id);
  const recoverableAmount = Number(priorNote?.match(/recoverableAmount=(\d+)/)?.[1] ?? 0);
  return {
    parcel: {
      id: parcel.id,
      status: parcel.status,
      trackingNumber: parcel.trackingNumber,
      advanceAmount: parcel.advanceAmount,
    },
    recoverableAmount,
    journalEntry,
    alreadyReceived: true,
    replay: true as const,
  };
}

const OS_PENDING_RETURN_STATUSES = ["FAILED", "REJECTED", "PENDING_RETURN", "PARTIAL"] as const;

/**
 * Finance OS pending-return queue: parcels awaiting return-to-OS recovery.
 * Recoverable amounts exclude unreversed OS_ADVANCE_RECEIVABLE credits (partial offsets, prior deductions, etc.).
 */
export async function listOsPendingReturns(
  input: { shopId?: string; hubId?: string },
  actor: FinanceActor,
) {
  await assertFinanceReadActor(actor);
  const hubId = await resolveFinanceListHub(actor, input.hubId);
  const parcels = await prisma.parcel.findMany({
    where: {
      status: { in: [...OS_PENDING_RETURN_STATUSES] },
      ...((input.shopId || hubId)
        ? {
            batch: {
              ...(input.shopId ? { shopId: input.shopId } : {}),
              ...(hubId ? { hubId } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      advanceAmount: true,
      returnDueAt: true,
      batch: {
        select: {
          id: true,
          label: true,
          hubId: true,
          shop: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ returnDueAt: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const creditsByParcel = await sumUnreversedCreditsToOsAdvanceReceivableByParcel(
    prisma,
    parcels.map((parcel) => parcel.id),
  );
  const items = parcels.map((parcel) => {
    const recoverableAmount = recoverableAdvanceAmount(
      parcel.advanceAmount,
      creditsByParcel.get(parcel.id) ?? 0,
    );
    return {
      id: parcel.id,
      trackingNumber: parcel.trackingNumber,
      status: parcel.status,
      advanceAmount: parcel.advanceAmount,
      recoverableAmount,
      priorOffsetAmount: parcel.advanceAmount - recoverableAmount,
      returnDueAt: parcel.returnDueAt,
      batch: { id: parcel.batch.id, label: parcel.batch.label },
      shop: { id: parcel.batch.shop.id, name: parcel.batch.shop.name },
      hubId: parcel.batch.hubId,
    };
  });
  return {
    items,
    summary: {
      count: items.length,
      totalRecoverableAmount: items.reduce((sum, item) => sum + item.recoverableAmount, 0),
    },
  };
}

/**
 * Finance receive-to-OS: mark parcel RETURNED and post remaining recoverable advance as OS_RETURN_DEDUCTION.
 *
 * Finance-allowed status path (documented): SUPERADMIN / FINANCE / OPERATIONS_MANAGER may jump
 * FAILED | REJECTED | PARTIAL | PENDING_RETURN → RETURNED in one step (not limited to PENDING_RETURN → RETURNED).
 * This is intentional finance recovery, not an ERP Ops status override — MONEY_POSTED does not block PARTIAL → RETURNED here.
 * No wallet lines are posted on this action.
 */
export async function receiveOsReturn(
  input: { parcelId: string; businessDate: string; idempotencyKey: string },
  actor: FinanceActor,
  transaction?: Prisma.TransactionClient,
) {
  const user = await assertFinanceActor(actor);
  const date = businessDay(input.businessDate);
  const idempotencyKey = input.idempotencyKey.trim();

  const receive = async (tx: Prisma.TransactionClient) => {
    const priorReceive = await tx.statusHistory.findFirst({
      where: {
        parcelId: input.parcelId,
        reasonCode: "FINANCE_OS_RETURN_RECEIVE",
        note: { contains: `idempotencyKey=${idempotencyKey} |` },
      },
      orderBy: { createdAt: "desc" },
      select: { note: true },
    });
    if (priorReceive) {
      return replayReceiveOsReturn(tx, input, priorReceive.note);
    }

    const parcel = await tx.parcel.findUnique({
      where: { id: input.parcelId },
      include: {
        batch: { select: { hubId: true, shopId: true } },
      },
    });
    if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
    if (!parcel.batch.hubId) throw new ApiError(409, "PARCEL_HUB_REQUIRED", "Parcel batch must belong to a hub");
    const hubId = parcel.batch.hubId;
    if (user.role !== "SUPERADMIN" && (!user.hubId || user.hubId !== hubId)) {
      throw new ApiError(403, "FORBIDDEN", "Parcel is outside your hub scope");
    }

    await assertCashbookOpen(tx, date, hubId);

    const ensureFullCodReturnCredit = async () => {
      const existingCredit = await tx.osReturnCredit.findUnique({ where: { parcelId: parcel.id } });
      if (existingCredit) return existingCredit;
      const creditId = randomUUID();
      const journal = parcel.codAmount > 0 ? await tx.journalEntry.create({ data: {
        sourceType: "OS_FULL_COD_RETURN_CREDIT", sourceId: parcel.id, hubId, businessDate: date,
        description: `Full COD return credit for ${parcel.trackingNumber}`,
        lines: { create: [{ account: "OS_COD_PAYABLE", debit: parcel.codAmount, credit: 0 }, { account: "OS_BATCH_COD_CLEARING", debit: 0, credit: parcel.codAmount }] },
      } }) : null;
      return tx.osReturnCredit.create({ data: { id: creditId, parcelId: parcel.id, batchId: parcel.batchId, shopId: parcel.batch.shopId, hubId, amount: parcel.codAmount, codAmount: parcel.codAmount, feeAmount: 0, kind: "PHYSICAL_RETURN", businessDate: date, idempotencyKey: `return:${idempotencyKey}`, postedBy: actor.id, journalEntryId: journal?.id } });
    };

    const simplifiedObligation = await tx.osBatchObligation.findUnique({ where: { batchId: parcel.batchId }, select: { id: true } });
    if (simplifiedObligation) {
      if (parcel.status !== "RETURNED" && !(OS_PENDING_RETURN_STATUSES as readonly string[]).includes(parcel.status)) throw new ApiError(409, "INVALID_RETURN_STATUS", "OS return receive requires FAILED, REJECTED, PENDING_RETURN, or PARTIAL status");
      if (parcel.status !== "RETURNED") {
        const updated = await tx.parcel.updateMany({ where: { id: parcel.id, status: parcel.status }, data: { status: "RETURNED" } });
        if (updated.count !== 1) throw new ApiError(409, "STATUS_CONFLICT", "Parcel status changed; refresh and retry");
      }
      const credit = await ensureFullCodReturnCredit();
      if (parcel.status !== "RETURNED") await tx.statusHistory.create({ data: { parcelId: parcel.id, fromStatus: parcel.status as never, toStatus: "RETURNED", actorId: actor.id, reasonCode: "FINANCE_OS_RETURN_RECEIVE", note: receiveOsReturnHistoryNote({ idempotencyKey, businessDate: input.businessDate, recoverableAmount: parcel.codAmount }) } });
      return { parcel: { id: parcel.id, status: "RETURNED", trackingNumber: parcel.trackingNumber, advanceAmount: parcel.advanceAmount }, recoverableAmount: parcel.codAmount, journalEntry: credit.journalEntryId ? await tx.journalEntry.findUnique({ where: { id: credit.journalEntryId }, include: { lines: true } }) : null, alreadyReceived: parcel.status === "RETURNED" };
    }

    const activeDeduction = await getActiveReturnDeduction(tx, parcel.id);

    if (parcel.status === "RETURNED") {
      await ensureFullCodReturnCredit();
      const recoverable = await recoverableAdvance(tx, parcel);
      if (activeDeduction) {
        const credited = activeDeduction.lines
          .filter((line) => line.account === "OS_ADVANCE_RECEIVABLE")
          .reduce((sum, line) => sum + line.credit, 0);
        if (recoverable > 0 && credited < recoverable) {
          throw new ApiError(
            409,
            "DEDUCTION_INCOMPLETE",
            "An existing return deduction covers less than the recoverable advance remainder",
          );
        }
        return {
          parcel: { id: parcel.id, status: "RETURNED", trackingNumber: parcel.trackingNumber, advanceAmount: parcel.advanceAmount },
          recoverableAmount: 0,
          journalEntry: activeDeduction,
          alreadyReceived: true,
        };
      }
      if (recoverable === 0) {
        return {
          parcel: { id: parcel.id, status: "RETURNED", trackingNumber: parcel.trackingNumber, advanceAmount: parcel.advanceAmount },
          recoverableAmount: 0,
          journalEntry: null,
          alreadyReceived: true,
        };
      }
      const journalEntry = await postReturnDeductionInTx(tx, {
        parcel,
        hubId,
        businessDate: date,
        amount: recoverable,
      });
      await tx.statusHistory.create({
        data: {
          parcelId: parcel.id,
          fromStatus: "RETURNED",
          toStatus: "RETURNED",
          actorId: actor.id,
          reasonCode: "FINANCE_OS_RETURN_RECEIVE",
          note: receiveOsReturnHistoryNote({
            idempotencyKey,
            businessDate: input.businessDate,
            recoverableAmount: recoverable,
          }),
        },
      });
      return {
        parcel: { id: parcel.id, status: "RETURNED", trackingNumber: parcel.trackingNumber, advanceAmount: parcel.advanceAmount },
        recoverableAmount: recoverable,
        journalEntry,
        alreadyReceived: false,
      };
    }

    if (!(OS_PENDING_RETURN_STATUSES as readonly string[]).includes(parcel.status)) {
      throw new ApiError(
        409,
        "INVALID_RETURN_STATUS",
        "OS return receive requires FAILED, REJECTED, PENDING_RETURN, or PARTIAL status",
      );
    }

    if (activeDeduction) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "A return deduction already exists for a parcel that is not RETURNED");
    }

    const recoverableAmount = await recoverableAdvance(tx, parcel);

    const updated = await tx.parcel.updateMany({
      where: { id: parcel.id, status: parcel.status },
      data: { status: "RETURNED" },
    });
    if (updated.count !== 1) throw new ApiError(409, "STATUS_CONFLICT", "Parcel status changed; refresh and retry");
    await ensureFullCodReturnCredit();

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        fromStatus: parcel.status as never,
        toStatus: "RETURNED",
        actorId: actor.id,
        reasonCode: "FINANCE_OS_RETURN_RECEIVE",
        note: receiveOsReturnHistoryNote({
          idempotencyKey,
          businessDate: input.businessDate,
          recoverableAmount,
        }),
      },
    });

    let journalEntry = null;
    if (recoverableAmount > 0) {
      journalEntry = await postReturnDeductionInTx(tx, {
        parcel,
        hubId,
        businessDate: date,
        amount: recoverableAmount,
      });
    }

    return {
      parcel: {
        id: parcel.id,
        status: "RETURNED",
        trackingNumber: parcel.trackingNumber,
        advanceAmount: parcel.advanceAmount,
      },
      recoverableAmount,
      journalEntry,
      alreadyReceived: false,
    };
  };
  return transaction ? receive(transaction) : prisma.$transaction(receive, { isolationLevel: "Serializable" });
}

export async function receiveOsReturnsBulk(input: { parcelIds: string[]; businessDate: string; idempotencyKey: string }, actor: FinanceActor) {
  const user = await assertFinanceActor(actor);
  const ids = [...new Set(input.parcelIds)].sort();
  if (!ids.length || ids.length > 50 || ids.length !== input.parcelIds.length) throw new ApiError(400, "INVALID_PARCEL_SELECTION", "Select between 1 and 50 distinct parcels");
  const hash = createHash("sha256").update(JSON.stringify({ ids, businessDate: input.businessDate, actorId: actor.id })).digest("hex");
  return prisma.$transaction(async tx => {
    const count = await tx.parcel.count({ where: { id: { in: ids }, ...(user.role === "SUPERADMIN" ? {} : { batch: { hubId: user.hubId } }) } });
    if (count !== ids.length) throw new ApiError(404, "PARCEL_NOT_FOUND", "Some parcels are outside your hub");
    const previous = await tx.osSettlementEditAudit.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (previous) {
      if (previous.targetType !== "BULK_OS_RETURN" || previous.beforeJson !== hash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This request reference was used for different returns");
      return JSON.parse(previous.afterJson) as { updatedCount: number; results: unknown[] };
    }
    const results = [];
    for (const parcelId of ids) results.push(await receiveOsReturn({ parcelId, businessDate: input.businessDate, idempotencyKey: createHash("sha256").update(`${input.idempotencyKey}:${parcelId}`).digest("hex") }, actor, tx));
    const result = { updatedCount: results.length, results };
    await tx.osSettlementEditAudit.create({ data: { targetType: "BULK_OS_RETURN", targetId: input.idempotencyKey, action: "RECEIVE", actorId: actor.id, reason: "Confirmed physical handover to OS", beforeJson: hash, afterJson: JSON.stringify(result), idempotencyKey: input.idempotencyKey } });
    return result;
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
