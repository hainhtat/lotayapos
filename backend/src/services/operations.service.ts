import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import type { Prisma } from "@prisma/client";
import { ApiError } from "../utils/api-error.js";
import { assertCashbookOpen } from "./finance.service.js";
import { buildRiderCommissionLines, buildRiderReceivableRecognitionLines, calculateCommissionAmount, journalEntryIsUnreversed, nextVersionedJournalSourceId } from "./parcel.service.js";
import { postedAdvanceByBatch, syncBatchObligation } from "./os-account.service.js";
import { resolveCommissionRateBps } from "../utils/commission.js";
import { buildDeliveryCollectionLines } from "./ledger.service.js";

export type FundingWallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";
const walletAccounts: Record<FundingWallet, string> = { CASH: "WALLET_CASH", KBZ_PAY: "WALLET_KBZ_PAY", WAVE_PAY: "WALLET_WAVE_PAY" };
type BatchActor = { id: string; role: string };
const operationsReadRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER"];
const assignmentRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"];
const manifestReadRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER", "FINANCE", "AUDITOR"];
export const DISPATCH_MANIFEST_STATUSES = ["ASSIGNED", "OUT_FOR_DELIVERY", "PICKED_UP"] as const;
const MANIFEST_STATUSES = ["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"] as const;
const EXCEPTION_NOTE_STATUSES = ["FAILED", "PARTIAL", "REJECTED", "PENDING_RETURN", "RETURNED"] as const;
/** Statuses whose history rows may carry rider/ops exception notes (excludes RETURNED itself). */
const EXCEPTION_HISTORY_STATUSES = ["FAILED", "PARTIAL", "REJECTED", "PENDING_RETURN"] as const;

export function sanitizeManifestFilenamePart(value: string, maxLength = 60) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
  return sanitized || "rider";
}

export function yangonBusinessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function buildManifestFilenameSuffix(input: {
  riderCount: number;
  riderName?: string | null;
  riderId?: string | null;
  at?: Date;
}) {
  const date = yangonBusinessDate(input.at ?? new Date());
  if (input.riderCount <= 0) return `lotaya-manifest-empty-${date}`;
  if (input.riderCount === 1) {
    const name = sanitizeManifestFilenamePart(input.riderName ?? "rider");
    if (name === "rider" && input.riderId) {
      const idPart = sanitizeManifestFilenamePart(input.riderId.slice(-8), 12);
      return `lotaya-manifest-rider-${idPart}-${date}`;
    }
    return `lotaya-manifest-${name}-${date}`;
  }
  return `lotaya-manifest-${input.riderCount}-riders-${date}`;
}

function exceptionNoteFromHistory(
  history: Array<{ note: string | null; reasonCode: string | null }> | undefined,
  reasonCode: string | null,
) {
  const latest = history?.[0];
  const fromHistory = latest?.note?.trim() || latest?.reasonCode?.trim() || "";
  const raw = fromHistory || reasonCode?.trim() || null;
  if (!raw) return null;
  return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
}

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
  return [{ account: "OS_COD_PAYABLE", debit: advanceAmount, credit: 0 }, { account: walletAccount(fundingWallet), debit: 0, credit: advanceAmount }];
}

export function batchMutationLockMode(databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db") {
  return /^postgres(ql)?:\/\//.test(databaseUrl) ? "POSTGRES_ADVISORY" as const : "SQLITE_WRITE" as const;
}

