import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";
import { businessDateUtcBoundary, nextCalendarDate } from "../utils/business-date.js";

export type ReportActor = { id: string; role: string };

type ReportLine = {
  id: string;
  account: string;
  debit: number;
  credit: number;
  entryId: string;
};

type ReportEntry = {
  id: string;
  sourceType: string;
  sourceId: string | null;
  businessDate: Date;
  description: string;
  hubId: string;
  lines: ReportLine[];
};

const reportRoles = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"];
const returnSourceTypes = new Set(["OS_RETURN_DEDUCTION", "OS_PARTIAL_RETURN_ADJUSTMENT"]);
export const MAX_REPORT_DAYS = 366;
export const MAX_REPORT_ROWS = 5_000;

const parseBusinessDate = (value: string) => businessDateUtcBoundary(value, env.hubTimezone);
const exclusiveEnd = (value: string) => businessDateUtcBoundary(nextCalendarDate(value), env.hubTimezone);

function assertReportRange(fromValue: string, toValue: string, from: Date, to: Date) {
  if (from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "Report start date must not be after end date");
  const calendarDays = (Date.parse(`${toValue}T00:00:00Z`) - Date.parse(`${fromValue}T00:00:00Z`)) / 86_400_000 + 1;
  if (calendarDays > MAX_REPORT_DAYS)
    throw new ApiError(400, "REPORT_RANGE_TOO_LARGE", `Report range cannot exceed ${MAX_REPORT_DAYS} calendar days`);
}

function assertReportRows<T>(rows: T[]) {
  if (rows.length > MAX_REPORT_ROWS)
    throw new ApiError(400, "REPORT_TOO_LARGE", `Report contains more than ${MAX_REPORT_ROWS} rows; narrow the filters or date range`);
  return rows;
}

async function resolveReportHub(actor: ReportActor, requestedHubId?: string) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { active: true, role: true, hubId: true },
  });
  if (!user?.active || user.role !== actor.role || !reportRoles.includes(user.role))
    throw new ApiError(403, "FORBIDDEN", "Active financial report scope required");
  if (user.role === "SUPERADMIN") {
    if (!requestedHubId) throw new ApiError(400, "HUB_REQUIRED", "Superadmin must select a hub");
    const hub = await prisma.hub.findUnique({ where: { id: requestedHubId }, select: { id: true } });
    if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");
    return hub.id;
  }
  if (!user.hubId || (requestedHubId && requestedHubId !== user.hubId))
    throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  return user.hubId;
}

const netDebit = (lines: ReportLine[], account: string) =>
  lines.filter((line) => line.account === account).reduce((sum, line) => sum + line.debit - line.credit, 0);
const netCredit = (lines: ReportLine[], account: string) => -netDebit(lines, account);

