import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";
import { assertCashbookOpen } from "./finance.service.js";
import { journalEntryIsUnreversed, nextVersionedJournalSourceId } from "./parcel.service.js";

export type FundingWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";
const walletAccounts: Record<FundingWallet, string> = { CASH: "WALLET_CASH", KBZ_PAY: "WALLET_KBZ_PAY", WAVE_PAY: "WALLET_WAVE_PAY" };
type BatchActor = { id: string; role: string };
const operationsReadRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER"];
const assignmentRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"];
const manifestReadRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "FINANCE", "AUDITOR"];
export const DISPATCH_MANIFEST_STATUSES = ["ASSIGNED", "OUT_FOR_DELIVERY", "PICKED_UP"] as const;
const MANIFEST_STATUSES = ["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"] as const;
const PDF_STATUS_NOTE: Record<string, string> = {
  CREATED: "CRT",
  PICKED_UP: "PKU",
  ASSIGNED: "ASN",
  OUT_FOR_DELIVERY: "OFD",
  DELIVERED: "DLV",
  PARTIAL: "PRT",
  FAILED: "FLD",
  REJECTED: "REJ",
  PENDING_RETURN: "PRN",
  RETURNED: "RTN",
};

export function manifestStatusesLabel(statuses?: string[]) {
  const list = statuses?.length ? statuses : [...DISPATCH_MANIFEST_STATUSES];
  if (list.length >= MANIFEST_STATUSES.length) return "All statuses";
  return list.map((status) => status.replaceAll("_", " ").toLowerCase().replace(/^[a-z]/, (letter) => letter.toUpperCase())).join(", ");
}
const assignmentEligibleStatuses = ["CREATED", "PICKED_UP"];

export function walletAccount(wallet: string): string {
  if (!(wallet in walletAccounts)) throw new ApiError(400, "INVALID_FUNDING_WALLET", "Funding wallet must be Cash, KBZ Pay, or Wave Pay");
  return walletAccounts[wallet as FundingWallet];
}

export function buildPickupAdvanceJournalLines(advanceAmount: number, fundingWallet: string) {
  if (!Number.isInteger(advanceAmount) || advanceAmount < 0) throw new ApiError(400, "INVALID_ADVANCE", "Advance must be a non-negative integer");
  return [{ account: "OS_ADVANCE_RECEIVABLE", debit: advanceAmount, credit: 0 }, { account: walletAccount(fundingWallet), debit: 0, credit: advanceAmount }];
}

async function resolveBatchHub(actor: BatchActor, requestedHubId?: string) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active) throw new ApiError(403, "FORBIDDEN", "Active user scope required");
  if (user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not create batches");
  if (user.role !== "SUPERADMIN" && requestedHubId && requestedHubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Batch hub is outside your hub scope");
  const hubId = requestedHubId ?? user.hubId;
  if (!hubId) throw new ApiError(400, "HUB_REQUIRED", "A hub is required when creating a batch");
  const hub = await prisma.hub.findUnique({ where: { id: hubId }, select: { id: true } });
  if (!hub) throw new ApiError(404, "HUB_NOT_FOUND", "Hub not found");
  return hub.id;
}

async function assertOperationsReader(actor: BatchActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !operationsReadRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "Active operations scope required");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  return user;
}

