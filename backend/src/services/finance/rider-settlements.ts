import { prisma } from "../../config/database.js";
import { ApiError } from "../../utils/api-error.js";
import { resolveCommissionRateBps } from "../../utils/commission.js";
import type { Prisma } from "@prisma/client";
import { buildRiderSettlementReceivableLines, calculateDailySalaryDeduction, calculateRecognitionTotals, calculateRiderSettlementAmounts } from "../rider-settlement-calculations.js";
import { assertFinanceActor, isFinanceRole, type FinanceActor } from "../finance-authorization.js";
import { assertCashbookOpen } from "./cashbook-policy.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function assertWallets(input: {
  cash: number;
  kbzPay: number;
  wavePay: number;
}) {
  if (
    [input.cash, input.kbzPay, input.wavePay].some(
      (amount) => !Number.isInteger(amount) || amount < 0,
    )
  )
    throw new ApiError(
      400,
      "INVALID_WALLET_AMOUNT",
      "Wallet amounts must be non-negative integers",
    );
}

async function assertRiderScope(riderId: string, actor: FinanceActor) {
  const user = await assertFinanceActor(actor);
  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    select: { id: true, hubId: true },
  });
  if (!rider) throw new ApiError(404, "RIDER_NOT_FOUND", "Rider not found");
  if (user.role !== "SUPERADMIN" && (!user.hubId || rider.hubId !== user.hubId))
    throw new ApiError(403, "FORBIDDEN", "Rider is outside your hub scope");
  return rider;
}

async function resolveSettlementRider(
  actor: FinanceActor,
  requestedRiderId?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      role: true,
      active: true,
      hubId: true,
      rider: { select: { id: true, hubId: true } },
    },
  });
  if (!user || !user.active || user.role !== actor.role)
    throw new ApiError(403, "FORBIDDEN", "Active user scope required");
  if (user.role === "RIDER") {
    if (!user.rider)
      throw new ApiError(403, "FORBIDDEN", "Rider profile required");
    if (requestedRiderId && requestedRiderId !== user.rider.id)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Riders may only access their own settlement",
      );
    return user.rider;
  }
  if (!isFinanceRole(user.role) || !requestedRiderId)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "A rider selection and finance scope are required",
    );
  const rider = await prisma.rider.findUnique({
    where: { id: requestedRiderId },
    select: { id: true, hubId: true },
  });
  if (!rider) throw new ApiError(404, "RIDER_NOT_FOUND", "Rider not found");
  if (user.role !== "SUPERADMIN" && (!user.hubId || rider.hubId !== user.hubId))
    throw new ApiError(403, "FORBIDDEN", "Rider is outside your hub scope");
  return rider;
}

async function settlementWork(
  riderId: string,
  date: Date,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const [rider, parcels, recognitions] = await Promise.all([
    db.rider.findUnique({
      where: { id: riderId },
      select: { payModel: true, commissionRateBps: true, monthlySalary: true },
    }),
    db.parcel.findMany({
      where: {
        riderId,
        status: "DELIVERED",
        statusHistory: {
          some: {
            toStatus: "DELIVERED",
            createdAt: { gte: date, lt: nextDate },
          },
        },
      },
      include: {
        ways: { orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }] },
        linkGroup: {
          include: { parcels: { select: { id: true, status: true } } },
        },
      },
    }),
    db.riderReceivableRecognition.findMany({
      where: {
        riderId,
        businessDate: date,
        sourceType: { not: "RIDER_SALARY_DEDUCTION" },
      },
      select: { codAmount: true, deliveryFee: true, commissionAmount: true },
    }),
  ]);
  const commissionRateBps = resolveCommissionRateBps(rider);
  // Immutable recognition rows are the accounting source of truth. This keeps
  // previews and receipts stable even if a linked group completes on a later day.
  const totals = calculateRecognitionTotals(recognitions);
  const salaryDeduction = calculateDailySalaryDeduction(
    rider?.monthlySalary,
    date,
    rider?.payModel,
  );
  return {
    parcelCount: parcels.length,
    payModel: rider?.payModel ?? "PERCENTAGE",
    commissionRateBps,
    parcels: parcels.map((parcel) => ({
      id: parcel.id,
      trackingNumber: parcel.trackingNumber,
      orderId: parcel.orderId,
      codAmount: parcel.codAmount,
      deliveryFee: parcel.deliveryFee ?? 0,
      commissionAmount:
        parcel.ways.find((way) => way.outcome === "DELIVERED")
          ?.commissionAmount ?? 0,
    })),
    ...totals,
    salaryDeduction,
    expectedAmount:
      totals.cod + totals.fees - totals.commission - salaryDeduction,
  };
}

