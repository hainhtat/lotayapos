import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { resolveCommissionRateBps } from "../utils/commission.js";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  buildOsSettlementReturnDeductionLines,
  getActiveReturnDeduction,
  postReturnDeductionInTx,
  recoverableAdvance,
  recoverableAdvanceAmount,
  settlementReturnedAdvanceContribution,
  sumUnreversedCreditsToOsAdvanceReceivableByParcel,
  sumUnreversedDebitsToOsSettlementOffsetByParcel,
} from "./os-advance.js";

function businessDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
export function calculateRiderSettlementAmounts(input: {
  cod: number;
  fees: number;
  commission: number;
  cash: number;
  kbzPay: number;
  wavePay: number;
  /** Daily salary deduction (pro-rata of monthlySalary); reduces expected remittance. */
  salaryDeduction?: number;
}) {
  const salaryDeduction = input.salaryDeduction ?? 0;
  if (!Number.isInteger(salaryDeduction) || salaryDeduction < 0) {
    throw new ApiError(
      400,
      "INVALID_SALARY_DEDUCTION",
      "Salary deduction must be a non-negative integer",
    );
  }
  const expectedAmount =
    input.cod + input.fees - input.commission - salaryDeduction;
  const actualAmount = input.cash + input.kbzPay + input.wavePay;
  return {
    expectedAmount,
    actualAmount,
    variance: actualAmount - expectedAmount,
    salaryDeduction,
  };
}

export function buildRiderSettlementReceivableLines(actualAmount: number, salaryDeduction: number) {
  if (!Number.isInteger(actualAmount) || actualAmount < 0 || !Number.isInteger(salaryDeduction) || salaryDeduction < 0)
    throw new ApiError(400, "INVALID_SETTLEMENT_AMOUNT", "Settlement and salary amounts must be non-negative integers");
  return salaryDeduction > 0
    ? [
        { account: "RIDER_RECEIVABLE", debit: 0, credit: actualAmount + salaryDeduction },
        { account: "RIDER_RECEIVABLE", debit: salaryDeduction, credit: 0 },
      ]
    : [{ account: "RIDER_RECEIVABLE", debit: 0, credit: actualAmount }];
}

/** Daily salary share for settlement day: floor(monthlySalary / daysInMonth). */
export function calculateDailySalaryDeduction(
  monthlySalary: number | null | undefined,
  businessDate: Date,
  payModel: string | null | undefined,
) {
  if (payModel !== "SALARY" && payModel !== "SALARY_PLUS_PERCENTAGE") return 0;
  if (!Number.isInteger(monthlySalary) || !monthlySalary || monthlySalary <= 0)
    return 0;
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(monthlySalary / daysInMonth);
}
export type SettlementParcel = {
  codAmount: number;
  deliveryFee: number;
  commissionAmount: number;
  linkGroup?: {
    id: string;
    totalDeliveryFee: number;
    parcelStatuses: string[];
  } | null;
};
export function calculateRecognitionTotals(
  recognitions: Array<{ codAmount: number; deliveryFee: number; commissionAmount: number }>,
) {
  return recognitions.reduce(
    (sum, recognition) => ({
      cod: sum.cod + recognition.codAmount,
      fees: sum.fees + recognition.deliveryFee,
      commission: sum.commission + recognition.commissionAmount,
    }),
    { cod: 0, fees: 0, commission: 0 },
  );
}
export function calculateRiderSettlementTotals(
  parcels: SettlementParcel[],
  commissionRateBps: number,
) {
  const countedGroups = new Set<string>();
  return parcels.reduce(
    (totals, parcel) => {
      totals.cod += parcel.codAmount;
      if (parcel.linkGroup) {
        // Incomplete linked groups do not settle member fees/commission individually.
        if (
          !parcel.linkGroup.parcelStatuses.every(
            (status) => status === "DELIVERED",
          )
        )
          return totals;
        if (!countedGroups.has(parcel.linkGroup.id)) {
          countedGroups.add(parcel.linkGroup.id);
          totals.fees += parcel.linkGroup.totalDeliveryFee;
          totals.commission += Math.round(
            (parcel.linkGroup.totalDeliveryFee * commissionRateBps) / 10000,
          );
        }
        return totals;
      }
      totals.fees += parcel.deliveryFee;
      totals.commission += parcel.commissionAmount;
      return totals;
    },
    { cod: 0, fees: 0, commission: 0 },
  );
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
const financeRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER"];
const financeReadRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"];
export type FinanceActor = { id: string; role: string };

async function assertFinanceActor(actor: FinanceActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true, active: true, hubId: true },
  });
  if (
    !user ||
    !user.active ||
    user.role !== actor.role ||
    !financeRoles.includes(user.role)
  )
    throw new ApiError(403, "FORBIDDEN", "Active finance scope required");
  return user;
}