export function summarizeProfitEntries(entries: ReportEntry[], reversalTypes = new Map<string, string>(), settlementSalaryByEntry = new Map<string, number>()) {
  let deliveryFeeRevenue = 0;
  let riderCommissionCost = 0;
  let riderSalaryCost = 0;
  let returnAdvanceRecovery = 0;
  let expenseCost = 0;
  let adjustmentContribution = 0;

  const journalEntries = entries.map((entry) => {
    const effectiveSourceType = entry.sourceType === "LEDGER_REVERSAL"
      ? reversalTypes.get(entry.sourceId ?? "") ?? entry.sourceType
      : entry.sourceType;
    const fee = netCredit(entry.lines, "DELIVERY_FEE_REVENUE");
    const commission = netDebit(entry.lines, "RIDER_COMMISSION_EXPENSE");
    const salary = settlementSalaryByEntry.get(entry.id) ?? (effectiveSourceType === "RIDER_SALARY_DEDUCTION"
      ? netDebit(entry.lines, "RIDER_COMMISSION_PAYABLE")
      : 0);
    const returns = returnSourceTypes.has(effectiveSourceType)
      ? netCredit(entry.lines, "OS_ADVANCE_RECEIVABLE")
      : 0;
    const expenses = entry.lines
      .filter((line) => line.account.startsWith("EXPENSE:"))
      .reduce((sum, line) => sum + line.debit - line.credit, 0);
    const adjustments = netCredit(entry.lines, "CASHBOOK_ADJUSTMENT")
      + netCredit(entry.lines, "OS_SETTLEMENT_ADJUSTMENT");
    deliveryFeeRevenue += fee;
    riderCommissionCost += commission;
    riderSalaryCost += salary;
    returnAdvanceRecovery += returns;
    expenseCost += expenses;
    adjustmentContribution += adjustments;
    return {
      id: entry.id,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      effectiveSourceType,
      businessDate: entry.businessDate.toISOString().slice(0, 10),
      description: entry.description,
      hubId: entry.hubId,
      effects: { deliveryFeeRevenue: fee, riderCommissionCost: commission, riderSalaryCost: salary, returnAdvanceRecovery: returns, expenseCost: expenses, adjustmentContribution: adjustments },
      lines: entry.lines.map(({ id, account, debit, credit }) => ({ id, account, debit, credit })),
    };
  });
  const riderCompensationCost = riderCommissionCost + riderSalaryCost;
  const grossProfit = deliveryFeeRevenue - riderCompensationCost;
  const netProfit = grossProfit + adjustmentContribution - expenseCost;
  return {
    components: {
      deliveryFeeRevenue,
      riderCommissionCost,
      riderSalaryCost,
      riderCompensationCost,
      returns: {
        advanceRecovery: returnAdvanceRecovery,
        includedInProfit: false,
        explanation: "Return postings recover OS advances through balance-sheet accounts and do not change profit under the current ledger treatment.",
      },
      adjustments: { contribution: adjustmentContribution },
      expenses: { cost: expenseCost },
    },
    grossProfit,
    netProfit,
    journalEntries,
  };
}

export async function getProfitReport(
  input: { from: string; to: string; hubId?: string },
  actor: ReportActor,
) {
  const hubId = await resolveReportHub(actor, input.hubId);
  const from = parseBusinessDate(input.from);
  const to = parseBusinessDate(input.to);
  assertReportRange(input.from, input.to, from, to);
  const entries = assertReportRows(await prisma.journalEntry.findMany({
    where: {
      hubId,
      businessDate: { gte: from, lt: exclusiveEnd(input.to) },
      OR: [
        { sourceType: { in: ["RIDER_SETTLEMENT", "RIDER_SALARY_DEDUCTION", "OS_RETURN_DEDUCTION", "OS_PARTIAL_RETURN_ADJUSTMENT", "LEDGER_REVERSAL"] } },
        {
          lines: {
            some: {
              OR: [
                { account: { in: ["DELIVERY_FEE_REVENUE", "RIDER_COMMISSION_EXPENSE", "CASHBOOK_ADJUSTMENT", "OS_SETTLEMENT_ADJUSTMENT"] } },
                { account: { startsWith: "EXPENSE:" } },
              ],
            },
          },
        },
      ],
    },
    include: { lines: true },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
  }));
  const reversedIds = entries
    .filter((entry) => entry.sourceType === "LEDGER_REVERSAL" && entry.sourceId)
    .map((entry) => entry.sourceId!);
  const originals = reversedIds.length
    ? await prisma.journalEntry.findMany({ where: { id: { in: reversedIds } }, select: { id: true, sourceType: true, sourceId: true } })
    : [];
  const settlementIds = [...new Set([
    ...entries.filter((entry) => entry.sourceType === "RIDER_SETTLEMENT").map((entry) => entry.sourceId).filter((id): id is string => !!id),
    ...originals.filter((entry) => entry.sourceType === "RIDER_SETTLEMENT").map((entry) => entry.sourceId).filter((id): id is string => !!id),
  ])];
  const settlements = settlementIds.length
    ? await prisma.settlement.findMany({ where: { id: { in: settlementIds } }, select: { id: true, salaryDeduction: true } })
    : [];
  const salaryBySettlement = new Map(settlements.map((settlement) => [settlement.id, settlement.salaryDeduction]));
  const salaryByEntry = new Map<string, number>();
  for (const entry of entries) {
    if (entry.sourceType === "RIDER_SETTLEMENT" && entry.sourceId) salaryByEntry.set(entry.id, salaryBySettlement.get(entry.sourceId) ?? 0);
    if (entry.sourceType === "LEDGER_REVERSAL" && entry.sourceId) {
      const original = originals.find((row) => row.id === entry.sourceId);
      if (original?.sourceType === "RIDER_SETTLEMENT" && original.sourceId) salaryByEntry.set(entry.id, -(salaryBySettlement.get(original.sourceId) ?? 0));
    }
  }
  const report = summarizeProfitEntries(entries, new Map(originals.map((entry) => [entry.id, entry.sourceType])), salaryByEntry);
  return {
    period: { from: input.from, to: input.to, inclusive: true, timezone: env.hubTimezone },
    hubId,
    currency: "MMK",
    amountUnit: "minor",
    ...report,
  };
}