async function riderReceivablePosition(riderId: string, date: Date, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const throughDate = new Date(date);
  throughDate.setUTCDate(throughDate.getUTCDate() + 1);
  const [recognized, receipts] = await Promise.all([
    db.riderReceivableRecognition.aggregate({ where: { riderId, businessDate: { lt: throughDate } }, _sum: { receivableAmount: true } }),
    db.settlementLine.aggregate({ where: { settlement: { riderId, businessDate: { lt: throughDate } } }, _sum: { amount: true } }),
  ]);
  const recognizedAmount = recognized._sum.receivableAmount ?? 0;
  const paidAmount = receipts._sum.amount ?? 0;
  return { recognizedAmount, paidAmount, outstandingAmount: Math.max(0, recognizedAmount - paidAmount) };
}

export function combineRiderOutstandingAggregates(
  riderIds: string[],
  recognized: Array<{ riderId: string; _sum: { receivableAmount: number | null } }>,
  paid: Array<{ riderId: string; _sum: { actualAmount: number | null } }>,
) {
  const recognizedByRider = new Map(recognized.map((row) => [row.riderId, row._sum.receivableAmount ?? 0]));
  const paidByRider = new Map(paid.map((row) => [row.riderId, row._sum.actualAmount ?? 0]));
  const rows = riderIds.map((riderId) => {
    const recognizedAmount = recognizedByRider.get(riderId) ?? 0;
    const paidAmount = paidByRider.get(riderId) ?? 0;
    return { riderId, recognizedAmount, paidAmount, outstandingAmount: Math.max(0, recognizedAmount - paidAmount) };
  });
  return {
    outstandingAmount: rows.reduce((sum, row) => sum + row.outstandingAmount, 0),
    unsettledRiderCount: rows.filter((row) => row.outstandingAmount > 0).length,
    rows,
  };
}

/** Set-based cumulative rider receivable position for dashboard/report summaries. */
export async function summarizeRiderOutstandingThroughDate(date: Date, hubId?: string) {
  const throughDate = new Date(date);
  throughDate.setUTCDate(throughDate.getUTCDate() + 1);
  const [riders, recognized, receipts] = await Promise.all([
    prisma.rider.findMany({
      where: { ...(hubId ? { hubId } : {}), user: { active: true } },
      select: { id: true },
    }),
    prisma.riderReceivableRecognition.groupBy({
      by: ["riderId"],
      where: { ...(hubId ? { hubId } : {}), businessDate: { lt: throughDate }, rider: { user: { active: true } } },
      _sum: { receivableAmount: true },
    }),
    prisma.settlement.groupBy({
      by: ["riderId"],
      where: { businessDate: { lt: throughDate }, rider: { ...(hubId ? { hubId } : {}), user: { active: true } } },
      _max: { actualAmount: true },
    }),
  ]);
  const paid = receipts.map((receipt) => ({ riderId: receipt.riderId, _sum: { actualAmount: receipt._max.actualAmount } }));
  return combineRiderOutstandingAggregates(riders.map((rider) => rider.id), recognized, paid);
}