async function acquireBatchMutationLock(tx: Prisma.TransactionClient, batchId: string) {
  if (batchMutationLockMode() === "POSTGRES_ADVISORY") {
    await tx.$queryRaw<Array<{ locked: number }>>`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtext(${batchId}))`;
    return;
  }
  await tx.batch.updateMany({ where: { id: batchId }, data: { advancePaid: { increment: 0 } } });
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

export type BatchListFilters = {
  page?: number;
  pageSize?: number;
  shopId?: string;
  hubId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export const OVERDUE_UNSENT_STATUSES = ["CREATED", "PICKED_UP", "ASSIGNED"] as const;

function calendarDateInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function overdueUnsentCutoffDate(at = new Date(), days = 3, timeZone = env.hubTimezone) {
  const today = calendarDateInZone(at, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! - days)).toISOString().slice(0, 10);
}

export async function listOverdueUnsentParcels(
  actor: BatchActor,
  input: { page?: number; pageSize?: number; days?: number; hubId?: string } = {},
) {
  const user = await assertOperationsReader(actor);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const days = input.days ?? 3;
  if (user.role !== "SUPERADMIN" && input.hubId && input.hubId !== user.hubId)
    throw new ApiError(403, "FORBIDDEN", "Overdue parcels are outside your hub scope");
  const hubId = user.role === "SUPERADMIN" ? input.hubId : user.hubId ?? undefined;
  const cutoffDate = overdueUnsentCutoffDate(new Date(), days);
  // Batch pickup dates are stored as normalized calendar dates at UTC midnight.
  const cutoff = new Date(`${cutoffDate}T00:00:00.000Z`);
  const where: Prisma.ParcelWhereInput = {
    status: { in: [...OVERDUE_UNSENT_STATUSES] },
    batch: { pickupDate: { lte: cutoff }, ...(hubId ? { hubId } : {}) },
  };
  const [items, total] = await Promise.all([
    prisma.parcel.findMany({
      where,
      include: {
        batch: { select: { id: true, label: true, pickupDate: true, shop: { select: { id: true, name: true } } } },
        rider: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: [{ batch: { pickupDate: "asc" } }, { trackingNumber: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.parcel.count({ where }),
  ]);
  return { items, total, page, pageSize, days, cutoffDate };
}

function batchSearchWhere(search: string): Prisma.BatchWhereInput {
  const contains = env.databaseProvider === "postgresql"
    ? { contains: search.trim(), mode: "insensitive" as const }
    : { contains: search.trim() };
  return { OR: [{ label: contains }, { shop: { name: contains } }] };
}

export async function listBatches(actor: BatchActor, filters: BatchListFilters = {}) {
  const user = await assertOperationsReader(actor);
  if (user.role !== "SUPERADMIN" && filters.hubId && filters.hubId !== user.hubId) {
    throw new ApiError(403, "FORBIDDEN", "Batch hub is outside your hub scope");
  }
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 200;
  const dateFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : undefined;
  const dateTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999Z`) : undefined;
  if (dateFrom && dateTo && dateFrom > dateTo) throw new ApiError(400, "INVALID_DATE_RANGE", "dateFrom must not be after dateTo");
  const conditions: Prisma.BatchWhereInput[] = [
    user.role === "SUPERADMIN" ? (filters.hubId ? { hubId: filters.hubId } : {}) : { hubId: user.hubId },
  ];
  if (filters.shopId) conditions.push({ shopId: filters.shopId });
  if (dateFrom || dateTo) conditions.push({ pickupDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } });
  if (filters.search?.trim()) conditions.push(batchSearchWhere(filters.search));
  const where: Prisma.BatchWhereInput = conditions.length === 1 ? conditions[0]! : { AND: conditions };
  const [batches, total] = await Promise.all([
    prisma.batch.findMany({
      where,
      include: { shop: true, parcels: { select: { status: true } } },
      orderBy: [{ pickupDate: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.batch.count({ where }),
  ]);
  if (!batches.length) return { items: [], total, page, pageSize };
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
  return { items: batches.map((batch) => ({ ...batch, advancePosted: postedBatchIds.has(batch.id) })), total, page, pageSize };
}
export function formatTrackingNumber(sequence: number) {
  return `LTY-${String(sequence).padStart(3, "0")}`;
}

type TrackingSequenceClient = Pick<Prisma.TransactionClient, "$queryRaw" | "parcel">;

export async function acquireTrackingAllocationLock(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  provider = env.databaseProvider,
) {
  if (provider !== "postgresql") return;
  // Prisma's PostgreSQL adapter cannot deserialize pg_advisory_xact_lock's
  // native void return value. Project a supported scalar while evaluating it.
  const lock = await client.$queryRaw<Array<{ locked: number }>>`
    SELECT 1::integer AS locked
    FROM pg_advisory_xact_lock(1280268628)
  `;
  if (lock[0]?.locked !== 1) {
    throw new ApiError(500, "TRACKING_LOCK_FAILED", "Could not acquire the tracking allocation lock");
  }
}

async function nextTrackingSequenceStartWith(client: TrackingSequenceClient) {
  if (env.databaseProvider === "postgresql") {
    const rows = await client.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(SUBSTRING("trackingNumber" FROM 5) AS INTEGER)) AS max
      FROM "Parcel"
      WHERE "trackingNumber" ~ '^LTY-[0-9]+$'
    `;
    return Number(rows[0]?.max ?? 0) + 1;
  }
  const parcels = await client.parcel.findMany({ where: { trackingNumber: { startsWith: "LTY-" } }, select: { trackingNumber: true } });
  const highest = parcels.reduce((max, parcel) => {
    const match = /^LTY-(\d+)$/.exec(parcel.trackingNumber);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return highest + 1;
}

export async function nextTrackingSequenceStart() {
  return nextTrackingSequenceStartWith(prisma);
}

export async function getBatchDetail(id:string,actor:BatchActor){
  const user=await assertOperationsReader(actor);
  const batch=await prisma.batch.findFirst({
    where:{id,...(user.role==="SUPERADMIN"?{}:{hubId:user.hubId})},
    include:{shop:true,hub:true,parcels:{include:{townshipRelation:{include:{district:{include:{regionState:true}}}},zoneRelation:true},orderBy:{trackingNumber:"asc"}}},
  });
  if(!batch)throw new ApiError(404,"BATCH_NOT_FOUND","Batch not found");
  const totalCod=batch.parcels.reduce((sum,parcel)=>sum+parcel.codAmount,0);
  const advancePostedAmount=(await postedAdvanceByBatch(prisma,[batch.id])).get(batch.id) ?? 0;
  const deliveryFeeCredit=batch.parcels.reduce((sum,parcel)=>sum+(parcel.deliveryFee ?? 0),0);
  const returnedCod=batch.parcels.reduce((sum,parcel)=>sum+(parcel.status === "RETURNED" ? parcel.codAmount : 0),0);
  const remainingToOs=totalCod-advancePostedAmount-deliveryFeeCredit-returnedCod;
  return {...batch,totalCod,advancePostedAmount,deliveryFeeCredit,returnedCod,remainingToOs,nextTrackingSequence:await nextTrackingSequenceStart()};
}

type NewParcelInput = { trackingNumber?: string; orderId?: string | null; customerName: string; customerPhone?: string; address: string; codAmount: number; townshipId: string; zoneId?: string };

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
  const batch=await prisma.batch.findFirst({where:{id:batchId,...(user.role==="SUPERADMIN"?{}:{hubId:user.hubId})},select:{id:true,hubId:true,finalizedAt:true}});
  if(!batch) throw new ApiError(404,"BATCH_NOT_FOUND","Batch not found");
  if(batch.finalizedAt) throw new ApiError(409,"BATCH_FINALIZED","A finalized batch cannot accept more parcels");
  const townshipIds=[...new Set(input.parcels.map(p=>p.townshipId))];
  const townships=await prisma.township.findMany({where:{id:{in:townshipIds}},select:{id:true,nameEn:true,deliveryFee:true}});
  if(townships.length!==townshipIds.length) throw new ApiError(400,"INVALID_TOWNSHIP","One or more townships are invalid");
  const townshipById=new Map(townships.map(t=>[t.id,t]));
  const zoneIds=[...new Set(input.parcels.flatMap(p=>p.zoneId?[p.zoneId]:[]))];
  const zones=zoneIds.length?await prisma.zone.findMany({where:{id:{in:zoneIds}},select:{id:true,townshipId:true,hubId:true,name:true}}):[];
  const zoneById=new Map(zones.map(z=>[z.id,z]));
  if(zones.length!==zoneIds.length||input.parcels.some(p=>p.zoneId&&(zoneById.get(p.zoneId)?.townshipId!==p.townshipId||zoneById.get(p.zoneId)?.hubId!==batch.hubId))) throw new ApiError(400,"INVALID_ZONE","Zone must belong to the selected township and batch hub");
  const createAttempt = () => prisma.$transaction(async tx=>{
    await acquireBatchMutationLock(tx, batchId);
    const currentBatch = await tx.batch.findUnique({ where: { id: batchId }, select: { finalizedAt: true } });
    if (!currentBatch || currentBatch.finalizedAt) throw new ApiError(409,"BATCH_FINALIZED","A finalized batch cannot accept more parcels");
    // Serialize allocation in PostgreSQL. SQLite writes are serialized by the database;
    // the bounded retry below also covers a stale read racing another transaction.
    await acquireTrackingAllocationLock(tx);
    const sequenceStart = await nextTrackingSequenceStartWith(tx);
    const trackingNumbers = input.parcels.map((_, index) => formatTrackingNumber(sequenceStart + index));
    await tx.parcel.createMany({data:input.parcels.map((p,index)=>{const township=townshipById.get(p.townshipId)!;const zone=p.zoneId?zoneById.get(p.zoneId):undefined;return {orderId:p.orderId,customerName:p.customerName,customerPhone:p.customerPhone,address:p.address,codAmount:p.codAmount,townshipId:p.townshipId,zoneId:p.zoneId,zone:zone?.name,township:township.nameEn,deliveryFee:township.deliveryFee,advanceAmount:0,batchId,trackingNumber:trackingNumbers[index]!};})});
    return tx.parcel.findMany({where:{batchId,trackingNumber:{in:trackingNumbers}},include:{townshipRelation:{include:{district:{include:{regionState:true}}}},zoneRelation:true}});
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await createAttempt();
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002" || attempt === 4) throw error;
    }
  }
  throw new ApiError(409, "TRACKING_ALLOCATION_CONFLICT", "Could not allocate unique tracking numbers; retry the request");
}

export async function finalizeBatch(batchId: string, actor: BatchActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not finalize batches");
  return prisma.$transaction(async (tx) => {
    await acquireBatchMutationLock(tx, batchId);
    const batch = await tx.batch.findFirst({ where: { id: batchId, ...(user.role === "SUPERADMIN" ? {} : { hubId: user.hubId }) }, include: { osObligation: true, _count: { select: { parcels: true } } } });
    if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
    if (batch._count.parcels < 1) throw new ApiError(409, "EMPTY_BATCH", "Add at least one parcel before finalizing the batch");
    if (batch.finalizedAt) {
      if (!batch.osObligation) throw new ApiError(409, "FINALIZATION_INCOMPLETE", "The finalized batch is missing its OS obligation");
      return { batchId, finalizedAt: batch.finalizedAt, finalizedBy: batch.finalizedBy, obligation: batch.osObligation, replay: true };
    }
    const finalized = await tx.batch.updateMany({ where: { id: batchId, finalizedAt: null }, data: { finalizedAt: new Date(), finalizedBy: actor.id } });
    if (finalized.count !== 1) throw new ApiError(409, "BATCH_FINALIZE_CONFLICT", "Batch changed while finalizing; refresh and retry");
    const obligation = await syncBatchObligation(tx, batchId);
    const current = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, select: { finalizedAt: true, finalizedBy: true } });
    return { batchId, finalizedAt: current.finalizedAt, finalizedBy: current.finalizedBy, obligation, replay: false };
  }, { isolationLevel: "Serializable" });
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
    select: { id: true, pickupDate: true, hubId: true, label:true, advancePaid:true, finalizedAt:true },
  });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (!batch.hubId) throw new ApiError(409, "BATCH_HUB_REQUIRED", "Batch must belong to a hub before advances can be posted");
  if (!batch.finalizedAt) throw new ApiError(409, "BATCH_NOT_FINALIZED", "Finalize the batch before posting its advance");
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

export async function linkParcels(input: { parcelIds: string[]; responsibleRiderId: string; reason: string }, actor: BatchActor) {
  const parcelIds = [...new Set(input.parcelIds)];
  if (parcelIds.length < 2 || parcelIds.length !== input.parcelIds.length) throw new ApiError(400, "INVALID_LINK_GROUP", "At least two unique parcels are required");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role || !assignmentRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not link parcels");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  if (parcelIds.length > 20) throw new ApiError(400, "LINK_GROUP_TOO_LARGE", "A linked group may contain at most 20 parcels");
  const rider = await prisma.rider.findUnique({ where: { id: input.responsibleRiderId }, include: { user: { select: { active: true, role: true } } } });
  if (!rider?.user.active || rider.user.role !== "RIDER" || !rider.hubId || (user.role !== "SUPERADMIN" && rider.hubId !== user.hubId)) throw new ApiError(404, "RIDER_NOT_FOUND", "Active responsible rider was not found in scope");
  const parcels = await prisma.parcel.findMany({ where: { id: { in: parcelIds } }, select: { id: true, address: true, deliveryFee: true, riderId: true, linkGroupId: true, status: true, updatedAt: true, batch: { select: { hubId: true } } } });
  const first = parcels[0];
  if (parcels.length !== parcelIds.length || !first || parcels.some((parcel) => parcel.linkGroupId || ["DELIVERED", "RETURNED"].includes(parcel.status) || parcel.batch.hubId !== rider.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId))) {
    throw new ApiError(409, "PARCELS_NOT_LINKABLE", "Every parcel must be unlinked, not delivered or returned, and in the responsible rider's hub");
  }
  const baseDeliveryFee = Math.max(...parcels.map((parcel) => parcel.deliveryFee ?? 0));
  const totalDeliveryFee = calculateLinkedDeliveryFee(baseDeliveryFee, parcels.length);
  return prisma.$transaction(async (tx) => {
    const group = await tx.parcelLinkGroup.create({ data: { address: first.address, baseDeliveryFee, totalDeliveryFee } });
    for (const parcel of parcels) {
      const status = ["CREATED", "PICKED_UP"].includes(parcel.status) ? "ASSIGNED" : parcel.status;
      const updated = await tx.parcel.updateMany({ where: { id: parcel.id, linkGroupId: null, updatedAt: parcel.updatedAt }, data: { linkGroupId: group.id, riderId: rider.id, status } });
      if (updated.count !== 1) throw new ApiError(409, "LINK_CONFLICT", "A parcel changed while linking; refresh and retry");
      if (parcel.riderId !== rider.id) {
        await tx.packageAssignment.updateMany({ where: { parcelId: parcel.id, endedAt: null }, data: { endedAt: new Date(), endedById: actor.id, reason: input.reason.trim() } });
        await tx.packageAssignment.create({ data: { parcelId: parcel.id, riderId: rider.id, assignedById: actor.id, reason: input.reason.trim() } });
      }
      await tx.statusHistory.create({ data: { parcelId: parcel.id, fromStatus: parcel.status, toStatus: status, actorId: actor.id, note: `Linked group ${group.id}: ${input.reason.trim()}` } });
    }
    return { ...(await tx.parcelLinkGroup.findUniqueOrThrow({ where: { id: group.id }, include: { parcels: { select: { id: true, trackingNumber: true, deliveryFee: true, linkGroupId: true, riderId: true } } } })), responsibleRiderId: rider.id, reassignedCount: parcels.filter((parcel) => parcel.riderId !== rider.id).length };
  });
}

export async function unlinkParcelGroup(input: { groupId: string; reason: string; businessDate: string; idempotencyKey: string }, actor: BatchActor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || ![...assignmentRoles, "FINANCE"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not unlink parcels");
  const date = new Date(`${input.businessDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  const marker = await prisma.journalEntry.findUnique({ where: { sourceType_sourceId: { sourceType: "PARCEL_LINK_UNLINK", sourceId: input.idempotencyKey } } });
  if (marker) return { groupId: input.groupId, replay: true };
  return prisma.$transaction(async (tx) => {
    const group = await tx.parcelLinkGroup.findUnique({ where: { id: input.groupId }, include: { parcels: { include: { rider: true, batch: { select: { hubId: true } } } } } });
    if (!group?.parcels.length) throw new ApiError(404, "LINK_GROUP_NOT_FOUND", "Linked parcel group not found");
    if (group.parcels.some((parcel) => !parcel.batch.hubId || (user.role !== "SUPERADMIN" && parcel.batch.hubId !== user.hubId))) throw new ApiError(403, "FORBIDDEN", "Linked group is outside your hub scope");
    const groupTypes = ["LINKED_RIDER_COMMISSION", "LINKED_RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_FEE", "LINKED_DELIVERY_COLLECTION", "LINKED_OS_SHORTFALL"];
    const parcelIds = group.parcels.map((parcel) => parcel.id);
    const originals = await tx.journalEntry.findMany({ where: { OR: [{ sourceType: { in: groupTypes }, OR: [{ sourceId: group.id }, { sourceId: { startsWith: `${group.id}:` } }] }, { sourceType: "LINKED_RIDER_RECEIVABLE_COD", OR: parcelIds.flatMap((id) => [{ sourceId: id }, { sourceId: { startsWith: `${id}:` } }]) }] }, include: { lines: true } });
    const liveOriginals = [] as typeof originals;
    for (const original of originals) if (await journalEntryIsUnreversed(tx, original.id)) liveOriginals.push(original);
    if (liveOriginals.length > 0) {
      if (!["SUPERADMIN", "FINANCE"].includes(user.role)) throw new ApiError(403, "FINANCIAL_CORRECTION_REQUIRED", "Only Finance or Superadmin may unlink a financially posted group");
      await assertCashbookOpen(tx, date, group.parcels[0]!.batch.hubId!);
    }
    const liveCollections: typeof originals = [];
    let reversedCount = 0;
    for (const original of liveOriginals) {
      if (original.sourceType === "LINKED_DELIVERY_COLLECTION") liveCollections.push(original);
      await tx.journalEntry.create({ data: { sourceType: "LEDGER_REVERSAL", sourceId: original.id, hubId: original.hubId, businessDate: date, description: `Unlink correction: ${input.reason.trim()}`, lines: { create: original.lines.map((line) => ({ account: line.account, debit: line.credit, credit: line.debit })) } } });
      if (["LINKED_RIDER_RECEIVABLE_RECOGNITION", "LINKED_RIDER_RECEIVABLE_COD", "LINKED_RIDER_RECEIVABLE_FEE"].includes(original.sourceType) && original.sourceId) {
        const projection = await tx.riderReceivableRecognition.findUnique({ where: { sourceType_sourceId: { sourceType: original.sourceType, sourceId: original.sourceId } } });
        if (projection) await tx.riderReceivableRecognition.create({ data: { sourceType: "RIDER_RECEIVABLE_CORRECTION", sourceId: `${projection.id}:unlink:${input.idempotencyKey}`, riderId: projection.riderId, hubId: projection.hubId, businessDate: date, codAmount: -projection.codAmount, deliveryFee: -projection.deliveryFee, commissionAmount: -projection.commissionAmount, receivableAmount: -projection.receivableAmount } });
      }
      reversedCount += 1;
    }
    await tx.parcel.updateMany({ where: { linkGroupId: group.id }, data: { linkGroupId: null } });
    let recalculatedCount = 0;
    for (const parcel of group.parcels.filter((item) => item.status === "DELIVERED" && item.riderId && item.batch.hubId)) {
      const commission = calculateCommissionAmount(parcel.deliveryFee ?? 0, resolveCommissionRateBps(parcel.rider!));
      const recognition = buildRiderReceivableRecognitionLines(parcel.codAmount, parcel.deliveryFee ?? 0, commission);
      const sourceId = `${parcel.id}:unlink:${input.idempotencyKey}`;
      if (commission > 0) await tx.journalEntry.create({ data: { sourceType: "RIDER_COMMISSION", sourceId, hubId: parcel.batch.hubId!, businessDate: date, description: `Individual commission after unlink`, lines: { create: buildRiderCommissionLines(commission) } } });
      if (recognition.receivableAmount > 0) {
        await tx.journalEntry.create({ data: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId, hubId: parcel.batch.hubId!, businessDate: date, description: `Individual fee after unlink`, lines: { create: recognition.lines } } });
        await tx.riderReceivableRecognition.create({ data: { sourceType: "RIDER_RECEIVABLE_RECOGNITION", sourceId, riderId: parcel.riderId!, hubId: parcel.batch.hubId!, businessDate: date, codAmount: parcel.codAmount, deliveryFee: parcel.deliveryFee ?? 0, commissionAmount: commission, receivableAmount: recognition.receivableAmount } });
      }
      const way = await tx.deliveryWay.findFirst({ where: { parcelId: parcel.id, outcome: "DELIVERED" }, orderBy: { completedAt: "desc" }, select: { id: true } });
      if (way) await tx.deliveryWay.update({ where: { id: way.id }, data: { commissionAmount: commission } });
      recalculatedCount += 1;
    }
    let repostedCollectionCount = 0;
    for (const collection of liveCollections) {
      let codRemaining = collection.lines.filter((line) => line.account === "OS_BATCH_COD_CLEARING").reduce((sum, line) => sum + line.credit - line.debit, 0);
      let feeRemaining = collection.lines.filter((line) => line.account === "DELIVERY_FEE_REVENUE").reduce((sum, line) => sum + line.credit - line.debit, 0);
      const walletLine = collection.lines.find((line) => line.account.startsWith("WALLET_") && line.debit > line.credit);
      const wallet = walletLine?.account.replace("WALLET_", "") as FundingWallet | undefined;
      if (!wallet) throw new ApiError(409, "UNLINK_COLLECTION_INVALID", "Linked collection wallet could not be determined");
      for (const parcel of group.parcels.filter((item) => item.status === "DELIVERED")) {
        const collectedCod = Math.min(parcel.codAmount, codRemaining);
        const collectedDeliveryFee = Math.min(parcel.deliveryFee ?? 0, feeRemaining);
        codRemaining -= collectedCod; feeRemaining -= collectedDeliveryFee;
        if (collectedCod + collectedDeliveryFee <= 0) continue;
        const split = buildDeliveryCollectionLines({ collectedCod, collectedDeliveryFee, advanceAmount: parcel.advanceAmount, wallet });
        await tx.journalEntry.create({ data: { sourceType: "DELIVERY_COLLECTION", sourceId: `${parcel.id}:unlink:${input.idempotencyKey}`, hubId: parcel.batch.hubId!, businessDate: date, description: `Individual collection after unlink`, lines: { create: split.lines } } });
        repostedCollectionCount += 1;
      }
      if (codRemaining !== 0 || feeRemaining !== 0) throw new ApiError(409, "UNLINK_COLLECTION_ALLOCATION_FAILED", "Linked collection could not be allocated to individual parcels");
    }
    await tx.journalEntry.create({ data: { sourceType: "PARCEL_LINK_UNLINK", sourceId: input.idempotencyKey, hubId: group.parcels[0]!.batch.hubId!, businessDate: date, description: `Unlinked ${group.id}: ${input.reason.trim()}` } });
    return { groupId: group.id, parcelCount: group.parcels.length, reversedCount, recalculatedCount, repostedCollectionCount, replay: false };
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
      filenameSuffix: buildManifestFilenameSuffix({ riderCount: 0 }),
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
      reasonCode: true,
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
      statusHistory: {
        where: { toStatus: { in: [...EXCEPTION_HISTORY_STATUSES] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { note: true, reasonCode: true },
      },
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
      parcels: riderParcels.map((parcel) => {
        const exceptionStatus = (EXCEPTION_NOTE_STATUSES as readonly string[]).includes(parcel.status);
        return {
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
          note: exceptionStatus ? exceptionNoteFromHistory(parcel.statusHistory, parcel.reasonCode) : null,
        };
      }),
    };
  });

  return {
    sections,
    summary: summarizeManifestParcels(parcels),
    riderCount: uniqueRiderIds.length,
    parcelCount: parcels.length,
    filenameSuffix: buildManifestFilenameSuffix({
      riderCount: uniqueRiderIds.length,
      riderName: uniqueRiderIds.length === 1 ? ridersById.get(uniqueRiderIds[0]!)?.user.name : undefined,
      riderId: uniqueRiderIds.length === 1 ? uniqueRiderIds[0] : undefined,
    }),
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