async function assertFinanceReadActor(actor: FinanceActor) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true, active: true, hubId: true },
  });
  if (
    !user ||
    !user.active ||
    user.role !== actor.role ||
    !financeReadRoles.includes(user.role)
  )
    throw new ApiError(403, "FORBIDDEN", "Active finance read scope required");
  return user;
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
  if (!financeRoles.includes(user.role) || !requestedRiderId)
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
    prisma.settlement.findMany({
      where: { businessDate: { lt: throughDate }, rider: { ...(hubId ? { hubId } : {}), user: { active: true } } },
      select: { riderId: true, lines: { select: { amount: true } } },
    }),
  ]);
  const paidByRider = new Map<string, number>();
  for (const receipt of receipts) paidByRider.set(receipt.riderId, (paidByRider.get(receipt.riderId) ?? 0) + receipt.lines.reduce((sum, line) => sum + line.amount, 0));
  const paid = [...paidByRider].map(([riderId, actualAmount]) => ({ riderId, _sum: { actualAmount } }));
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
  return Promise.all(
    riders.map(async (rider) => {
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
    }),
  );
}

export async function listOsSettlementDrafts(
  input: { shopId?: string },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  const batches = await prisma.batch.findMany({
    where: {
      ...(input.shopId ? { shopId: input.shopId } : {}),
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

function osBatchComponents(
  batch: {
    advancePaid: number;
    parcels: Array<{
      id: string;
      status: string;
      codAmount: number;
      actualCodCollected: number | null;
      deliveryFee: number | null;
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
    if (["DELIVERED", "PARTIAL"].includes(parcel.status)) return sum + (parcel.deliveryFee ?? 0);
    if (parcel.status === "RETURNED" && parcel.actualCodCollected != null) return sum + (parcel.deliveryFee ?? 0);
    return sum;
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
  const batches = await prisma.batch.findMany({ where: { id: { in: batchIds } }, include: { shop: true, parcels: { select: { id: true, status: true, codAmount: true, actualCodCollected: true, deliveryFee: true, advanceAmount: true } }, settlementLinks: { where: { settlement: { status: "POSTED" } }, select: { id: true } } } });
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
  const existing = await prisma.osSettlement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { batches: true, journalEntry: { include: { lines: true } } } });
  if (existing) {
    const requestedIds = [...new Set(input.batchIds)].sort();
    const existingIds = existing.batches.map((batch) => batch.batchId).sort();
    if (existing.shopId !== input.shopId || existing.businessDate.getTime() !== businessDay(input.businessDate).getTime() || existing.wallet !== input.wallet || requestedIds.join("|") !== existingIds.join("|") || (input.advanceDeduction ?? existing.advanceDeduction) !== existing.advanceDeduction || (input.returnDeduction ?? existing.returnDeduction) !== existing.returnDeduction || (input.deliveryFeeDeduction ?? existing.deliveryFeeDeduction) !== existing.deliveryFeeDeduction || (input.adjustmentAmount ?? 0) !== existing.adjustmentAmount || (input.adjustmentReason?.trim() || null) !== existing.adjustmentReason) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different OS settlement");
    return existing;
  }
  if (await prisma.osBatchObligation.count({ where: { batchId: { in: input.batchIds } } })) throw new ApiError(409, "OS_ACCOUNT_CUTOVER", "Use OS outstanding payments for finalized batches; legacy settlements are read-only");
  const preview = await previewOsSettlement(input, actor);
  const date = businessDay(input.businessDate);
  const maximums = preview.defaults;
  const adjustmentAmount = input.adjustmentAmount ?? 0;
  if (adjustmentAmount !== 0 && !input.adjustmentReason?.trim()) throw new ApiError(400, "ADJUSTMENT_REASON_REQUIRED", "A reason is required for a settlement adjustment");
  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, preview.hubId);
    const batchIds = [...new Set(input.batchIds)];
    const stillEligible = await tx.batch.count({ where: { id: { in: batchIds }, shopId: input.shopId, hubId: preview.hubId, parcels: { every: { status: { in: ["DELIVERED", "PARTIAL", "RETURNED", "CANCELLED"] } } } } });
    if (stillEligible !== batchIds.length) throw new ApiError(409, "BATCH_CHANGED", "One or more batches changed; refresh the settlement preview");
    const activeLinks = await tx.osSettlementBatch.findMany({ where: { batchId: { in: batchIds }, settlement: { status: "POSTED" } } });
    if (activeLinks.length) throw new ApiError(409, "BATCH_ALREADY_SETTLED", "One or more batches were settled while this statement was open");
    const liveBatches = await tx.batch.findMany({
      where: { id: { in: batchIds } },
      include: { parcels: { select: { id: true, status: true, codAmount: true, actualCodCollected: true, deliveryFee: true, advanceAmount: true } } },
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
}

type EditableOsSettlementComponents = {
  advanceDeduction: number;
  returnDeduction: number;
  deliveryFeeDeduction: number;
  adjustmentAmount: number;
  adjustmentReason?: string;
};

function replayMatchesComponents(afterJson: string, input: EditableOsSettlementComponents & { wallet?: string }) {
  const prior = JSON.parse(afterJson) as Record<string, unknown>;
  return prior.advanceDeduction === input.advanceDeduction
    && prior.returnDeduction === input.returnDeduction
    && prior.deliveryFeeDeduction === input.deliveryFeeDeduction
    && prior.adjustmentAmount === input.adjustmentAmount
    && (prior.adjustmentReason ?? null) === (input.adjustmentReason?.trim() || null)
    && (input.wallet === undefined || prior.wallet === input.wallet);
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

function validateEditableSettlementComponents(
  values: EditableOsSettlementComponents,
  maximums: { grossCollectedCod: number; advanceDeduction: number; returnDeduction: number; deliveryFeeDeduction: number },
) {
  for (const [field, value, maximum] of [
    ["advanceDeduction", values.advanceDeduction, maximums.advanceDeduction],
    ["returnDeduction", values.returnDeduction, maximums.returnDeduction],
    ["deliveryFeeDeduction", values.deliveryFeeDeduction, maximums.deliveryFeeDeduction],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > maximum)
      throw new ApiError(400, "INVALID_SETTLEMENT_COMPONENT", `${field} must be between zero and its statement maximum`);
  }
  const adjustmentLimit = maximums.grossCollectedCod + maximums.advanceDeduction + maximums.returnDeduction + maximums.deliveryFeeDeduction;
  if (!Number.isInteger(values.adjustmentAmount) || Math.abs(values.adjustmentAmount) > adjustmentLimit)
    throw new ApiError(400, "INVALID_SETTLEMENT_ADJUSTMENT", "Adjustment is outside the statement bounds");
  if (values.adjustmentAmount !== 0 && !values.adjustmentReason?.trim())
    throw new ApiError(400, "ADJUSTMENT_REASON_REQUIRED", "A reason is required for a settlement adjustment");
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
  return prisma.$transaction(async (tx) => {
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
  return prisma.$transaction(async (tx) => {
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
}

function supportsOrgWideFinanceRead(user: { role: string; hubId: string | null }) {
  return user.role === "SUPERADMIN" || (user.role === "AUDITOR" && !user.hubId);
}

async function resolveFinanceListHub(actor: FinanceActor, requestedHubId?: string) {
  const user = await assertFinanceReadActor(actor);
  if (supportsOrgWideFinanceRead(user)) {
    if (requestedHubId) return resolveFinanceHubForRead(actor, requestedHubId);
    return undefined;
  }
  return resolveFinanceHubForRead(actor, requestedHubId);
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
) {
  const user = await assertFinanceActor(actor);
  const date = businessDay(input.businessDate);
  const idempotencyKey = input.idempotencyKey.trim();

  return prisma.$transaction(async (tx) => {
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
      return tx.osReturnCredit.create({ data: { id: creditId, parcelId: parcel.id, batchId: parcel.batchId, shopId: parcel.batch.shopId, hubId, amount: parcel.codAmount, businessDate: date, idempotencyKey: `return:${idempotencyKey}`, postedBy: actor.id, journalEntryId: journal?.id } });
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
  }, { isolationLevel: "Serializable" });
}

export async function getOsSettlement(id: string, actor: FinanceActor) {
  const user = await assertFinanceReadActor(actor);
  const settlement = await prisma.osSettlement.findUnique({ where: { id }, include: { shop: true, batches: { include: { batch: true } }, journalEntry: { include: { lines: true } } } });
  if (!settlement) throw new ApiError(404, "OS_SETTLEMENT_NOT_FOUND", "OS settlement not found");
  if (user.role !== "SUPERADMIN" && settlement.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Settlement is outside your hub scope");
  const chainIds = new Set<string>([settlement.id]);
  let predecessorId = settlement.supersedesId;
  let rootId = settlement.id;
  while (predecessorId && !chainIds.has(predecessorId)) {
    chainIds.add(predecessorId);
    rootId = predecessorId;
    const predecessor = await prisma.osSettlement.findUnique({ where: { id: predecessorId }, select: { supersedesId: true } });
    predecessorId = predecessor?.supersedesId ?? null;
  }
  let successorOf = rootId;
  while (true) {
    const successor = await prisma.osSettlement.findUnique({ where: { supersedesId: successorOf }, select: { id: true } });
    if (!successor) break;
    const seen = chainIds.has(successor.id);
    chainIds.add(successor.id);
    successorOf = successor.id;
    if (seen && successor.id === rootId) break;
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
  return prisma.$transaction(async (tx) => {
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

export async function assertCashbookOpen(
  tx: Prisma.TransactionClient,
  date: Date,
  hubId: string,
) {
  const day = await tx.cashbookDay.findFirst({
    where: { hubId, businessDate: date },
    select: { closedAt: true },
  });
  if (day?.closedAt)
    throw new ApiError(409, "DAY_CLOSED", "Cashbook day is already closed");
}

async function resolveHubFromUser(
  user: { role: string; hubId: string | null },
  requestedHubId?: string,
) {
  if (user.role === "SUPERADMIN") {
    if (!requestedHubId)
      throw new ApiError(400, "HUB_REQUIRED", "Superadmin must select a hub");
    const hub = await prisma.hub.findUnique({
      where: { id: requestedHubId },
      select: { id: true },
    });
    if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");
    return hub.id;
  }
  if (!user.hubId || (requestedHubId && requestedHubId !== user.hubId))
    throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  return user.hubId;
}

async function resolveFinanceHub(actor: FinanceActor, requestedHubId?: string) {
  return resolveHubFromUser(await assertFinanceActor(actor), requestedHubId);
}

async function resolveFinanceHubForRead(actor: FinanceActor, requestedHubId?: string) {
  return resolveHubFromUser(await assertFinanceReadActor(actor), requestedHubId);
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

type CashbookWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";
type CashbookPostingActor = FinanceActor;

const walletAccounts: Record<CashbookWallet, string> = {
  CASH: "WALLET_CASH",
  KBZ_PAY: "WALLET_KBZ_PAY",
  WAVE_PAY: "WALLET_WAVE_PAY",
};

function walletAccount(wallet: CashbookWallet) {
  const account = walletAccounts[wallet];
  if (!account)
    throw new ApiError(
      400,
      "INVALID_WALLET",
      "Wallet must be Cash, KBZ Pay, or Wave Pay",
    );
  return account;
}

export function buildExpenseLines(
  categoryCode: string,
  wallet: CashbookWallet,
  amount: number,
) {
  positiveAmount(amount, "amount");
  return [
    { account: `EXPENSE:${categoryCode}`, debit: amount, credit: 0 },
    { account: walletAccount(wallet), debit: 0, credit: amount },
  ];
}

export async function listExpenseCategories(actor: FinanceActor) {
  await assertFinanceActor(actor);
  return prisma.expenseCategory.findMany({ orderBy: { code: "asc" } });
}

export async function createExpenseCategory(
  input: { code: string; nameEn: string; nameMy: string },
  actor: FinanceActor,
) {
  const user = await assertFinanceActor(actor);
  if (user.role !== "SUPERADMIN")
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only Superadmin may create expense categories",
    );
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.expenseCategory.findUnique({
    where: { code },
    select: { id: true },
  });
  if (existing)
    throw new ApiError(
      409,
      "EXPENSE_CATEGORY_EXISTS",
      "Expense category already exists",
    );
  return prisma.expenseCategory.create({
    data: { code, nameEn: input.nameEn.trim(), nameMy: input.nameMy.trim() },
  });
}

export async function listExpenses(
  input: { businessDate?: string; hubId?: string },
  actor: FinanceActor,
) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = input.businessDate ? businessDay(input.businessDate) : undefined;
  return prisma.expenseEntry.findMany({
    where: { hubId, ...(date ? { businessDate: date } : {}) },
    include: { category: true },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function postExpense(
  input: {
    businessDate: string;
    hubId?: string;
    categoryId: string;
    wallet: CashbookWallet;
    amount: number;
    description: string;
    idempotencyKey: string;
  },
  actor: FinanceActor,
) {
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  const description = input.description.trim();
  positiveAmount(input.amount, "amount");
  const existingForKey = async () => {
    const existing = await prisma.expenseEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { category: true },
    });
    if (!existing) return null;
    if (
      existing.actorId !== actor.id ||
      existing.hubId !== hubId ||
      existing.categoryId !== input.categoryId ||
      existing.wallet !== input.wallet ||
      existing.amount !== input.amount ||
      existing.description !== description ||
      existing.businessDate.getTime() !== date.getTime()
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for a different expense",
      );
    }
    return existing;
  };
  const existing = await existingForKey();
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      await assertCashbookOpen(tx, date, hubId);
      const category = await tx.expenseCategory.findUnique({
        where: { id: input.categoryId },
      });
      if (!category || !category.active)
        throw new ApiError(
          400,
          "INVALID_EXPENSE_CATEGORY",
          "Expense category is unavailable",
        );
      const expenseId = randomUUID();
      const journal = await tx.journalEntry.create({
        data: {
          sourceType: "CASHBOOK_EXPENSE",
          sourceId: expenseId,
          hubId,
          businessDate: date,
          description,
          lines: {
            create: buildExpenseLines(
              category.code,
              input.wallet,
              input.amount,
            ),
          },
        },
      });
      return tx.expenseEntry.create({
        data: {
          id: expenseId,
          hubId,
          categoryId: category.id,
          wallet: input.wallet,
          businessDate: date,
          description,
          amount: input.amount,
          actorId: actor.id,
          journalEntryId: journal.id,
          idempotencyKey: input.idempotencyKey,
        },
        include: { category: true },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const raced = await existingForKey();
      if (raced) return raced;
    }
    throw error;
  }
}

function positiveAmount(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0)
    throw new ApiError(
      400,
      "INVALID_AMOUNT",
      `${field} must be a positive integer`,
    );
}

function journalSource(sourceType: string) {
  return { sourceType, sourceId: randomUUID() };
}

async function assertCashbookPostingAccess(actor: CashbookPostingActor) {
  await assertFinanceActor(actor);
}

export function buildOpeningBalanceLines(
  wallet: CashbookWallet,
  amount: number,
) {
  positiveAmount(amount, "amount");
  return [
    { account: walletAccount(wallet), debit: amount, credit: 0 },
    { account: "OPENING_BALANCE_EQUITY", debit: 0, credit: amount },
  ];
}

export function buildWalletTransferLines(
  fromWallet: CashbookWallet,
  toWallet: CashbookWallet,
  amount: number,
) {
  positiveAmount(amount, "amount");
  if (fromWallet === toWallet)
    throw new ApiError(
      400,
      "INVALID_TRANSFER",
      "Source and destination wallets must differ",
    );
  return [
    { account: walletAccount(toWallet), debit: amount, credit: 0 },
    { account: walletAccount(fromWallet), debit: 0, credit: amount },
  ];
}

export function buildCashbookAdjustmentLines(
  wallet: CashbookWallet,
  amount: number,
  direction: "INCREASE" | "DECREASE",
) {
  positiveAmount(amount, "amount");
  if (direction === "INCREASE")
    return [
      { account: walletAccount(wallet), debit: amount, credit: 0 },
      { account: "CASHBOOK_ADJUSTMENT", debit: 0, credit: amount },
    ];
  return [
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
  },
  actor: CashbookPostingActor,
) {
  await assertCashbookPostingAccess(actor);
  const hubId = await resolveFinanceHub(actor, input.hubId);
  const date = businessDay(input.businessDate);
  return prisma.$transaction(async (tx) => {
    await assertCashbookOpen(tx, date, hubId);
    const source = journalSource(input.sourceType);
    const entry = await tx.journalEntry.create({
      data: {
        ...source,
        hubId,
        businessDate: date,
        description: `${input.description}: ${input.reason}`,
        lines: { create: input.lines },
      },
      include: { lines: true },
    });
    return entry;
  });
}

export async function postOpeningBalance(
  input: {
    businessDate: string;
    hubId?: string;
    wallet: CashbookWallet;
    amount: number;
    reason: string;
  },
  actor: CashbookPostingActor,
) {
  return postCashbookJournal(
    {
      ...input,
      sourceType: "CASHBOOK_OPENING_BALANCE",
      description: `Opening balance for ${input.wallet}`,
      lines: buildOpeningBalanceLines(input.wallet, input.amount),
    },
    actor,
  );
}

export async function postWalletTransfer(
  input: {
    businessDate: string;
    hubId?: string;
    fromWallet: CashbookWallet;
    toWallet: CashbookWallet;
    amount: number;
    reason: string;
  },
  actor: CashbookPostingActor,
) {
  return postCashbookJournal(
    {
      ...input,
      sourceType: "CASHBOOK_TRANSFER",
      description: `Wallet transfer ${input.fromWallet} to ${input.toWallet}`,
      lines: buildWalletTransferLines(
        input.fromWallet,
        input.toWallet,
        input.amount,
      ),
    },
    actor,
  );
}

export async function postCashbookAdjustment(
  input: {
    businessDate: string;
    hubId?: string;
    wallet: CashbookWallet;
    amount: number;
    direction: "INCREASE" | "DECREASE";
    reason: string;
  },
  actor: CashbookPostingActor,
) {
  return postCashbookJournal(
    {
      ...input,
      sourceType: "CASHBOOK_ADJUSTMENT",
      description: `${input.direction.toLowerCase()} ${input.wallet} adjustment`,
      lines: buildCashbookAdjustmentLines(
        input.wallet,
        input.amount,
        input.direction,
      ),
    },
    actor,
  );
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
  return prisma.$transaction(
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
  });
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
  });
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
  });
}
export async function ledgerSummary() {
  const lines = await prisma.journalLine.groupBy({
    by: ["account"],
    _sum: { debit: true, credit: true },
  });
  return lines.map((line) => ({
    account: line.account,
    debit: line._sum.debit ?? 0,
    credit: line._sum.credit ?? 0,
    balance: (line._sum.debit ?? 0) - (line._sum.credit ?? 0),
  }));
}
