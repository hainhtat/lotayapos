import bcrypt from "bcryptjs";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";
import { summarizeRiderOutstandingThroughDate } from "./finance.service.js";

type Actor = { id: string; role: string };

async function actorScope(actor: Actor) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true, hubId: true } });
  if (!user || !user.active || user.role !== actor.role) throw new ApiError(403, "FORBIDDEN", "Active user scope required");
  return user;
}

export async function listMasterData(actor: Actor) {
  const user = await actorScope(actor);
  if (!['SUPERADMIN','OPERATIONS_MANAGER','FINANCE','DISPATCHER'].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not view operational master data");
  const hubWhere = user.role === "SUPERADMIN" ? {} : { id: user.hubId ?? "__none__" };
  const [hubs, shops, zones, riders] = await Promise.all([
    prisma.hub.findMany({ where: hubWhere, orderBy: { name: "asc" } }),
    prisma.onlineShop.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.zone.findMany({ where: user.role === "SUPERADMIN" ? {} : { hubId: user.hubId ?? "__none__" }, orderBy: { name: "asc" } }),
    prisma.rider.findMany({ where: user.role === "SUPERADMIN" ? { user: { active: true } } : { hubId: user.hubId ?? "__none__", user: { active: true } }, include: { user: { select: { name: true, email: true } }, hub: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  return { hubs, shops, zones, riders };
}

export async function createHub(input: { name: string }, actor: Actor) {
  const user = await actorScope(actor);
  if (user.role !== "SUPERADMIN") throw new ApiError(403, "FORBIDDEN", "Only Superadmin may create hubs");
  const existing = await prisma.hub.findFirst({ where: { name: input.name } });
  if (existing) throw new ApiError(409, "HUB_EXISTS", "A hub with this name already exists");
  return prisma.hub.create({ data: { name: input.name } });
}

export async function createShop(input: { name: string }, actor: Actor) {
  const user = await actorScope(actor);
  if (!['SUPERADMIN','OPERATIONS_MANAGER'].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not create online shops");
  return prisma.onlineShop.create({ data: { name: input.name } });
}

export async function listShops(actor: Actor) {
  await actorScope(actor);
  return prisma.onlineShop.findMany({ orderBy: { name: "asc" } });
}

export async function getShop(id: string, actor: Actor) {
  await actorScope(actor);
  const shop = await prisma.onlineShop.findUnique({ where: { id }, include: { batches: { orderBy: { pickupDate: "desc" } } } });
  if (!shop) throw new ApiError(404, "SHOP_NOT_FOUND", "Online shop not found");
  return shop;
}

export async function createZone(input: { name: string; hubId: string; townshipId: string }, actor: Actor) {
  const user = await actorScope(actor);
  if (!['SUPERADMIN','OPERATIONS_MANAGER'].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not create zones");
  if (user.role !== "SUPERADMIN" && input.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  const township = await prisma.township.findUnique({ where: { id: input.townshipId }, select: { id: true } });
  if (!township) throw new ApiError(404, "TOWNSHIP_NOT_FOUND", "Township not found");
  return prisma.zone.create({ data: input });
}

export const RIDER_PAY_MODELS = ["PERCENTAGE", "SALARY", "SALARY_PLUS_PERCENTAGE"] as const;
export type RiderPayModel = (typeof RIDER_PAY_MODELS)[number];

export function normalizeRiderPayFields(input: { payModel: string; commissionRateBps: number; monthlySalary: number }) {
  if (!RIDER_PAY_MODELS.includes(input.payModel as RiderPayModel)) {
    throw new ApiError(400, "INVALID_PAY_MODEL", "Pay model must be PERCENTAGE, SALARY, or SALARY_PLUS_PERCENTAGE");
  }
  const payModel = input.payModel as RiderPayModel;
  const needsCommission = payModel === "PERCENTAGE" || payModel === "SALARY_PLUS_PERCENTAGE";
  const needsSalary = payModel === "SALARY" || payModel === "SALARY_PLUS_PERCENTAGE";
  if (!Number.isInteger(input.commissionRateBps) || input.commissionRateBps < 0) {
    throw new ApiError(400, "INVALID_COMMISSION_RATE", "Commission rate (bps) must be a non-negative integer");
  }
  if (!Number.isInteger(input.monthlySalary) || input.monthlySalary < 0) {
    throw new ApiError(400, "INVALID_MONTHLY_SALARY", "Monthly salary must be a non-negative integer");
  }
  if (needsCommission && input.commissionRateBps <= 0) {
    throw new ApiError(400, "INVALID_COMMISSION_RATE", "Commission rate (bps) must be greater than 0 for this pay model");
  }
  if (!needsCommission && input.commissionRateBps !== 0) {
    throw new ApiError(400, "INVALID_COMMISSION_RATE", "Commission rate must be 0 for SALARY pay model");
  }
  if (needsSalary && input.monthlySalary <= 0) {
    throw new ApiError(400, "INVALID_MONTHLY_SALARY", "Monthly salary must be greater than 0 for this pay model");
  }
  if (!needsSalary && input.monthlySalary !== 0) {
    throw new ApiError(400, "INVALID_MONTHLY_SALARY", "Monthly salary must be 0 for PERCENTAGE pay model");
  }
  return {
    payModel,
    commissionRateBps: needsCommission ? input.commissionRateBps : 0,
    monthlySalary: needsSalary ? input.monthlySalary : 0,
  };
}

export async function createRider(
  input: { name: string; username: string; email: string; password: string; hubId: string; payModel: string; commissionRateBps: number; monthlySalary: number },
  actor: Actor,
) {
  const pay = normalizeRiderPayFields({
    payModel: input.payModel,
    commissionRateBps: input.commissionRateBps,
    monthlySalary: input.monthlySalary,
  });
  const user = await actorScope(actor);
  if (!['SUPERADMIN','OPERATIONS_MANAGER'].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not create riders");
  if (user.role !== "SUPERADMIN" && input.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  return prisma.$transaction(async (tx) => {
    const username = input.username.trim().toLowerCase();
    const existing = await tx.user.findFirst({ where: { OR: [{ email: input.email }, { username }] }, select: { id: true } });
    if (existing) throw new ApiError(409, "USER_EXISTS", "A user with that email or username already exists");
    const created = await tx.user.create({ data: { name: input.name, username, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), role: "RIDER", hubId: input.hubId } });
    return tx.rider.create({
      data: { userId: created.id, hubId: input.hubId, ...pay },
      include: { user: { select: { name: true, email: true } }, hub: { select: { name: true } } },
    });
  });
}

export async function updateRider(
  id: string,
  input: { name?: string; hubId?: string; payModel?: string; commissionRateBps?: number; monthlySalary?: number },
  actor: Actor,
) {
  const user = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not update riders");
  const rider = await prisma.rider.findUnique({
    where: { id },
    select: { id: true, userId: true, hubId: true, payModel: true, commissionRateBps: true, monthlySalary: true },
  });
  if (!rider) throw new ApiError(404, "RIDER_NOT_FOUND", "Rider not found");
  if (user.role !== "SUPERADMIN" && rider.hubId !== user.hubId) throw new ApiError(403, "FORBIDDEN", "Rider is outside your hub scope");
  if (input.hubId !== undefined && user.role !== "SUPERADMIN" && input.hubId !== user.hubId) {
    throw new ApiError(403, "FORBIDDEN", "Hub is outside your scope");
  }
  const payTouched = input.payModel !== undefined || input.commissionRateBps !== undefined || input.monthlySalary !== undefined;
  const pay = payTouched
    ? normalizeRiderPayFields({
      payModel: input.payModel ?? rider.payModel,
      commissionRateBps: input.commissionRateBps ?? rider.commissionRateBps,
      monthlySalary: input.monthlySalary ?? rider.monthlySalary,
    })
    : null;
  return prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.hubId !== undefined) {
      await tx.user.update({
        where: { id: rider.userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.hubId !== undefined ? { hubId: input.hubId } : {}),
        },
      });
    }
    return tx.rider.update({
      where: { id },
      data: {
        ...(input.hubId !== undefined ? { hubId: input.hubId } : {}),
        ...(pay ? pay : {}),
      },
      include: { user: { select: { name: true, email: true } }, hub: { select: { name: true } } },
    });
  });
}

const reasonOutcomes = ["PARTIAL", "FAILED", "REJECTED"];

export function normalizeReasonCode(code: string) {
  return code.trim().toUpperCase();
}

export async function listReasonCodes(actor: Actor, outcome?: string) {
  const user = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER", "RIDER", "AUDITOR"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not view reason codes");
  return prisma.reasonCode.findMany({ where: { ...(outcome ? { outcome } : {}), ...(user.role === "RIDER" ? { active: true } : {}) }, orderBy: [{ outcome: "asc" }, { code: "asc" }] });
}

export async function createReasonCode(input: { code: string; labelEn: string; labelMy: string; outcome: string; noteRequired?: boolean }, actor: Actor) {
  const user = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not manage reason codes");
  if (!reasonOutcomes.includes(input.outcome)) throw new ApiError(400, "INVALID_REASON_OUTCOME", "Reason outcome is invalid");
  const code = normalizeReasonCode(input.code);
  const existing = await prisma.reasonCode.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw new ApiError(409, "REASON_CODE_EXISTS", "Reason code already exists");
  return prisma.reasonCode.create({ data: { ...input, code, noteRequired: input.noteRequired ?? false } });
}

export async function updateReasonCode(id: string, input: { labelEn?: string; labelMy?: string; noteRequired?: boolean; active?: boolean }, actor: Actor) {
  const user = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not manage reason codes");
  const existing = await prisma.reasonCode.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(404, "REASON_CODE_NOT_FOUND", "Reason code not found");
  return prisma.reasonCode.update({ where: { id }, data: input });
}

async function assertLocationReader(actor:Actor){const user=await actorScope(actor);if(!["SUPERADMIN","OPERATIONS_MANAGER","FINANCE","DISPATCHER","RIDER","AUDITOR"].includes(user.role))throw new ApiError(403,"FORBIDDEN","You may not view locations");return user;}
export async function listRegions(actor:Actor){await assertLocationReader(actor);return prisma.regionState.findMany({orderBy:{nameEn:"asc"}});}
export async function listDistricts(regionStateId:string,actor:Actor){await assertLocationReader(actor);return prisma.district.findMany({where:{regionStateId},orderBy:{nameEn:"asc"}});}
export async function listTownships(districtId:string|undefined,actor:Actor){
  await assertLocationReader(actor);
  return prisma.township.findMany({
    where: districtId ? { districtId } : undefined,
    include: { district: { include: { regionState: true } } },
    orderBy: [{ district: { regionState: { nameEn: "asc" } } }, { district: { nameEn: "asc" } }, { nameEn: "asc" }],
  });
}
export async function listZones(townshipId:string,hubId:string|undefined,actor:Actor){const user=await assertLocationReader(actor);const scopedHub=user.role==="SUPERADMIN"?hubId:user.hubId??"__none__";return prisma.zone.findMany({where:{townshipId,...(scopedHub?{hubId:scopedHub}:{})},orderBy:{name:"asc"}});}

export async function updateTownshipDeliveryFees(input: { townshipIds: string[]; deliveryFee: number }, actor: Actor) {
  const user = await actorScope(actor);
  if (!["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not update delivery fees");
  if (!Number.isInteger(input.deliveryFee) || input.deliveryFee < 0) throw new ApiError(400, "INVALID_DELIVERY_FEE", "Delivery fee must be a non-negative integer");
  const uniqueIds = [...new Set(input.townshipIds)];
  if (uniqueIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "Select at least one township");
  const existing = await prisma.township.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } });
  if (existing.length !== uniqueIds.length) throw new ApiError(404, "TOWNSHIP_NOT_FOUND", "One or more townships were not found");
  await prisma.township.updateMany({ where: { id: { in: uniqueIds } }, data: { deliveryFee: input.deliveryFee } });
  return prisma.township.findMany({ where: { id: { in: uniqueIds } }, include: { district: { include: { regionState: true } } }, orderBy: { nameEn: "asc" } });
}
type LocationRow={regionCode:string;regionNameEn:string;regionNameMy:string;districtCode:string;districtNameEn:string;districtNameMy:string;townshipCode:string;townshipNameEn:string;townshipNameMy?:string;deliveryFee?:number|null};
export async function importLocations(input:{source:string;version:string;rows:LocationRow[]},actor:Actor){const user=await actorScope(actor);if(user.role!=="SUPERADMIN")throw new ApiError(403,"FORBIDDEN","Only Superadmin may import locations");if(!/^MIMU/i.test(input.source))throw new ApiError(400,"UNVERIFIED_LOCATION_SOURCE","Location import source must identify the vetted MIMU dataset");return prisma.$transaction(async tx=>{for(const row of input.rows){const region=await tx.regionState.upsert({where:{code:row.regionCode},update:{nameEn:row.regionNameEn,nameMy:row.regionNameMy},create:{code:row.regionCode,nameEn:row.regionNameEn,nameMy:row.regionNameMy}});const district=await tx.district.upsert({where:{code:row.districtCode},update:{regionStateId:region.id,nameEn:row.districtNameEn,nameMy:row.districtNameMy},create:{code:row.districtCode,regionStateId:region.id,nameEn:row.districtNameEn,nameMy:row.districtNameMy}});await tx.township.upsert({where:{code:row.townshipCode},update:{districtId:district.id,nameEn:row.townshipNameEn,nameMy:row.townshipNameMy,...(row.deliveryFee!==undefined?{deliveryFee:row.deliveryFee}:{})},create:{code:row.townshipCode,districtId:district.id,nameEn:row.townshipNameEn,nameMy:row.townshipNameMy,deliveryFee:row.deliveryFee}});}const audit=await tx.locationImportAudit.create({data:{source:input.source,version:input.version,rowCount:input.rows.length,importedById:actor.id}});return {source:input.source,version:input.version,imported:input.rows.length,auditId:audit.id};});}

export async function dashboardOverview(actor: Actor) {
  const user = await actorScope(actor);
  const dashboardRoles = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER", "AUDITOR"];
  if (!dashboardRoles.includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not view the ERP dashboard");
  if (user.role !== "SUPERADMIN" && !user.hubId) throw new ApiError(403, "FORBIDDEN", "A hub scope is required for this action");
  const businessDate = businessDateFor(new Date(), env.hubTimezone);
  const nextBusinessDate = new Date(businessDate.getTime() + 24 * 60 * 60 * 1000);
  const hubId = user.role === "SUPERADMIN" ? undefined : user.hubId!;
  const financialAccess = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "AUDITOR"].includes(user.role);
  const [allParcels, batches, financialLines, allProfitLines, returnMetrics, alertCount, unsettledBatches, walletLines, expenseTotal, allExpenseTotal, riderOutstandingSummary] = await Promise.all([
    prisma.parcel.groupBy({ by: ["status"], where: hubId ? { batch: { hubId } } : {}, _count: { _all: true } }),
    prisma.batch.findMany({ where: { ...(hubId ? { hubId } : {}), pickupDate: { gte: businessDate, lt: nextBusinessDate } }, include: { shop: true, parcels: { select: { status: true } } }, orderBy: { pickupDate: "desc" }, take: 5 }),
    financialAccess ? prisma.journalLine.groupBy({ by:["account"], where: { account: { in: ["WALLET_CASH", "WALLET_KBZ_PAY", "WALLET_WAVE_PAY", "CUSTOMER_COD_RECEIVABLE", "OS_COD_PAYABLE", "DELIVERY_FEE_REVENUE", "RIDER_COMMISSION_EXPENSE"] }, entry: { ...(hubId ? { hubId } : {}), businessDate: { gte: businessDate, lt: nextBusinessDate } } }, _sum:{debit:true,credit:true} }) : Promise.resolve([]),
    financialAccess ? prisma.journalLine.groupBy({ by:["account"], where: { account: { in: ["DELIVERY_FEE_REVENUE", "RIDER_COMMISSION_EXPENSE"] }, entry: { ...(hubId ? { hubId } : {}) } }, _sum:{debit:true,credit:true} }) : Promise.resolve([]),
    Promise.all([prisma.parcel.count({ where: { ...(hubId ? { batch: { hubId } } : {}), status: "PENDING_RETURN", OR:[{returnDueAt:null},{returnDueAt:{gte:new Date()}}] } }),prisma.parcel.count({ where: { ...(hubId ? { batch: { hubId } } : {}), status: "PENDING_RETURN", returnDueAt:{lt:new Date()} } })]),
    prisma.alert.count({ where: { acknowledgedAt: null, ...(hubId ? { parcel: { batch: { hubId } } } : {}) } }),
    financialAccess ? prisma.batch.findMany({ where: { ...(hubId ? { hubId } : {}), parcels: { every: { status: { in: ["DELIVERED", "PARTIAL", "RETURNED", "CANCELLED"] } } }, settlementLinks: { none: { settlement: { status: "POSTED" } } } }, select: { id: true } }) : Promise.resolve([]),
    financialAccess ? prisma.journalLine.groupBy({ by:["account"], where: { account: { in: ["WALLET_CASH", "WALLET_KBZ_PAY", "WALLET_WAVE_PAY"] }, entry: { ...(hubId ? { hubId } : {}) } }, _sum:{debit:true,credit:true} }) : Promise.resolve([]),
    financialAccess ? prisma.expenseEntry.aggregate({ where: { ...(hubId ? { hubId } : {}), businessDate: { gte: businessDate, lt: nextBusinessDate } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    financialAccess ? prisma.expenseEntry.aggregate({ where: { ...(hubId ? { hubId } : {}) }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    financialAccess ? summarizeRiderOutstandingThroughDate(businessDate, hubId) : Promise.resolve({ outstandingAmount: 0, unsettledRiderCount: 0, rows: [] }),
  ]);
  const balance = (lines: Array<{_sum:{debit:number|null;credit:number|null}}>) => lines.reduce((sum, line) => sum + (line._sum.debit??0) - (line._sum.credit??0), 0);
  const accountLines = (account: string) => financialLines.filter((line) => line.account === account);
  const allAccountLines = (account: string) => allProfitLines.filter((line) => line.account === account);
  const walletBalance = (account: string) => balance(walletLines.filter((line) => line.account === account));
  const now = new Date();
  return {
    businessDate: businessDate.toISOString().slice(0, 10),
    totalParcels: allParcels.reduce((sum,row)=>sum+row._count._all,0),
    delivered: allParcels.find((row)=>row.status === "DELIVERED")?._count._all??0,
    pendingReturn: allParcels.find((row)=>row.status === "PENDING_RETURN")?._count._all??0,
    returnsDue: returnMetrics[0],
    returnsOverdue: returnMetrics[1],
    failedPartialAlerts: alertCount,
    ...(financialAccess ? {
      cashCollected: balance(accountLines("WALLET_CASH")),
      codCollectedToday: -balance(accountLines("CUSTOMER_COD_RECEIVABLE")) - balance(accountLines("OS_COD_PAYABLE")),
      deliveryFeesToday: -balance(accountLines("DELIVERY_FEE_REVENUE")),
      riderOutstanding: riderOutstandingSummary.outstandingAmount,
      unsettledRiderCount: riderOutstandingSummary.unsettledRiderCount,
      unsettledOnlineShopBatches: unsettledBatches.length,
      walletBalances: { cash: walletBalance("WALLET_CASH"), kbzPay: walletBalance("WALLET_KBZ_PAY"), wavePay: walletBalance("WALLET_WAVE_PAY") },
      expenseTotalToday: expenseTotal._sum.amount ?? 0,
      grossProfit: -balance(allAccountLines("DELIVERY_FEE_REVENUE")) - balance(allAccountLines("RIDER_COMMISSION_EXPENSE")) - (allExpenseTotal._sum.amount ?? 0),
      profitComponents: { deliveryFeeRevenue: -balance(allAccountLines("DELIVERY_FEE_REVENUE")), riderCommissionExpense: balance(allAccountLines("RIDER_COMMISSION_EXPENSE")), expenses: allExpenseTotal._sum.amount ?? 0 },
    } : {}),
    deepLinks: { riderOutstanding: `/finance?tab=settlements&businessDate=${businessDate.toISOString().slice(0, 10)}#rider-outstanding`, onlineShopSettlements: "/finance?tab=settlements#os-settlements", returnsDue: "/operations/dispatch?status=PENDING_RETURN", failedPartialAlerts: "/operations/batches#alerts", expenses: `/finance?businessDate=${businessDate.toISOString().slice(0, 10)}#expenses` },
    batches,
  };
}

export function businessDateFor(now: Date, timeZone: string) {
  if (Number.isNaN(now.getTime())) throw new ApiError(400, "INVALID_DATE", "Invalid dashboard date");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
}