export async function previewRiderSettlement(
  input: { businessDate: string; riderId?: string },
  actor: FinanceActor,
) {
  const rider = await resolveSettlementRider(actor, input.riderId);
  const date = businessDay(input.businessDate);
  const [work, declaration, receipts, position] = await Promise.all([
    settlementWork(rider.id, date),
    prisma.riderSettlementDeclaration.findUnique({
      where: {
        riderId_businessDate: { riderId: rider.id, businessDate: date },
      },
    }),
    prisma.settlement.findMany({ where: { riderId: rider.id, businessDate: date }, include: { lines: true }, orderBy: { createdAt: "asc" } }),
    riderReceivablePosition(rider.id, date),
  ]);
  return {
    riderId: rider.id,
    businessDate: date,
    ...work,
    declaration,
    settlement: receipts.at(-1) ?? null,
    receipts,
    paidAmount: position.paidAmount,
    recognizedAmount: position.recognizedAmount,
    outstandingAmount: position.outstandingAmount,
  };
}

export async function listRiderOutstanding(
  input: { businessDate: string },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  const date = businessDay(input.businessDate);
  const riders = await prisma.rider.findMany({
    where:
      user.role === "SUPERADMIN"
        ? { user: { active: true } }
        : { hubId: user.hubId ?? "__none__", user: { active: true } },
    include: {
      user: { select: { name: true, username: true } },
      hub: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  const riderIds = riders.map((rider) => rider.id);
  if (riderIds.length === 0) return [];
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const [parcels, recognitions, declarations, receiptsForDate, cumulativeRecognitions, cumulativeReceipts] = await Promise.all([
    prisma.parcel.findMany({
      where: { riderId: { in: riderIds }, status: "DELIVERED", statusHistory: { some: { toStatus: "DELIVERED", createdAt: { gte: date, lt: nextDate } } } },
      include: { ways: { orderBy: [{ completedAt: "desc" }, { startedAt: "desc" }] }, linkGroup: { include: { parcels: { select: { id: true, status: true } } } } },
    }),
    prisma.riderReceivableRecognition.findMany({ where: { riderId: { in: riderIds }, businessDate: date, sourceType: { not: "RIDER_SALARY_DEDUCTION" } }, select: { riderId: true, codAmount: true, deliveryFee: true, commissionAmount: true } }),
    prisma.riderSettlementDeclaration.findMany({ where: { riderId: { in: riderIds }, businessDate: date } }),
    prisma.settlement.findMany({ where: { riderId: { in: riderIds }, businessDate: date }, include: { lines: true }, orderBy: { createdAt: "asc" } }),
    prisma.riderReceivableRecognition.groupBy({ by: ["riderId"], where: { riderId: { in: riderIds }, businessDate: { lt: nextDate } }, _sum: { receivableAmount: true } }),
    prisma.settlement.groupBy({ by: ["riderId"], where: { riderId: { in: riderIds }, businessDate: { lt: nextDate } }, _max: { actualAmount: true } }),
  ]);
  const parcelsByRider = new Map<string, typeof parcels>();
  for (const parcel of parcels) {
    const rows = parcelsByRider.get(parcel.riderId!) ?? [];
    rows.push(parcel);
    parcelsByRider.set(parcel.riderId!, rows);
  }
  const recognitionsByRider = new Map<string, typeof recognitions>();
  for (const recognition of recognitions) {
    const rows = recognitionsByRider.get(recognition.riderId) ?? [];
    rows.push(recognition);
    recognitionsByRider.set(recognition.riderId, rows);
  }
  const declarationByRider = new Map(declarations.map((row) => [row.riderId, row]));
  const receiptsByRider = new Map<string, typeof receiptsForDate>();
  for (const receipt of receiptsForDate) {
    const rows = receiptsByRider.get(receipt.riderId) ?? [];
    rows.push(receipt);
    receiptsByRider.set(receipt.riderId, rows);
  }
  const recognizedByRider = new Map(cumulativeRecognitions.map((row) => [row.riderId, row._sum.receivableAmount ?? 0]));
  const paidByRider = new Map(cumulativeReceipts.map((receipt) => [receipt.riderId, receipt._max.actualAmount ?? 0]));
  return riders.map((rider) => {
      const riderParcels = parcelsByRider.get(rider.id) ?? [];
      const totals = calculateRecognitionTotals(recognitionsByRider.get(rider.id) ?? []);
      const salaryDeduction = calculateDailySalaryDeduction(rider.monthlySalary, date, rider.payModel);
      const work = {
        parcelCount: riderParcels.length,
        payModel: rider.payModel,
        commissionRateBps: resolveCommissionRateBps(rider),
        parcels: riderParcels.map((parcel) => ({ id: parcel.id, trackingNumber: parcel.trackingNumber, orderId: parcel.orderId, codAmount: parcel.codAmount, deliveryFee: parcel.deliveryFee ?? 0, commissionAmount: parcel.ways.find((way) => way.outcome === "DELIVERED")?.commissionAmount ?? 0 })),
        ...totals,
        salaryDeduction,
        expectedAmount: totals.cod + totals.fees - totals.commission - salaryDeduction,
      };
      const declaration = declarationByRider.get(rider.id);
      const receipts = receiptsByRider.get(rider.id) ?? [];
      const recognizedAmount = recognizedByRider.get(rider.id) ?? 0;
      const paidAmount = paidByRider.get(rider.id) ?? 0;
      const position = { recognizedAmount, paidAmount, outstandingAmount: Math.max(0, recognizedAmount - paidAmount) };
      const settlement = receipts.at(-1) ?? null;
      return {
        rider: {
          id: rider.id,
          name: rider.user.name,
          username: rider.user.username,
          hubName: rider.hub?.name ?? null,
        },
        businessDate: date,
        ...work,
        declaredAmount: declaration
          ? declaration.cash + declaration.kbzPay + declaration.wavePay
          : null,
        paidAmount: position.paidAmount,
        recognizedAmount: position.recognizedAmount,
        outstandingAmount: position.outstandingAmount,
        declarationStatus: declaration?.status ?? null,
        settlementStatus: settlement?.status ?? null,
        settlement,
        receipts,
      };
    });
}

export async function declareRiderSettlement(
  input: {
    businessDate: string;
    cash: number;
    kbzPay: number;
    wavePay: number;
    note?: string;
  },
  actor: FinanceActor,
) {
  assertWallets(input);
  const rider = await resolveSettlementRider(actor);
  const date = businessDay(input.businessDate);
  // A partial receipt does not close the day. The rider may revise the
  // remaining declaration until cumulative receipts settle the receivable.
  return prisma.riderSettlementDeclaration.upsert({
    where: { riderId_businessDate: { riderId: rider.id, businessDate: date } },
    update: {
      cash: input.cash,
      kbzPay: input.kbzPay,
      wavePay: input.wavePay,
      note: input.note?.trim() || null,
      status: "DECLARED",
    },
    create: {
      riderId: rider.id,
      businessDate: date,
      cash: input.cash,
      kbzPay: input.kbzPay,
      wavePay: input.wavePay,
      note: input.note?.trim() || null,
    },
  });
}

export function settlementWalletMismatch(
  declared: { cash: number; kbzPay: number; wavePay: number },
  verified: { cash: number; kbzPay: number; wavePay: number },
) {
  return (
    declared.cash !== verified.cash ||
    declared.kbzPay !== verified.kbzPay ||
    declared.wavePay !== verified.wavePay
  );
}

export function cumulativeReceiptPosition(input: {
  expectedAmount: number;
  previouslyPaid: number;
  receiptAmount: number;
}) {
  const paidAmount = input.previouslyPaid + input.receiptAmount;
  return {
    paidAmount,
    variance: paidAmount - input.expectedAmount,
    status: paidAmount === input.expectedAmount ? "SETTLED" : "PARTIAL",
  } as const;
}

export function addWalletAmounts(
  prior: { cash: number; kbzPay: number; wavePay: number },
  receipt: { cash: number; kbzPay: number; wavePay: number },
) {
  return {
    cash: prior.cash + receipt.cash,
    kbzPay: prior.kbzPay + receipt.kbzPay,
    wavePay: prior.wavePay + receipt.wavePay,
  };
}

export async function createRiderSettlement(
  input: {
    riderId: string;
    businessDate: string;
    cash: number;
    kbzPay: number;
    wavePay: number;
    varianceReason?: string;
    manualEntryReason?: string;
    idempotencyKey: string;
  },
  actor: FinanceActor,
) {
  assertWallets(input);
  const rider = await assertRiderScope(input.riderId, actor);
  const date = businessDay(input.businessDate);
  if (!rider.hubId)
    throw new ApiError(409, "RIDER_HUB_REQUIRED", "Rider must belong to a hub");
  const riderHubId = rider.hubId;
  const existingForKey = async () => {
    const existing = await prisma.settlement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
    if (!existing) return null;
    if (existing.riderId !== input.riderId || existing.businessDate.getTime() !== date.getTime() || existing.lines.find((line) => line.wallet === "CASH")?.amount !== input.cash || existing.lines.find((line) => line.wallet === "KBZ_PAY")?.amount !== input.kbzPay || existing.lines.find((line) => line.wallet === "WAVE_PAY")?.amount !== input.wavePay) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different rider receipt");
    return existing;
  };
  const existing = await existingForKey();
  if (existing) return existing;
  try {
    return await prisma.$transaction(
    async (tx) => {
      const existing = await tx.settlement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
      if (existing) {
        if (existing.riderId !== input.riderId || existing.businessDate.getTime() !== date.getTime() || existing.lines.find((line) => line.wallet === "CASH")?.amount !== input.cash || existing.lines.find((line) => line.wallet === "KBZ_PAY")?.amount !== input.kbzPay || existing.lines.find((line) => line.wallet === "WAVE_PAY")?.amount !== input.wavePay) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different rider receipt");
        return existing;
      }
      await assertCashbookOpen(tx, date, riderHubId);
      const { cod, fees, commission, salaryDeduction } = await settlementWork(
        input.riderId,
        date,
        tx,
      );
      const amounts = calculateRiderSettlementAmounts({
        cod,
        fees,
        commission,
        salaryDeduction,
        ...input,
      });
      let appliedSalaryDeduction = 0;
      if (salaryDeduction > 0) {
        const salarySourceId = `${input.riderId}:${input.businessDate}`;
        const priorSalary = await tx.riderReceivableRecognition.findUnique({ where: { sourceType_sourceId: { sourceType: "RIDER_SALARY_DEDUCTION", sourceId: salarySourceId } } });
        if (!priorSalary) {
          await tx.riderReceivableRecognition.create({ data: { sourceType: "RIDER_SALARY_DEDUCTION", sourceId: salarySourceId, riderId: input.riderId, hubId: riderHubId, businessDate: date, codAmount: 0, deliveryFee: 0, commissionAmount: salaryDeduction, receivableAmount: -salaryDeduction } });
          appliedSalaryDeduction = salaryDeduction;
        }
      }
      const position = await riderReceivablePosition(input.riderId, date, tx);
      if (amounts.actualAmount <= 0) throw new ApiError(400, "RECEIPT_AMOUNT_REQUIRED", "A rider receipt must contain a positive wallet amount");
      if (amounts.actualAmount > position.outstandingAmount) throw new ApiError(409, "RECEIPT_EXCEEDS_OUTSTANDING", "Receipt cannot exceed the rider's outstanding balance");
      let declaration = await tx.riderSettlementDeclaration.findUnique({
        where: {
          riderId_businessDate: { riderId: input.riderId, businessDate: date },
        },
      });
      let createdManualDeclaration = false;
      if (!declaration && input.manualEntryReason?.trim()) {
        declaration = await tx.riderSettlementDeclaration.create({
          data: {
            riderId: input.riderId,
            businessDate: date,
            cash: input.cash,
            kbzPay: input.kbzPay,
            wavePay: input.wavePay,
            note: `Manual finance entry: ${input.manualEntryReason.trim()}`,
          },
        });
        createdManualDeclaration = true;
      }
      if (!declaration || !["DECLARED", "VERIFIED"].includes(declaration.status))
        throw new ApiError(
          409,
          "DECLARATION_REQUIRED",
          "A current rider declaration or a manual-entry reason is required before verification",
        );
      const isManualDeclaration = declaration.note?.startsWith("Manual finance entry:") ?? false;
      const declaredWallets = isManualDeclaration && !createdManualDeclaration
        ? addWalletAmounts(declaration, input)
        : { cash: declaration.cash, kbzPay: declaration.kbzPay, wavePay: declaration.wavePay };
      const verifiedWallets = addWalletAmounts(
        { cash: declaration.verifiedCash ?? 0, kbzPay: declaration.verifiedKbzPay ?? 0, wavePay: declaration.verifiedWavePay ?? 0 },
        input,
      );
      const cumulative = cumulativeReceiptPosition({
        expectedAmount: position.recognizedAmount,
        previouslyPaid: position.paidAmount,
        receiptAmount: amounts.actualAmount,
      });
      const walletMismatch = cumulative.status === "SETTLED" && settlementWalletMismatch(declaredWallets, verifiedWallets);
      if (walletMismatch && !input.varianceReason?.trim())
        throw new ApiError(
          400,
          "SETTLEMENT_VARIANCE_REASON_REQUIRED",
          "A wallet variance reason is required",
        );
      const settlement = await tx.settlement.create({
        data: {
          riderId: input.riderId,
          businessDate: date,
          expectedAmount: position.recognizedAmount,
          // Cumulative paid amount is the reconciliation snapshot; this
          // receipt's immutable wallet evidence remains in SettlementLine.
          actualAmount: cumulative.paidAmount,
          variance: cumulative.variance,
          salaryDeduction: appliedSalaryDeduction,
          status: cumulative.status,
          idempotencyKey: input.idempotencyKey,
          lines: {
            create: [
              { wallet: "CASH", amount: input.cash },
              { wallet: "KBZ_PAY", amount: input.kbzPay },
              { wallet: "WAVE_PAY", amount: input.wavePay },
            ],
          },
        },
        include: { lines: true },
      });
      const walletLines = [
        { account: "WALLET_CASH", debit: input.cash, credit: 0 },
        { account: "WALLET_KBZ_PAY", debit: input.kbzPay, credit: 0 },
        { account: "WALLET_WAVE_PAY", debit: input.wavePay, credit: 0 },
      ];
      const receivableLines = buildRiderSettlementReceivableLines(amounts.actualAmount, appliedSalaryDeduction);
      await tx.journalEntry.create({
        data: {
          sourceType: "RIDER_SETTLEMENT",
          sourceId: settlement.id,
          hubId: riderHubId,
          businessDate: date,
          description:
            appliedSalaryDeduction > 0
              ? `Rider settlement for ${input.riderId} (salary deduction ${appliedSalaryDeduction})`
              : `Rider settlement for ${input.riderId}`,
          lines: { create: [...walletLines.filter((line) => line.debit > 0), ...receivableLines] },
        },
      });
      const verifiedAt = new Date();
      const updatedDeclaration = await tx.riderSettlementDeclaration.updateMany(
        {
          where: {
            id: declaration.id,
            updatedAt: declaration.updatedAt,
          },
          data: {
            status: "VERIFIED",
            ...(isManualDeclaration ? declaredWallets : {}),
            verifiedCash: verifiedWallets.cash,
            verifiedKbzPay: verifiedWallets.kbzPay,
            verifiedWavePay: verifiedWallets.wavePay,
            verifiedAt,
            verifiedBy: actor.id,
            varianceReason: walletMismatch
              ? input.varianceReason!.trim()
              : null,
            varianceApprovedAt: walletMismatch ? verifiedAt : null,
            varianceApprovedBy: walletMismatch ? actor.id : null,
          },
        },
      );
      if (updatedDeclaration.count !== 1)
        throw new ApiError(
          409,
          "DECLARATION_CONFLICT",
          "Rider declaration changed; refresh and retry",
        );
      return settlement;
    },
    { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) {
      const raced = await existingForKey();
      if (raced) return raced;
      throw new ApiError(409, "RETRYABLE_CONFLICT", "Rider settlement changed concurrently; retry with the same idempotency key");
    }
    throw error;
  }
}