type OperationalReportInput = { from: string; to: string; hubId?: string; shopId?: string; riderId?: string };

async function reportScope(input: OperationalReportInput, actor: ReportActor) {
  const hubId = await resolveReportHub(actor, input.hubId);
  const from = parseBusinessDate(input.from);
  const to = parseBusinessDate(input.to);
  assertReportRange(input.from, input.to, from, to);
  return { hubId, from, toExclusive: exclusiveEnd(input.to), period: { from: input.from, to: input.to, inclusive: true, timezone: env.hubTimezone } };
}

export async function getMonthlyOperationsReport(input: OperationalReportInput, actor: ReportActor) {
  const scope = await reportScope(input, actor);
  const activity = assertReportRows(await prisma.statusHistory.findMany({
    where: {
      createdAt: { gte: scope.from, lt: scope.toExclusive },
      parcel: {
        batch: { hubId: scope.hubId, ...(input.shopId ? { shopId: input.shopId } : {}) },
        ...(input.riderId ? { riderId: input.riderId } : {}),
      },
    },
    include: { parcel: { select: { id: true, status: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
  }));
  const transitionCounts: Record<string, number> = {};
  const affected = new Map<string, string>();
  for (const row of activity) {
    transitionCounts[row.toStatus] = (transitionCounts[row.toStatus] ?? 0) + 1;
    affected.set(row.parcel.id, row.parcel.status);
  }
  const currentStatusCounts: Record<string, number> = {};
  for (const status of affected.values()) currentStatusCounts[status] = (currentStatusCounts[status] ?? 0) + 1;
  return {
    period: scope.period, hubId: scope.hubId,
    filters: { shopId: input.shopId ?? null, riderId: input.riderId ?? null },
    basis: "status_activity",
    totals: { statusTransitions: activity.length, uniqueParcels: affected.size },
    transitionCounts,
    currentStatusCounts,
  };
}

export async function getReturnsReport(input: OperationalReportInput, actor: ReportActor) {
  const scope = await reportScope(input, actor);
  const events = assertReportRows(await prisma.statusHistory.findMany({
    where: {
      toStatus: { in: ["PENDING_RETURN", "RETURNED"] },
      createdAt: { gte: scope.from, lt: scope.toExclusive },
      parcel: { batch: { hubId: scope.hubId, ...(input.shopId ? { shopId: input.shopId } : {}) }, ...(input.riderId ? { riderId: input.riderId } : {}) },
    },
    include: { parcel: { select: { id: true, trackingNumber: true, orderId: true, status: true, riderId: true, advanceAmount: true, returnDueAt: true, batch: { select: { id: true, shopId: true, label: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
  }));
  const pendingReturnEvents = events.filter((row) => row.toStatus === "PENDING_RETURN").length;
  const returnedEvents = events.length - pendingReturnEvents;
  const returnParcels = new Map(events.map((row) => [row.parcel.id, row.parcel]));
  const now = new Date();
  return {
    period: scope.period, hubId: scope.hubId,
    filters: { shopId: input.shopId ?? null, riderId: input.riderId ?? null },
    totals: { events: events.length, uniqueParcels: returnParcels.size, pendingReturnEvents, returnedEvents, advanceAmount: [...returnParcels.values()].reduce((sum, parcel) => sum + parcel.advanceAmount, 0) },
    events: events.map((row) => ({ id: row.id, occurredAt: row.createdAt, fromStatus: row.fromStatus, toStatus: row.toStatus, reasonCode: row.reasonCode, note: row.note, overdue: row.toStatus === "PENDING_RETURN" && !!row.parcel.returnDueAt && row.parcel.returnDueAt < now, parcel: row.parcel })),
  };
}

export async function getRiderPerformanceReport(input: OperationalReportInput, actor: ReportActor) {
  const scope = await reportScope(input, actor);
  const ways = assertReportRows(await prisma.deliveryWay.findMany({
    where: {
      completedAt: { gte: scope.from, lt: scope.toExclusive },
      rider: { hubId: scope.hubId },
      ...(input.riderId ? { riderId: input.riderId } : {}),
      ...(input.shopId ? { parcel: { batch: { shopId: input.shopId } } } : {}),
    },
    include: { rider: { select: { id: true, user: { select: { name: true } } } }, parcel: { select: { deliveryFee: true } } },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
  }));
  const riders = new Map<string, { riderId: string; riderName: string; completedWays: number; delivered: number; partial: number; failed: number; rejected: number; superseded: number; commissionAmount: number }>();
  for (const way of ways) {
    const row = riders.get(way.riderId) ?? { riderId: way.riderId, riderName: way.rider.user.name, completedWays: 0, delivered: 0, partial: 0, failed: 0, rejected: 0, superseded: 0, commissionAmount: 0 };
    row.completedWays++;
    switch (way.outcome) {
      case "DELIVERED": row.delivered++; break;
      case "PARTIAL": row.partial++; break;
      case "FAILED": row.failed++; break;
      case "REJECTED": row.rejected++; break;
      case "SUPERSEDED": row.superseded++; break;
    }
    row.commissionAmount += way.commissionAmount ?? 0;
    riders.set(way.riderId, row);
  }
  return { period: scope.period, hubId: scope.hubId, currency: "MMK", amountUnit: "minor", filters: { shopId: input.shopId ?? null, riderId: input.riderId ?? null }, riders: [...riders.values()], totals: { riders: riders.size, completedWays: ways.length, delivered: ways.filter((way) => way.outcome === "DELIVERED").length, commissionAmount: ways.reduce((sum, way) => sum + (way.commissionAmount ?? 0), 0) } };
}

export async function getOsStatementReport(input: OperationalReportInput, actor: ReportActor) {
  const scope = await reportScope(input, actor);
  const settlements = assertReportRows(await prisma.osSettlement.findMany({
    where: { hubId: scope.hubId, businessDate: { gte: scope.from, lt: scope.toExclusive }, ...(input.shopId ? { shopId: input.shopId } : {}) },
    include: { shop: { select: { id: true, name: true } }, batches: { include: { batch: { select: { id: true, label: true, pickupDate: true } } } } },
    orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: MAX_REPORT_ROWS + 1,
  }));
  const active = settlements.filter((row) => row.status === "POSTED" && !row.reversedAt);
  const sum = (field: "grossCollectedCod" | "advanceDeduction" | "returnDeduction" | "deliveryFeeDeduction" | "adjustmentAmount" | "netAmount") => active.reduce((total, row) => total + row[field], 0);
  return { period: scope.period, hubId: scope.hubId, currency: "MMK", amountUnit: "minor", filters: { shopId: input.shopId ?? null }, totals: { records: settlements.length, settlements: active.length, reversedOrReplaced: settlements.length - active.length, grossCollectedCod: sum("grossCollectedCod"), advanceDeduction: sum("advanceDeduction"), returnDeduction: sum("returnDeduction"), deliveryFeeDeduction: sum("deliveryFeeDeduction"), adjustmentAmount: sum("adjustmentAmount"), netAmount: sum("netAmount") }, settlements };
}
