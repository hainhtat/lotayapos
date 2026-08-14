import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { resolveCommissionRateBps } from "../utils/commission.js";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { assertCashbookOpen } from "./finance.service.js";
import { assertBalancedLines, buildPartialReturnAdjustmentLines, buildPartialReturnCollectionLines, calculateLinkedDeliveryAmounts, calculatePartialReturnAmounts, reverseJournalEntryInTx } from "./ledger.service.js";

export { resolveCommissionRateBps };

const transitions: Record<string, string[]> = { CREATED: ["PICKED_UP"], PICKED_UP: ["ASSIGNED"], ASSIGNED: ["OUT_FOR_DELIVERY"], OUT_FOR_DELIVERY: ["DELIVERED", "PARTIAL", "FAILED", "REJECTED"], PARTIAL: ["PENDING_RETURN"], FAILED: ["PENDING_RETURN"], REJECTED: ["PENDING_RETURN"], PENDING_RETURN: ["RETURNED"] };
export const ALL_STATUSES = ["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"] as const;
export const MONEY_BEARING_STATUSES = ["DELIVERED", "PARTIAL"] as const;
export const MONEY_POSTED_SOURCE_TYPES = ["RIDER_COMMISSION", "RIDER_RECEIVABLE_RECOGNITION", "PARTIAL_RETURN_COLLECTION", "OS_PARTIAL_RETURN_ADJUSTMENT", "DELIVERY_COLLECTION"] as const;
export const LINKED_MONEY_POSTED_SOURCE_TYPES = ["LINKED_RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD", "LINKED_RIDER_RECEIVABLE_FEE", "LINKED_DELIVERY_COLLECTION", "LINKED_RIDER_COMMISSION", "LINKED_OS_SHORTFALL"] as const;
export function isAllowedTransition(fromStatus: string, toStatus: string) { return transitions[fromStatus]?.includes(toStatus) ?? false; }
export function canOverrideStatus(role: string) { return ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(role); }
export function requiresOverrideNote(fromStatus: string, toStatus: string) { return !isAllowedTransition(fromStatus, toStatus); }
export function calculateCommissionAmount(deliveryFee: number, rateBps: number) { return Math.round(deliveryFee * rateBps / 10000); }
export function overrideLeavesMoneyBearingStatus(fromStatus: string, toStatus: string, isOverride: boolean) {
  return isOverride && (MONEY_BEARING_STATUSES as readonly string[]).includes(fromStatus) && fromStatus !== toStatus;
}

/** True when a journal has no LEDGER_REVERSAL whose sourceId is the original entry id. */
export async function journalEntryIsUnreversed(tx: Prisma.TransactionClient, entryId: string) {
  const reversal = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: "LEDGER_REVERSAL", sourceId: entryId } },
    select: { id: true },
  });
  return !reversal;
}

/** Active (unreversed) money journals that block leaving DELIVERED/PARTIAL via ERP override. */
export async function findUnreversedMoneyPostedEntry(
  tx: Prisma.TransactionClient,
  input: { parcelId: string; linkGroupId?: string | null },
) {
  const candidates = await tx.journalEntry.findMany({
    where: {
      OR: [
        {
          sourceType: { in: [...MONEY_POSTED_SOURCE_TYPES] },
          OR: [{ sourceId: input.parcelId }, { sourceId: { startsWith: `${input.parcelId}:` } }],
        },
        ...(input.linkGroupId
          ? [
              {
                sourceType: { in: [...LINKED_MONEY_POSTED_SOURCE_TYPES] },
                sourceId: input.linkGroupId,
              },
            ]
          : []),
      ],
    },
    select: { id: true },
  });
  for (const entry of candidates) {
    if (await journalEntryIsUnreversed(tx, entry.id)) return entry;
  }
  return null;
}

/** Allocate a free RIDER_COMMISSION sourceId so re-delivery after reversal can post again. */
export async function nextRiderCommissionSourceId(tx: Prisma.TransactionClient, parcelId: string) {
  const base = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: "RIDER_COMMISSION", sourceId: parcelId } },
    select: { id: true },
  });
  if (!base) return parcelId;
  if (await journalEntryIsUnreversed(tx, base.id)) return null;
  return `${parcelId}:${randomUUID()}`;
}

/** Allocate a free RIDER_RECEIVABLE_RECOGNITION sourceId after reversal. */
export async function nextRiderReceivableSourceId(tx: Prisma.TransactionClient, parcelId: string) {
  const base = await tx.journalEntry.findUnique({
    where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcelId } },
    select: { id: true },
  });
  if (!base) return parcelId;
  if (await journalEntryIsUnreversed(tx, base.id)) return null;
  return `${parcelId}:${randomUUID()}`;
}