export async function listBatches(actor: BatchActor) {
  const user = await assertOperationsReader(actor);
  const batches = await prisma.batch.findMany({
    where: user.role === "SUPERADMIN" ? {} : { hubId: user.hubId },
    include: { shop: true, parcels: { select: { status: true } } },
    orderBy: { pickupDate: "desc" },
    take: 200,
  });
  if (!batches.length) return [];
  const batchIds = batches.map((batch) => batch.id);
  const postedEntries = await prisma.journalEntry.findMany({
    where: {
      sourceType: "BATCH_PICKUP_ADVANCE",
      OR: [{ sourceId: { in: batchIds } }, ...batchIds.map((id) => ({ sourceId: { startsWith: `${id}:` } }))],
    },
    select: { sourceId: true, id: true },
  });
  const postedBatchIds = new Set<string>();
  for (const entry of postedEntries) {
    if (!entry.sourceId || !(await journalEntryIsUnreversed(prisma, entry.id))) continue;
    postedBatchIds.add(entry.sourceId.split(":")[0]!);
  }
  return batches.map((batch) => ({ ...batch, advancePosted: postedBatchIds.has(batch.id) }));
}
export function formatTrackingNumber(sequence: number) {
  return `LTY-${String(sequence).padStart(3, "0")}`;
}