async function findActiveReceivableRecognition(tx: Prisma.TransactionClient, parcelId: string) {
  const entries = await tx.journalEntry.findMany({
    where: {
      sourceType: "RIDER_RECEIVABLE_RECOGNITION",
      OR: [{ sourceId: parcelId }, { sourceId: { startsWith: `${parcelId}:` } }],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, sourceId: true },
  });
  for (const entry of entries) {
    if (!entry.sourceId || !(await journalEntryIsUnreversed(tx, entry.id))) continue;
    const recognition = await tx.riderReceivableRecognition.findUnique({
      where: { sourceType_sourceId: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: entry.sourceId } },
    });
    if (recognition) return { entry, recognition };
  }
  return null;
}

async function recordRiderReceivableCorrection(
  tx: Prisma.TransactionClient,
  input: {
    sourceId: string;
    riderId: string;
    hubId: string;
    businessDate: Date;
    codAmount: number;
    deliveryFee: number;
    commissionAmount: number;
    receivableAmount: number;
  },
) {
  return tx.riderReceivableRecognition.create({
    data: {
      sourceType: "RIDER_RECEIVABLE_CORRECTION",
      sourceId: input.sourceId,
      riderId: input.riderId,
      hubId: input.hubId,
      businessDate: input.businessDate,
      codAmount: -input.codAmount,
      deliveryFee: -input.deliveryFee,
      commissionAmount: -input.commissionAmount,
      receivableAmount: -input.receivableAmount,
    },
  });
}
export function buildRiderCommissionLines(commissionAmount: number) {
  if (!Number.isInteger(commissionAmount) || commissionAmount <= 0) throw new ApiError(400, "INVALID_COMMISSION", "Commission must be a positive integer");
  return [{ account: "RIDER_COMMISSION_EXPENSE", debit: commissionAmount, credit: 0 }, { account: "RIDER_COMMISSION_PAYABLE", debit: 0, credit: commissionAmount }];
}
export function buildRiderReceivableRecognitionLines(codAmount: number, deliveryFee: number, commissionAmount: number) {
  const receivableAmount = codAmount + deliveryFee - commissionAmount;
  if ([codAmount, deliveryFee, commissionAmount, receivableAmount].some((amount) => !Number.isInteger(amount) || amount < 0)) {
    throw new ApiError(400, "INVALID_RIDER_RECEIVABLE", "Rider receivable components must be non-negative integers");
  }
  const lines = [
    { account: "RIDER_RECEIVABLE", debit: receivableAmount, credit: 0 },
    ...(commissionAmount ? [{ account: "RIDER_COMMISSION_PAYABLE", debit: commissionAmount, credit: 0 }] : []),
    ...(codAmount ? [{ account: "CUSTOMER_COD_RECEIVABLE", debit: 0, credit: codAmount }] : []),
    ...(deliveryFee ? [{ account: "DELIVERY_FEE_REVENUE", debit: 0, credit: deliveryFee }] : []),
  ];
  assertBalancedLines(lines);
  return { receivableAmount, lines };
}

async function recognizeRiderReceivable(tx: Prisma.TransactionClient, input: { sourceType: string; sourceId: string; riderId: string; hubId: string; businessDate: Date; codAmount: number; deliveryFee: number; commissionAmount: number; description: string }) {
  const recognition = buildRiderReceivableRecognitionLines(input.codAmount, input.deliveryFee, input.commissionAmount);
  const existing = await tx.riderReceivableRecognition.findUnique({ where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } } });
  if (existing) return existing;
  await assertCashbookOpen(tx, input.businessDate, input.hubId);
  await tx.journalEntry.create({ data: { sourceType: input.sourceType, sourceId: input.sourceId, hubId: input.hubId, businessDate: input.businessDate, description: input.description, lines: { create: recognition.lines } } });
  return tx.riderReceivableRecognition.create({ data: { sourceType: input.sourceType, sourceId: input.sourceId, riderId: input.riderId, hubId: input.hubId, businessDate: input.businessDate, codAmount: input.codAmount, deliveryFee: input.deliveryFee, commissionAmount: input.commissionAmount, receivableAmount: recognition.receivableAmount } });
}
export function validateConfiguredReason(reason: { code: string; outcome: string; noteRequired: boolean; active: boolean } | null, outcome: string, note?: string) {
  if (!reason || !reason.active || reason.outcome !== outcome) throw new ApiError(400, "INVALID_REASON_CODE", "Reason code is not active for this outcome");
  if (reason.noteRequired && !note?.trim()) throw new ApiError(400, "REASON_NOTE_REQUIRED", "A note is required for this reason code");
  return reason.code;
}
type Actor = { id: string; role: string };
type ActorScope = { id: string; role: string; hubId: string | null; riderId: string | null };
type ParcelResource = { batchHubId: string | null; riderUserId: string | null };
export type ParcelListFilters = {
  batchId?: string;
  riderId?: string;
  assignmentStatus?: "ASSIGNED" | "UNASSIGNED";
  zone?: string;
  township?: string;
  townshipId?: string;
  districtId?: string;
  regionStateId?: string;
  dateFrom?: string;
  dateTo?: string;
  trackingNumber?: string;
  orderId?: string;
  customerName?: string;
  shopId?: string;
  status?: string;
  reasonCode?: string;
  page?: number;
  pageSize?: number;
};

const parcelReadRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER", "RIDER", "AUDITOR"];
const parcelStatusRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "RIDER"];

export function buildParcelScope(scope: Pick<ActorScope, "role" | "hubId" | "riderId">, assignedToMe = false): Prisma.ParcelWhereInput | undefined {
  if (assignedToMe && scope.role !== "RIDER") throw new ApiError(403, "FORBIDDEN", "Only riders may request assigned parcels");
  if (scope.role === "RIDER" || assignedToMe) {
    if (!scope.riderId) throw new ApiError(403, "FORBIDDEN", "Rider profile required");
    return { riderId: scope.riderId };
  }
  if (scope.role === "SUPERADMIN") return undefined;
  if (!scope.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  return { batch: { hubId: scope.hubId } };
}

export function assertParcelAccess(scope: Pick<ActorScope, "id" | "role" | "hubId" | "riderId">, parcel: ParcelResource) {
  if (!parcelStatusRoles.includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not update parcel status");
  if (scope.role === "SUPERADMIN") return;
  if (!scope.hubId || parcel.batchHubId !== scope.hubId) throw new ApiError(403, "FORBIDDEN", "Parcel is outside your hub scope");
  if (scope.role === "RIDER" && (!scope.riderId || parcel.riderUserId !== scope.id)) throw new ApiError(403, "FORBIDDEN", "You may only update assigned parcels");
}

async function actorScope(actor: Actor): Promise<ActorScope> {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true, rider: { select: { id: true, hubId: true } } } });
  if (!user || !user.active) throw new ApiError(403, "FORBIDDEN", "Active user scope required");
  const role = user.role;
  const hubId = user.hubId ?? user.rider?.hubId ?? null;
  if (role === "RIDER" && !user.rider) throw new ApiError(403, "FORBIDDEN", "Rider profile required");
  return { id: actor.id, role, hubId, riderId: user.rider?.id ?? null };
}

function parseDateBoundary(value: string | undefined, field: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", `${field} must be a valid date`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function serializableTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new ApiError(409, "TRANSACTION_CONFLICT", "Concurrent parcel update; retry the request");
}

export function buildParcelListWhere(scope: ActorScope, assignedToMe = false, filters: ParcelListFilters = {}): Prisma.ParcelWhereInput {
  const base = buildParcelScope(scope, assignedToMe);
  if (filters.riderId && scope.role === "RIDER" && filters.riderId !== scope.riderId) {
    throw new ApiError(403, "FORBIDDEN", "Riders may only filter their own assignments");
  }
  if (filters.assignmentStatus === "UNASSIGNED" && (assignedToMe || scope.role === "RIDER")) {
    throw new ApiError(400, "INVALID_ASSIGNMENT_FILTER", "A rider cannot request unassigned parcels");
  }
  const dateFrom = parseDateBoundary(filters.dateFrom, "dateFrom");
  const dateTo = parseDateBoundary(filters.dateTo, "dateTo", true);
  if (dateFrom && dateTo && dateFrom >= dateTo) throw new ApiError(400, "INVALID_DATE_RANGE", "dateFrom must be before dateTo");
  const conditions: Prisma.ParcelWhereInput[] = [];
  if (base) conditions.push(base);
  if (filters.batchId) conditions.push({ batchId: filters.batchId });
  if (filters.riderId) conditions.push({ riderId: filters.riderId });
  if (filters.assignmentStatus === "ASSIGNED") conditions.push({ riderId: { not: null } });
  if (filters.assignmentStatus === "UNASSIGNED") conditions.push({ riderId: null });
  if (filters.zone) conditions.push({ zone: filters.zone });
  if (filters.township) conditions.push({ township: filters.township });
  if (filters.townshipId) conditions.push({ townshipId: filters.townshipId });
  if (filters.districtId) conditions.push({ townshipRelation: { districtId: filters.districtId } });
  if (filters.regionStateId) conditions.push({ townshipRelation: { district: { regionStateId: filters.regionStateId } } });
  if (filters.trackingNumber) conditions.push({ trackingNumber: { contains: filters.trackingNumber } });
  if (filters.orderId) conditions.push({ orderId: { contains: filters.orderId } });
  if (filters.customerName) conditions.push({ customerName: { contains: filters.customerName } });
  if (filters.shopId) conditions.push({ batch: { shopId: filters.shopId } });
  if (filters.status) conditions.push({ status: filters.status });
  if (filters.reasonCode) conditions.push({ reasonCode: filters.reasonCode });
  if (dateFrom || dateTo) conditions.push({ batch: { pickupDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lt: dateTo } : {}) } } });
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