export async function nextTrackingSequenceStart() {
  if (env.databaseProvider === "postgresql") {
    const rows = await prisma.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(SUBSTRING("trackingNumber" FROM 5) AS INTEGER)) AS max
      FROM "Parcel"
      WHERE "trackingNumber" ~ '^LTY-[0-9]+$'
    `;
    return Number(rows[0]?.max ?? 0) + 1;
  }
  const parcels = await prisma.parcel.findMany({ where: { trackingNumber: { startsWith: "LTY-" } }, select: { trackingNumber: true } });
  const highest = parcels.reduce((max, parcel) => {
    const match = /^LTY-(\d+)$/.exec(parcel.trackingNumber);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return highest + 1;
}

export async function getBatchDetail(id:string,actor:BatchActor){
  const user=await assertOperationsReader(actor);
  const batch=await prisma.batch.findFirst({
    where:{id,...(user.role==="SUPERADMIN"?{}:{hubId:user.hubId})},
    include:{shop:true,hub:true,parcels:{include:{townshipRelation:{include:{district:{include:{regionState:true}}}},zoneRelation:true},orderBy:{trackingNumber:"asc"}}},
  });
  if(!batch)throw new ApiError(404,"BATCH_NOT_FOUND","Batch not found");
  const totalCod=batch.parcels.reduce((sum,parcel)=>sum+parcel.codAmount,0);
  const remainingToOs=totalCod-batch.advancePaid;
  return {...batch,totalCod,remainingToOs,nextTrackingSequence:await nextTrackingSequenceStart()};
}

type NewParcelInput = { trackingNumber: string; orderId?: string | null; customerName: string; customerPhone?: string; address: string; codAmount: number; townshipId: string; zoneId?: string };

export async function createBatch(input: { shopId: string; pickupDate: string; batchName: string; advancePaid: number; hubId?: string }, actor: BatchActor) {
  const pickupDate = new Date(input.pickupDate);
  if (Number.isNaN(pickupDate.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  pickupDate.setUTCHours(0, 0, 0, 0);
  const hubId = await resolveBatchHub(actor, input.hubId);
  if (!Number.isInteger(input.advancePaid) || input.advancePaid < 0) throw new ApiError(400,"INVALID_ADVANCE","Batch advance paid must be a non-negative integer");
  const shop = await prisma.onlineShop.findUnique({where:{id:input.shopId},select:{id:true,active:true}});
  if(!shop?.active) throw new ApiError(404,"SHOP_NOT_FOUND","Active online shop not found");
  try {
    return await prisma.batch.create({ data: { shopId: shop.id, hubId, pickupDate, label: input.batchName, advancePaid:input.advancePaid }, include:{shop:true,parcels:true} });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ApiError(409, "BATCH_EXISTS", "A batch already exists for this online shop and pickup date");
    throw error;
  }
}

export async function bulkCreateParcels(batchId:string,input:{parcels:NewParcelInput[]},actor:BatchActor){
  const user=await prisma.user.findUnique({where:{id:actor.id},select:{active:true,role:true,hubId:true}});
  if(!user?.active||user.role!==actor.role||!["SUPERADMIN","OPERATIONS_MANAGER","DISPATCHER"].includes(user.role)) throw new ApiError(403,"FORBIDDEN","You may not add parcels");
  const batch=await prisma.batch.findFirst({where:{id:batchId,...(user.role==="SUPERADMIN"?{}:{hubId:user.hubId})},select:{id:true,hubId:true}});
  if(!batch) throw new ApiError(404,"BATCH_NOT_FOUND","Batch not found");
  const townshipIds=[...new Set(input.parcels.map(p=>p.townshipId))];
  const townships=await prisma.township.findMany({where:{id:{in:townshipIds}},select:{id:true,nameEn:true,deliveryFee:true}});
  if(townships.length!==townshipIds.length) throw new ApiError(400,"INVALID_TOWNSHIP","One or more townships are invalid");
  const townshipById=new Map(townships.map(t=>[t.id,t]));
  const zoneIds=[...new Set(input.parcels.flatMap(p=>p.zoneId?[p.zoneId]:[]))];
  const zones=zoneIds.length?await prisma.zone.findMany({where:{id:{in:zoneIds}},select:{id:true,townshipId:true,hubId:true,name:true}}):[];
  const zoneById=new Map(zones.map(z=>[z.id,z]));
  if(zones.length!==zoneIds.length||input.parcels.some(p=>p.zoneId&&(zoneById.get(p.zoneId)?.townshipId!==p.townshipId||zoneById.get(p.zoneId)?.hubId!==batch.hubId))) throw new ApiError(400,"INVALID_ZONE","Zone must belong to the selected township and batch hub");
  return prisma.$transaction(async tx=>{
    await tx.parcel.createMany({data:input.parcels.map(p=>{const township=townshipById.get(p.townshipId)!;const zone=p.zoneId?zoneById.get(p.zoneId):undefined;return {...p,zoneId:p.zoneId,zone:zone?.name,township:township.nameEn,deliveryFee:township.deliveryFee,advanceAmount:0,batchId};})});
    return tx.parcel.findMany({where:{batchId,trackingNumber:{in:input.parcels.map(p=>p.trackingNumber)}},include:{townshipRelation:{include:{district:{include:{regionState:true}}}},zoneRelation:true}});
  });
}

export function pickupAdvancePostingDisposition(parcelCount: number, postedCount: number) {
  if (!Number.isInteger(parcelCount) || parcelCount < 1 || !Number.isInteger(postedCount) || postedCount < 0 || postedCount > parcelCount) throw new ApiError(500, "INVALID_ADVANCE_POSTING_STATE", "Invalid pickup advance posting state");
  if (postedCount === parcelCount) return "ALREADY_POSTED" as const;
  if (postedCount > 0) return "PARTIAL" as const;
  return "UNPOSTED" as const;
}

export async function postPickupAdvances(batchId: string, input: { fundingWallet: FundingWallet }, actor: BatchActor) {
  walletAccount(input.fundingWallet);
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !["SUPERADMIN", "FINANCE"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not post pickup advances");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...(user.role === "SUPERADMIN" ? {} : { hubId: user.hubId }) },
    select: { id: true, pickupDate: true, hubId: true, label:true, advancePaid:true },
  });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (!batch.hubId) throw new ApiError(409, "BATCH_HUB_REQUIRED", "Batch must belong to a hub before advances can be posted");
  const batchHubId = batch.hubId;
  if (batch.advancePaid <= 0) throw new ApiError(409, "NO_BATCH_ADVANCE", "Batch advance paid must be greater than zero before posting");

  const attemptPost = async (retriesLeft = 1): Promise<{ batchId: string; postedCount: number; alreadyPosted: boolean }> => {
    try {
      return await prisma.$transaction(async (tx) => {
        await assertCashbookOpen(tx, batch.pickupDate, batchHubId);
        const sourceId = await nextVersionedJournalSourceId(tx, "BATCH_PICKUP_ADVANCE", batch.id);
        if (!sourceId) return { batchId: batch.id, postedCount: 1, alreadyPosted: true };
        await tx.journalEntry.create({
          data: {
            sourceType: "BATCH_PICKUP_ADVANCE",
            sourceId,
            hubId: batchHubId,
            businessDate: batch.pickupDate,
            description: `Batch advance for ${batch.label}`,
            lines: { create: buildPickupAdvanceJournalLines(batch.advancePaid, input.fundingWallet) },
          },
        });
        return { batchId: batch.id, postedCount: 1, alreadyPosted: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        const live = await nextVersionedJournalSourceId(prisma, "BATCH_PICKUP_ADVANCE", batch.id);
        if (!live) return { batchId: batch.id, postedCount: 1, alreadyPosted: true };
        if (retriesLeft > 0) return attemptPost(retriesLeft - 1);
      }
      throw error;
    }
  };

  return attemptPost();
}

export async function listAlerts(actor: BatchActor) {
  const user = await assertOperationsReader(actor);
  return prisma.alert.findMany({ where: { acknowledgedAt: null, ...(user.role === "SUPERADMIN" ? {} : { parcel: { batch: { hubId: user.hubId } } }) }, include: { parcel: true }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function acknowledgeAlert(alertId: string, actor: BatchActor) {
  const user = await assertOperationsReader(actor);
  if (!['SUPERADMIN', 'OPERATIONS_MANAGER'].includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'You may not acknowledge alerts');
  const alert = await prisma.alert.findFirst({
    where: { id: alertId, ...(user.role === 'SUPERADMIN' ? {} : { parcel: { batch: { hubId: user.hubId } } }) },
    select: { id: true, acknowledgedAt: true },
  });
  if (!alert) throw new ApiError(404, 'ALERT_NOT_FOUND', 'Alert not found');
  if (alert.acknowledgedAt) return alert;
  return prisma.alert.update({ where: { id: alert.id }, data: { acknowledgedAt: new Date(), acknowledgedBy: actor.id } });
}

export function isAssignmentEligible(parcel: { riderId: string | null; status: string }) {
  return parcel.riderId === null && assignmentEligibleStatuses.includes(parcel.status);
}

export function calculateLinkedDeliveryFee(baseDeliveryFee: number, parcelCount: number, increment = 1000) {
  if (!Number.isInteger(baseDeliveryFee) || baseDeliveryFee < 0 || !Number.isInteger(parcelCount) || parcelCount < 1 || !Number.isInteger(increment) || increment < 0) {
    throw new ApiError(400, "INVALID_LINKED_FEE", "Linked delivery fee inputs are invalid");
  }
  return baseDeliveryFee + (parcelCount - 1) * increment;
}

export function normalizeDeliveryAddress(address: string) {
  return address.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export async function linkParcels(input: { parcelIds: string[] }, actor: BatchActor) {
  const parcelIds = [...new Set(input.parcelIds)];
  if (parcelIds.length < 2 || parcelIds.length !== input.parcelIds.length) throw new ApiError(400, "INVALID_LINK_GROUP", "At least two unique parcels are required");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !assignmentRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not link parcels");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  if (parcelIds.length > 20) throw new ApiError(400, "LINK_GROUP_TOO_LARGE", "A linked group may contain at most 20 parcels");
  const parcels = await prisma.parcel.findMany({ where: { id: { in: parcelIds } }, select: { id: true, address: true, deliveryFee: true, riderId: true, linkGroupId: true, status: true, batch: { select: { hubId: true } } } });
  const first = parcels[0];
  if (parcels.length !== parcelIds.length || !first || first.deliveryFee === null || parcels.some((parcel) => normalizeDeliveryAddress(parcel.address) !== normalizeDeliveryAddress(first.address) || parcel.deliveryFee !== first.deliveryFee || parcel.riderId !== first.riderId || parcel.linkGroupId || parcel.status === "DELIVERED" || !parcel.batch.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId))) {
    throw new ApiError(409, "PARCELS_NOT_LINKABLE", "Every parcel must be unlinked, undelivered, in scope, assigned to the same rider, and have the same normalized address and base fee");
  }
  const baseDeliveryFee = first.deliveryFee;
  const totalDeliveryFee = calculateLinkedDeliveryFee(baseDeliveryFee, parcels.length);
  return prisma.$transaction(async (tx) => {
    const group = await tx.parcelLinkGroup.create({ data: { address: first.address, baseDeliveryFee, totalDeliveryFee } });
    const updated = await tx.parcel.updateMany({ where: { id: { in: parcelIds }, linkGroupId: null }, data: { linkGroupId: group.id } });
    if (updated.count !== parcelIds.length) throw new ApiError(409, "LINK_CONFLICT", "A parcel was linked by another dispatcher; refresh and retry");
    return tx.parcelLinkGroup.findUniqueOrThrow({ where: { id: group.id }, include: { parcels: { select: { id: true, trackingNumber: true, deliveryFee: true, linkGroupId: true } } } });
  });
}

type AssignmentParcel = {
  id: string;
  riderId: string | null;
  status: string;
  batch: { hubId: string | null; pickupDate: Date; label: string; shop: { name: string } };
};

export async function bulkAssignParcels(input: { parcelIds: string[]; riderId: string }, actor: BatchActor) {
  const uniqueParcelIds = [...new Set(input.parcelIds)];
  if (uniqueParcelIds.length === 0 || uniqueParcelIds.length !== input.parcelIds.length) throw new ApiError(400, "INVALID_PARCEL_IDS", "parcelIds must contain unique parcel IDs");
  if (uniqueParcelIds.length > 500) throw new ApiError(400, "BATCH_TOO_LARGE", "A dispatch action may contain at most 500 parcels");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !assignmentRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not assign parcels");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for dispatch");

  const rider = await prisma.rider.findUnique({ where: { id: input.riderId }, select: { id: true, hubId: true, user: { select: { name: true, active: true, role: true } } } });
  if (!rider || !rider.user.active || rider.user.role !== "RIDER") throw new ApiError(404, "RIDER_NOT_FOUND", "Active rider not found");
  if (!rider.hubId || (user.role !== "SUPERADMIN" && rider.hubId !== user.hubId)) throw new ApiError(403, "FORBIDDEN", "Rider is outside your hub scope");

  const parcels = await prisma.parcel.findMany({ where: { id: { in: uniqueParcelIds } }, select: { id: true, riderId: true, status: true, batch: { select: { hubId: true, pickupDate: true, label: true, shop: { select: { name: true } } } } } });
  const foundIds = new Set(parcels.map((parcel) => parcel.id));
  const invalid = uniqueParcelIds.filter((id) => {
    const parcel = parcels.find((candidate) => candidate.id === id) as AssignmentParcel | undefined;
    return !parcel || !isAssignmentEligible(parcel) || !parcel.batch.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId) || parcel.batch.hubId !== rider.hubId;
  });
  const missing = uniqueParcelIds.filter((id) => !foundIds.has(id));
  if (invalid.length > 0 || missing.length > 0) throw new ApiError(409, "PARCELS_NOT_ELIGIBLE", "Every selected parcel must be unassigned, dispatchable, and in the target rider's hub", { invalidParcelIds: invalid, missingParcelIds: missing });

  const assigned = await prisma.$transaction(async (tx) => {
    for (const parcel of parcels as AssignmentParcel[]) {
      const result = await tx.parcel.updateMany({ where: { id: parcel.id, riderId: null, status: parcel.status }, data: { riderId: rider.id, status: "ASSIGNED" } });
      if (result.count !== 1) throw new ApiError(409, "ASSIGNMENT_CONFLICT", "One or more parcels were assigned by another dispatcher; refresh and retry");
      await tx.packageAssignment.create({ data: { parcelId: parcel.id, riderId: rider.id, assignedById: actor.id } });
      await tx.statusHistory.create({ data: { parcelId: parcel.id, fromStatus: parcel.status, toStatus: "ASSIGNED", actorId: actor.id, note: `Bulk assigned to rider ${rider.id}` } });
    }
    return tx.parcel.findMany({ where: { id: { in: uniqueParcelIds } }, select: { id: true, trackingNumber: true, customerName: true, customerPhone: true, address: true, codAmount: true, deliveryFee: true, zone: true, township: true, batch: { select: { label: true, pickupDate: true, shop: { select: { name: true } } } } }, orderBy: { trackingNumber: "asc" } });
  });
  return { rider: { id: rider.id, name: rider.user.name, hubId: rider.hubId }, parcels: assigned, assignedCount: assigned.length };
}

function parseManifestDate(value: string | undefined, field: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", `${field} must be a valid date`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export type ManifestQuery = {
  riderIds?: string[];
  hubId?: string;
  dateFrom?: string;
  dateTo?: string;
  statuses?: string[];
};

export function summarizeManifestParcels(parcels: Array<{ status: string; codAmount: number; deliveryFee?: number | null }>) {
  const count = (status: string) => parcels.filter((parcel) => parcel.status === status).length;
  return {
    parcelCount: parcels.length,
    delivered: count("DELIVERED"),
    partial: count("PARTIAL"),
    failed: count("FAILED"),
    rejected: count("REJECTED"),
    pendingReturn: count("PENDING_RETURN"),
    toDeliver: parcels.filter((parcel) => ["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(parcel.status)).length,
    totalCod: parcels.reduce((sum, parcel) => sum + parcel.codAmount, 0),
    totalFees: parcels.reduce((sum, parcel) => sum + (parcel.deliveryFee ?? 0), 0),
  };
}

export async function buildManifestForRiders(input: ManifestQuery, actor: BatchActor) {
  const requestedIds = [...new Set(input.riderIds ?? [])];
  if (requestedIds.length !== (input.riderIds ?? []).length) throw new ApiError(400, "INVALID_RIDER_IDS", "riderIds must contain unique rider IDs");
  if (requestedIds.length > 50) throw new ApiError(400, "BATCH_TOO_LARGE", "A manifest may include at most 50 riders");
  if (input.statuses?.some((status) => !(MANIFEST_STATUSES as readonly string[]).includes(status))) {
    throw new ApiError(400, "INVALID_STATUS", "One or more manifest statuses are invalid");
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !manifestReadRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not view dispatch manifests");
  const hubId = user.role === "SUPERADMIN" ? input.hubId ?? user.hubId ?? undefined : user.hubId ?? undefined;
  if (user.role !== "SUPERADMIN" && !hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for dispatch");

  let riders = requestedIds.length
    ? await prisma.rider.findMany({
        where: { id: { in: requestedIds } },
        select: { id: true, hubId: true, hub: { select: { name: true } }, user: { select: { name: true, active: true, role: true } } },
      })
    : await prisma.rider.findMany({
        where: hubId ? { hubId } : {},
        select: { id: true, hubId: true, hub: { select: { name: true } }, user: { select: { name: true, active: true, role: true } } },
        take: 51,
        orderBy: { id: "asc" },
      });
  if (!requestedIds.length && riders.length > 50) throw new ApiError(400, "BATCH_TOO_LARGE", "Select at most 50 riders for a manifest");
  const uniqueRiderIds = requestedIds.length ? requestedIds : riders.map((rider) => rider.id);
  if (uniqueRiderIds.length === 0) {
    return {
      sections: [],
      summary: summarizeManifestParcels([]),
      riderCount: 0,
      parcelCount: 0,
      filenameSuffix: "none",
      statusesLabel: manifestStatusesLabel(input.statuses),
    };
  }

  const ridersById = new Map(riders.map((rider) => [rider.id, rider]));
  const missing = uniqueRiderIds.filter((id) => !ridersById.has(id));
  const outOfScope = uniqueRiderIds.filter((id) => {
    const rider = ridersById.get(id);
    return rider && (!rider.hubId || (user.role !== "SUPERADMIN" && rider.hubId !== user.hubId) || (hubId && rider.hubId !== hubId));
  });
  if (missing.length > 0 || outOfScope.length > 0) {
    throw new ApiError(404, "RIDER_NOT_FOUND", "One or more riders were not found in your hub scope", { missingRiderIds: missing, outOfScopeRiderIds: outOfScope });
  }

  const dateFrom = parseManifestDate(input.dateFrom, "dateFrom");
  const dateTo = parseManifestDate(input.dateTo, "dateTo", true);
  if (dateFrom && dateTo && dateFrom >= dateTo) throw new ApiError(400, "INVALID_DATE_RANGE", "dateFrom must be before dateTo");
  const statuses = input.statuses?.length ? input.statuses : [...DISPATCH_MANIFEST_STATUSES];

  const parcels = await prisma.parcel.findMany({
    where: {
      riderId: { in: uniqueRiderIds },
      status: { in: statuses },
      ...(hubId ? { batch: { hubId } } : {}),
      ...(dateFrom || dateTo
        ? {
            statusHistory: {
              some: {
                toStatus: { in: statuses },
                createdAt: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lt: dateTo } : {}),
                },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      riderId: true,
      status: true,
      trackingNumber: true,
      orderId: true,
      customerName: true,
      customerPhone: true,
      address: true,
      codAmount: true,
      deliveryFee: true,
      zone: true,
      township: true,
      batch: { select: { label: true, pickupDate: true, shop: { select: { name: true } } } },
    },
    orderBy: [{ riderId: "asc" }, { trackingNumber: "asc" }],
    take: 501,
  });

  if (parcels.length > 500) {
    throw new ApiError(400, "BATCH_TOO_LARGE", "A manifest may include at most 500 parcels");
  }

  const sections = uniqueRiderIds.map((riderId) => {
    const rider = ridersById.get(riderId)!;
    const riderParcels = parcels.filter((parcel) => parcel.riderId === riderId);
    return {
      riderId,
      riderName: rider.user.name,
      hubName: rider.hub?.name ?? undefined,
      parcels: riderParcels.map((parcel) => ({
        trackingNumber: parcel.trackingNumber,
        orderId: parcel.orderId,
        status: parcel.status,
        customerName: parcel.customerName,
        customerPhone: parcel.customerPhone,
        address: parcel.address,
        codAmount: parcel.codAmount,
        deliveryFee: parcel.deliveryFee,
        zone: parcel.zone,
        township: parcel.township,
        batchLabel: parcel.batch.label,
        pickupDate: parcel.batch.pickupDate,
        shopName: parcel.batch.shop.name,
        note: PDF_STATUS_NOTE[parcel.status] ?? parcel.status.slice(0, 4),
      })),
    };
  });

  return {
    sections,
    summary: summarizeManifestParcels(parcels),
    riderCount: uniqueRiderIds.length,
    parcelCount: parcels.length,
    filenameSuffix: uniqueRiderIds.length === 1 ? uniqueRiderIds[0]! : `${uniqueRiderIds.length}-riders`,
    statusesLabel: manifestStatusesLabel(input.statuses),
  };
}

export async function reassignParcel(parcelId: string, input: { riderId: string; reason: string }, actor: BatchActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !assignmentRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not reassign parcels");
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { id: true, riderId: true, status: true, batch: { select: { hubId: true } } } });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  if (!parcel.riderId || !["ASSIGNED", "PICKED_UP"].includes(parcel.status)) throw new ApiError(409, "PARCEL_NOT_REASSIGNABLE", "Only assigned parcels that are not out for delivery may be reassigned");
  if (parcel.riderId === input.riderId) throw new ApiError(409, "SAME_RIDER", "Choose a different rider");
  if (!parcel.batch.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId)) throw new ApiError(403, "FORBIDDEN", "Parcel is outside your hub scope");
  const rider = await prisma.rider.findUnique({ where: { id: input.riderId }, select: { id: true, hubId: true, user: { select: { active: true, role: true, name: true } } } });
  if (!rider || !rider.user.active || rider.user.role !== "RIDER") throw new ApiError(404, "RIDER_NOT_FOUND", "Active rider not found");
  if (rider.hubId !== parcel.batch.hubId) throw new ApiError(409, "HUB_MISMATCH", "Parcel and rider must belong to the same hub");
  return prisma.$transaction(async (tx) => {
    const changed = await tx.parcel.updateMany({ where: { id: parcel.id, riderId: parcel.riderId, status: parcel.status }, data: { riderId: rider.id, status: "ASSIGNED" } });
    if (changed.count !== 1) throw new ApiError(409, "ASSIGNMENT_CONFLICT", "Parcel assignment changed; refresh and retry");
    await tx.packageAssignment.updateMany({ where: { parcelId: parcel.id, endedAt: null }, data: { endedAt: new Date(), endedById: actor.id, reason: input.reason } });
    await tx.packageAssignment.create({ data: { parcelId: parcel.id, riderId: rider.id, assignedById: actor.id } });
    await tx.statusHistory.create({ data: { parcelId: parcel.id, fromStatus: parcel.status, toStatus: "ASSIGNED", actorId: actor.id, note: `Reassigned to ${rider.user.name}: ${input.reason}` } });
    return tx.parcel.findUniqueOrThrow({ where: { id: parcel.id }, include: { rider: { include: { user: { select: { name: true } } } }, assignments: { orderBy: { assignedAt: "desc" } } } });
  });
}

export function calculateReturnExtension(currentDueAt: Date, days: number) {
  if (Number.isNaN(currentDueAt.getTime()) || !Number.isInteger(days) || days < 1 || days > 30) throw new ApiError(400, "INVALID_RETURN_EXTENSION", "Return extension must be between 1 and 30 days");
  return new Date(currentDueAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function extendPendingReturn(parcelId: string, input: { days: number; reason: string }, actor: BatchActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not extend pending returns");
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, select: { id: true, status: true, returnDueAt: true, batch: { select: { hubId: true } } } });
  if (!parcel) throw new ApiError(404, "PARCEL_NOT_FOUND", "Parcel not found");
  if (parcel.status !== "PENDING_RETURN" || !parcel.returnDueAt) throw new ApiError(409, "PARCEL_NOT_PENDING_RETURN", "Only a pending return with a due date may be extended");
  if (!parcel.batch.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId)) throw new ApiError(403, "FORBIDDEN", "Parcel is outside your hub scope");
  const previousDueAt = parcel.returnDueAt;
  const newDueAt = calculateReturnExtension(previousDueAt, input.days);
  return prisma.$transaction(async (tx) => {
    const changed = await tx.parcel.updateMany({ where: { id: parcel.id, status: "PENDING_RETURN", returnDueAt: previousDueAt }, data: { returnDueAt: newDueAt } });
    if (changed.count !== 1) throw new ApiError(409, "RETURN_EXTENSION_CONFLICT", "Return due date changed; refresh and retry");
    await tx.statusHistory.create({ data: { parcelId: parcel.id, fromStatus: "PENDING_RETURN", toStatus: "PENDING_RETURN", actorId: actor.id, reasonCode: "RETURN_EXTENSION", note: `${input.reason} | ${previousDueAt.toISOString()} -> ${newDueAt.toISOString()}` } });
    return tx.parcel.findUniqueOrThrow({ where: { id: parcel.id } });
  });
}