export async function listParcels(actor: Actor, assignedToMe = false, filters: ParcelListFilters = {}) {
  const scope = await actorScope(actor);
  if (!parcelReadRoles.includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not view parcels");
  const where = buildParcelListWhere(scope, assignedToMe, filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const [items, total] = await Promise.all([
    prisma.parcel.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], include: { batch: { include: { shop: true } }, townshipRelation: { include: { district: { include: { regionState: true } } } }, zoneRelation: true, rider: { include: { user: { select: { id: true, email: true, name: true, role: true, locale: true } } } }, linkGroup: { select: { id: true, address: true, baseDeliveryFee: true, totalDeliveryFee: true } } }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.parcel.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getParcelHistory(id: string, actor: Actor) {
  const scope = await actorScope(actor);
  if (!parcelReadRoles.includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not view parcel history");
  const accessScope = buildParcelScope(scope);
  const parcel = await prisma.parcel.findFirst({ where: { id, ...(accessScope ?? {}) }, select: { id: true } });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  return prisma.statusHistory.findMany({ where: { parcelId: parcel.id }, orderBy: { createdAt: "asc" } });
}

const correctDeliveredRiderRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"];

export async function correctDeliveredRider(id: string, input: { riderId: string; reason: string }, actor: Actor) {
  const scope = await actorScope(actor);
  if (!correctDeliveredRiderRoles.includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not correct delivered rider assignments");
  const accessScope = buildParcelScope(scope);
  const parcel = await prisma.parcel.findFirst({
    where: { id, ...(accessScope ?? {}) },
    include: {
      batch: { select: { hubId: true } },
      rider: { select: { id: true, user: { select: { name: true } } } },
    },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  if (parcel.status !== "DELIVERED") throw new ApiError(409, "PARCEL_NOT_DELIVERED", "Correct rider is only available for delivered parcels");
  if (!parcel.riderId) throw new ApiError(409, "PARCEL_UNASSIGNED", "Parcel has no rider to correct");
  if (parcel.linkGroupId) throw new ApiError(409, "PARCEL_LINKED", "Unlink the parcel before correcting its rider");
  if (parcel.riderId === input.riderId) throw new ApiError(409, "SAME_RIDER", "Choose a different rider");
  if (!parcel.batch.hubId) throw new ApiError(409, "PARCEL_HUB_REQUIRED", "Parcel batch must belong to a hub");
  const hubId = parcel.batch.hubId;
  const newRider = await prisma.rider.findUnique({
    where: { id: input.riderId },
    select: { id: true, hubId: true, payModel: true, commissionRateBps: true, user: { select: { name: true, active: true, role: true } } },
  });
  if (!newRider || !newRider.user.active || newRider.user.role !== "RIDER") throw new ApiError(404, "RIDER_NOT_FOUND", "Active rider not found");
  if (newRider.hubId !== hubId) throw new ApiError(409, "HUB_MISMATCH", "Parcel and rider must belong to the same hub");

  return serializableTransaction(async (tx) => {
    const collection = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "DELIVERY_COLLECTION", sourceId: id } } });
    if (collection && await journalEntryIsUnreversed(tx, collection.id)) {
      throw new ApiError(409, "MONEY_POSTED", "Finance collection is already posted; reverse it before correcting the rider");
    }

    const activeReceivable = await findActiveReceivableRecognition(tx, id);
    if (!activeReceivable) throw new ApiError(409, "RECOGNITION_NOT_FOUND", "Rider receivable must be posted and unreversed before correction");
    const { entry: receivableEntry, recognition } = activeReceivable;

    const businessDate = recognition.businessDate;
    const oldRiderId = parcel.riderId!;
    const riderSettled = await tx.settlement.findFirst({
      where: {
        riderId: { in: [oldRiderId, input.riderId] },
        businessDate,
      },
      select: { id: true, riderId: true },
    });
    if (riderSettled) {
      throw new ApiError(409, "MONEY_POSTED", "A rider settlement already exists for this delivery date; reverse it before correcting the rider");
    }

    const reason = `Correct rider: ${input.reason.trim()}`;
    const oldRiderName = parcel.rider?.user.name ?? oldRiderId;
    const receivableSourceId = receivableEntry.sourceId!;

    await reverseJournalEntryInTx(tx, { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: receivableSourceId, businessDate, reason });
    await recordRiderReceivableCorrection(tx, {
      sourceId: `${id}:reverse:${randomUUID()}`,
      riderId: recognition.riderId,
      hubId: recognition.hubId,
      businessDate,
      codAmount: recognition.codAmount,
      deliveryFee: recognition.deliveryFee,
      commissionAmount: recognition.commissionAmount,
      receivableAmount: recognition.receivableAmount,
    });

    const commissionEntries = await tx.journalEntry.findMany({
      where: { sourceType: "RIDER_COMMISSION", OR: [{ sourceId: id }, { sourceId: { startsWith: `${id}:` } }] },
    });
    for (const entry of commissionEntries) {
      if (entry.sourceId && await journalEntryIsUnreversed(tx, entry.id)) {
        await reverseJournalEntryInTx(tx, { sourceType: "RIDER_COMMISSION", sourceId: entry.sourceId, businessDate, reason });
      }
    }

    const changed = await tx.parcel.updateMany({ where: { id, riderId: oldRiderId, status: "DELIVERED" }, data: { riderId: newRider.id } });
    if (changed.count !== 1) throw new ApiError(409, "ASSIGNMENT_CONFLICT", "Parcel assignment changed; refresh and retry");

    await tx.packageAssignment.updateMany({ where: { parcelId: id, endedAt: null }, data: { endedAt: new Date(), endedById: actor.id, reason } });
    await tx.packageAssignment.create({ data: { parcelId: id, riderId: newRider.id, assignedById: actor.id } });

    const commissionRateBps = resolveCommissionRateBps({ payModel: newRider.payModel, commissionRateBps: newRider.commissionRateBps });
    const commissionAmount = calculateCommissionAmount(parcel.deliveryFee ?? 0, commissionRateBps);

    await tx.deliveryWay.updateMany({
      where: { parcelId: id, outcome: "DELIVERED" },
      data: { riderId: newRider.id, commissionRate: commissionRateBps, commissionAmount },
    });

    if (commissionAmount > 0) {
      await assertCashbookOpen(tx, businessDate, hubId);
      const commissionSourceId = await nextRiderCommissionSourceId(tx, id);
      if (commissionSourceId) {
        await tx.journalEntry.create({
          data: {
            sourceType: "RIDER_COMMISSION",
            sourceId: commissionSourceId,
            hubId,
            businessDate,
            description: `Rider commission for ${parcel.trackingNumber} (corrected rider)`,
            lines: { create: buildRiderCommissionLines(commissionAmount) },
          },
        });
      }
    }

    const receivableRepostSourceId = await nextRiderReceivableSourceId(tx, id);
    if (!receivableRepostSourceId) throw new ApiError(409, "RECOGNITION_CONFLICT", "An active rider receivable already exists for this parcel");
    await recognizeRiderReceivable(tx, {
      sourceType: "RIDER_RECEIVABLE_RECOGNITION",
      sourceId: receivableRepostSourceId,
      riderId: newRider.id,
      hubId,
      businessDate,
      codAmount: parcel.codAmount,
      deliveryFee: parcel.deliveryFee ?? 0,
      commissionAmount,
      description: `Rider receivable for ${parcel.trackingNumber} (corrected rider)`,
    });

    await tx.statusHistory.create({
      data: {
        parcelId: id,
        fromStatus: "DELIVERED",
        toStatus: "DELIVERED",
        actorId: actor.id,
        note: `${reason} | ${oldRiderName} -> ${newRider.user.name}`,
      },
    });

    return tx.parcel.findUniqueOrThrow({
      where: { id },
      include: { rider: { include: { user: { select: { name: true } } } } },
    });
  });
}

export async function getParcelDetail(id: string, actor: Actor) {
  const scope = await actorScope(actor);
  if (!parcelReadRoles.includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not view parcels");
  const accessScope = buildParcelScope(scope);
  const parcel = await prisma.parcel.findFirst({
    where: { id, ...(accessScope ?? {}) },
    include: {
      batch: { include: { shop: true } },
      rider: { include: { user: { select: { id: true, name: true } } } },
      linkGroup: { include: { parcels: { select: { id: true, trackingNumber: true, status: true } } } },
      assignments: { orderBy: { assignedAt: "desc" }, select: { id: true, riderId: true, assignedAt: true, endedAt: true, reason: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      ways: { orderBy: { startedAt: "desc" } },
    },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  return parcel;
}

const editableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);

export async function updateParcel(
  id: string,
  input: {
    orderId?: string | null;
    customerName?: string;
    customerPhone?: string | null;
    address?: string;
    codAmount?: number;
    deliveryFee?: number;
    townshipId?: string;
    zoneId?: string | null;
  },
  actor: Actor,
) {
  const scope = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(scope.role)) throw new ApiError(403, "FORBIDDEN", "You may not edit parcels");
  const accessScope = buildParcelScope(scope);
  const parcel = await prisma.parcel.findFirst({
    where: { id, ...(accessScope ?? {}) },
    include: { batch: { select: { id: true, hubId: true } } },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  const changesDeliveryAttributes = input.codAmount !== undefined || input.deliveryFee !== undefined || input.townshipId !== undefined || input.zoneId !== undefined;
  if (changesDeliveryAttributes && !editableStatuses.has(parcel.status)) throw new ApiError(409, "PARCEL_NOT_EDITABLE", "COD, delivery fee, township, and zone may only be edited for Created, Picked up, or Assigned parcels");
  if (changesDeliveryAttributes && parcel.linkGroupId) throw new ApiError(409, "PARCEL_LINKED", "Unlink the parcel before editing delivery attributes");
  if (input.codAmount !== undefined || input.townshipId !== undefined || input.deliveryFee !== undefined) {
    const advancePosted = await prisma.journalEntry.findUnique({
      where: { sourceType_sourceId: { sourceType: "BATCH_PICKUP_ADVANCE", sourceId: parcel.batchId } },
      select: { id: true },
    });
    if (advancePosted) {
      if (input.codAmount !== undefined) throw new ApiError(409, "ADVANCE_POSTED", "COD cannot be edited after the batch pickup advance is posted");
      if (input.townshipId !== undefined) throw new ApiError(409, "ADVANCE_POSTED", "Township cannot be edited after the batch pickup advance is posted");
      throw new ApiError(409, "ADVANCE_POSTED", "Delivery fee cannot be edited after the batch pickup advance is posted");
    }
  }

  let townshipName = parcel.township;
  let deliveryFee = parcel.deliveryFee;
  if (input.townshipId) {
    const township = await prisma.township.findUnique({ where: { id: input.townshipId }, select: { id: true, nameEn: true, deliveryFee: true } });
    if (!township) throw new ApiError(400, "INVALID_TOWNSHIP", "Township is invalid");
    townshipName = township.nameEn;
    deliveryFee = input.deliveryFee ?? township.deliveryFee;
  } else if (input.deliveryFee !== undefined) {
    deliveryFee = input.deliveryFee;
  }
  const nextTownshipId = input.townshipId ?? parcel.townshipId;
  let zoneName = parcel.zone;
  let zoneId = parcel.zoneId;
  if (input.zoneId === null) {
    zoneName = null;
    zoneId = null;
  } else if (input.zoneId) {
    if (!nextTownshipId) throw new ApiError(400, "INVALID_ZONE", "Zone requires a township");
    const zone = await prisma.zone.findUnique({ where: { id: input.zoneId }, select: { id: true, name: true, townshipId: true, hubId: true } });
    if (!zone || zone.townshipId !== nextTownshipId || zone.hubId !== parcel.batch.hubId) throw new ApiError(400, "INVALID_ZONE", "Zone must belong to the selected township and batch hub");
    zoneName = zone.name;
    zoneId = zone.id;
  }

  const data = {
    ...(input.orderId !== undefined ? { orderId: input.orderId?.trim() || null } : {}),
    ...(input.customerName !== undefined ? { customerName: input.customerName.trim() } : {}),
    ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone?.trim() || null } : {}),
    ...(input.address !== undefined ? { address: input.address.trim() } : {}),
    ...(input.codAmount !== undefined ? { codAmount: input.codAmount } : {}),
    ...(input.townshipId !== undefined ? { townshipId: input.townshipId, township: townshipName } : {}),
    ...(input.deliveryFee !== undefined || input.townshipId !== undefined ? { deliveryFee } : {}),
    ...(input.zoneId !== undefined ? { zoneId, zone: zoneName } : {}),
  };
  const result = await prisma.parcel.updateMany({ where: { id, ...(changesDeliveryAttributes ? {status: { in: [...editableStatuses] }} : {}) }, data });
  if (result.count !== 1) throw new ApiError(409, "PARCEL_NOT_EDITABLE", "COD, delivery fee, township, and zone may only be edited for Created, Picked up, or Assigned parcels");
  return prisma.parcel.findUniqueOrThrow({
    where: { id },
    include: { townshipRelation: { include: { district: { include: { regionState: true } } } }, zoneRelation: true },
  });
}
export async function updateStatus(id: string, toStatus: string, actor: Actor, reasonCode?: string, note?: string, actualCodCollected?: number, collectionWallet?: "CASH" | "KBZ_PAY" | "WAVE_PAY") {
  const scope = await actorScope(actor);
  const parcel = await prisma.parcel.findUnique({
    where: { id },
    include: {
      rider: { select: { userId: true, payModel: true, commissionRateBps: true } },
      batch: { select: { hubId: true } },
    },
  });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  if (!parcel.batch.hubId) throw new ApiError(409, "PARCEL_HUB_REQUIRED", "Parcel batch must belong to a hub");
  const parcelHubId = parcel.batch.hubId;
  assertParcelAccess(scope, { batchHubId: parcel.batch.hubId, riderUserId: parcel.rider?.userId ?? null });
  if (!(ALL_STATUSES as readonly string[]).includes(toStatus)) {
    throw new ApiError(400, "INVALID_STATUS", "Status is not a valid parcel lifecycle status");
  }
  const allowedTransition = isAllowedTransition(parcel.status, toStatus);
  const overrideTransition = !allowedTransition && canOverrideStatus(scope.role);
  if (!allowedTransition && !overrideTransition) {
    throw new ApiError(409, "INVALID_STATUS_TRANSITION", `Cannot move parcel from ${parcel.status} to ${toStatus}`);
  }
  if (overrideTransition && requiresOverrideNote(parcel.status, toStatus) && !note?.trim()) {
    throw new ApiError(400, "OVERRIDE_NOTE_REQUIRED", "A note is required when overriding the normal status transition");
  }
  if (["PARTIAL", "FAILED", "REJECTED"].includes(toStatus) && !reasonCode) throw new ApiError(400, "REASON_REQUIRED", "A reason code is required for this outcome");
  if (["PARTIAL", "FAILED", "REJECTED"].includes(toStatus)) {
    const configuredReason = await prisma.reasonCode.findUnique({ where: { code: reasonCode!.trim().toUpperCase() }, select: { code: true, outcome: true, noteRequired: true, active: true } });
    reasonCode = validateConfiguredReason(configuredReason, toStatus, note);
  }
  const partialReturn = toStatus === "PARTIAL"
    ? actualCodCollected === undefined
      ? (() => { throw new ApiError(400, "ACTUAL_COD_REQUIRED", "Actual COD collected is required for a partial return"); })()
      : calculatePartialReturnAmounts({ codAmount: parcel.codAmount, advanceAmount: parcel.advanceAmount, actualCodCollected })
    : null;
  if (partialReturn && !collectionWallet) throw new ApiError(400, "COLLECTION_WALLET_REQUIRED", "Collection wallet is required for a partial return");
  const returnDueAt = toStatus === "PENDING_RETURN" ? new Date(Date.now() + 4 * 24 * 60 * 60 * 1000) : undefined;
  const businessDate = new Date();
  businessDate.setUTCHours(0, 0, 0, 0);
  const commissionRateBps = resolveCommissionRateBps(
    parcel.rider ? { payModel: parcel.rider.payModel, commissionRateBps: parcel.rider.commissionRateBps } : null,
  );
  return serializableTransaction(async (tx) => {
    if (overrideLeavesMoneyBearingStatus(parcel.status, toStatus, overrideTransition)) {
      const postedMoney = await findUnreversedMoneyPostedEntry(tx, {
        parcelId: id,
        linkGroupId: parcel.linkGroupId,
      });
      if (postedMoney) {
        throw new ApiError(409, "MONEY_POSTED", "Finance must reverse posted entries before correcting status");
      }
    }
    const result = await tx.parcel.updateMany({ where: { id, status: parcel.status }, data: { status: toStatus as never, reasonCode, returnDueAt } });
    if (result.count !== 1) throw new ApiError(409, "STATUS_CONFLICT", "Parcel status changed; refresh and retry");
    if (partialReturn) {
      await tx.parcel.update({ where: { id }, data: { actualCodCollected: partialReturn.actualCodCollected, partialReturnShortfall: partialReturn.shortfall } });
      const collectionLines = buildPartialReturnCollectionLines(partialReturn.actualCodCollected, collectionWallet!);
      if (collectionLines.length > 0) {
        await assertCashbookOpen(tx, businessDate, parcelHubId);
        const existingCollection = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "PARTIAL_RETURN_COLLECTION", sourceId: id } } });
        if (!existingCollection) {
          await tx.journalEntry.create({
            data: {
              sourceType: "PARTIAL_RETURN_COLLECTION",
              sourceId: id,
              hubId: parcelHubId,
              businessDate,
              description: `Partial return collection for ${parcel.trackingNumber}`,
              lines: { create: collectionLines },
            },
          });
        }
      }
      if (partialReturn.settlementOffset > 0) {
        await assertCashbookOpen(tx, businessDate, parcelHubId);
        const existingAdjustment = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "OS_PARTIAL_RETURN_ADJUSTMENT", sourceId: id } } });
        if (!existingAdjustment) {
          await tx.journalEntry.create({
            data: {
              sourceType: "OS_PARTIAL_RETURN_ADJUSTMENT",
              sourceId: id,
              hubId: parcelHubId,
              businessDate,
              description: `Partial return adjustment for ${parcel.trackingNumber}`,
              lines: { create: buildPartialReturnAdjustmentLines(partialReturn.settlementOffset) },
            },
          });
        }
      }
    }
    await tx.statusHistory.create({ data: { parcelId: id, fromStatus: parcel.status as never, toStatus: toStatus as never, actorId: actor.id, reasonCode, note } });
    if (["PARTIAL", "FAILED"].includes(toStatus)) await tx.alert.create({ data: { type: toStatus, message: `Parcel ${parcel.trackingNumber} requires operations review`, parcelId: id } });
    if (toStatus === "OUT_FOR_DELIVERY" && parcel.riderId) {
      await tx.deliveryWay.create({ data: { parcelId: id, riderId: parcel.riderId, commissionRate: commissionRateBps } });
    }
    if (["DELIVERED", "PARTIAL", "FAILED", "REJECTED"].includes(toStatus) && parcel.riderId) {
      const commissionAmount = toStatus === "DELIVERED" && !parcel.linkGroupId ? calculateCommissionAmount(parcel.deliveryFee ?? 0, commissionRateBps) : 0;
      let completed = await tx.deliveryWay.updateMany({ where: { parcelId: id, riderId: parcel.riderId, completedAt: null }, data: { commissionAmount, outcome: toStatus, completedAt: new Date() } });
      if (completed.count !== 1 && overrideTransition) {
        await tx.deliveryWay.create({
          data: {
            parcelId: id,
            riderId: parcel.riderId,
            commissionRate: commissionRateBps,
            commissionAmount,
            outcome: toStatus,
            completedAt: new Date(),
          },
        });
        completed = { count: 1 };
      }
      if (completed.count !== 1) throw new ApiError(409, "DELIVERY_WAY_NOT_STARTED", "Start delivery before recording an outcome");
      if (toStatus === "DELIVERED" && !parcel.linkGroupId && commissionAmount > 0) {
        await assertCashbookOpen(tx, businessDate, parcelHubId);
        const commissionSourceId = await nextRiderCommissionSourceId(tx, parcel.id);
        if (commissionSourceId) {
          await tx.journalEntry.create({
            data: {
              sourceType: "RIDER_COMMISSION",
              sourceId: commissionSourceId,
              hubId: parcelHubId,
              businessDate,
              description: `Rider commission for ${parcel.trackingNumber}`,
              lines: { create: buildRiderCommissionLines(commissionAmount) },
            },
          });
        }
      }
      if (toStatus === "DELIVERED" && !parcel.linkGroupId) {
        await recognizeRiderReceivable(tx, { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId: parcel.id, riderId: parcel.riderId, hubId: parcelHubId, businessDate, codAmount: parcel.codAmount, deliveryFee: parcel.deliveryFee ?? 0, commissionAmount, description: `Rider receivable for ${parcel.trackingNumber}` });
      }
      if (parcel.linkGroupId) {
        // COD belongs to the member's own delivery day. Group fee and commission
        // are intentionally deferred until the final member completes.
        if (toStatus === "DELIVERED") {
          await recognizeRiderReceivable(tx, { sourceType: "LINKED_RIDER_RECEIVABLE_COD", sourceId: parcel.id, riderId: parcel.riderId, hubId: parcelHubId, businessDate, codAmount: parcel.codAmount, deliveryFee: 0, commissionAmount: 0, description: `Linked parcel COD receivable for ${parcel.trackingNumber}` });
        }
        const group = await tx.parcelLinkGroup.findUnique({ where: { id: parcel.linkGroupId }, include: { parcels: { select: { id: true, status: true, codAmount: true } } } });
        if (group && group.parcels.every((linkedParcel) => linkedParcel.id === id || linkedParcel.status === "DELIVERED")) {
          const ways = await tx.deliveryWay.findMany({ where: { parcelId: { in: group.parcels.map((linkedParcel) => linkedParcel.id) }, outcome: "DELIVERED" }, orderBy: { parcelId: "asc" } });
          const totalCommission = calculateCommissionAmount(group.totalDeliveryFee, commissionRateBps);
          const baseAllocation = Math.floor(totalCommission / ways.length);
          for (const [index, way] of ways.entries()) await tx.deliveryWay.update({ where: { id: way.id }, data: { commissionAmount: baseAllocation + (index < totalCommission % ways.length ? 1 : 0) } });
          if (totalCommission > 0) {
            const priorCommission = await tx.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "LINKED_RIDER_COMMISSION", sourceId: group.id } } });
            if (!priorCommission) await tx.journalEntry.create({ data: { sourceType: "LINKED_RIDER_COMMISSION", sourceId: group.id, hubId: parcelHubId, businessDate, description: `Linked rider commission for ${group.id}`, lines: { create: buildRiderCommissionLines(totalCommission) } } });
          }
          await recognizeRiderReceivable(tx, { sourceType: "LINKED_RIDER_RECEIVABLE_FEE", sourceId: group.id, riderId: parcel.riderId, hubId: parcelHubId, businessDate, codAmount: 0, deliveryFee: group.totalDeliveryFee, commissionAmount: totalCommission, description: `Linked group fee receivable for ${group.id}` });
        }
      }
    }
    return tx.parcel.findUniqueOrThrow({ where: { id } });
  });
}
