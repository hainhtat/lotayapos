import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { normalizeCustomerPhone, normalizeCustomerText } from "./parcel-location-suggestions.service.js";
import { calculateLinkedDeliveryFee } from "./operations.service.js";

const MAX_SCAN = 20_000;
const MAX_GROUPS = 100;
const MAX_MEMBERS = 20;

type Candidate = {
  id: string; trackingNumber: string; customerName: string; customerPhone: string | null;
  address: string; township: string | null; status: string; riderId: string | null;
  deliveryFee: number | null; createdAt: Date;
  batch: { shopId: string; hubId: string | null; shop: { name: string } };
};

/** Read-only hints; a dispatcher still reviews the address, rider, and fee before the existing link command. */
export function buildParcelLinkSuggestions(rows: Candidate[]) {
  const candidates = new Map<string, Candidate[]>();
  for (const row of rows) {
    const phone = normalizeCustomerPhone(row.customerPhone);
    const name = normalizeCustomerText(row.customerName);
    if (!row.batch.hubId || phone.length < 7 || !name) continue;
    const key = `${row.batch.hubId}|${row.batch.shopId}|${phone}|${name}`;
    const group = candidates.get(key) ?? [];
    group.push(row);
    candidates.set(key, group);
  }
  const groups = [...candidates.entries()].filter(([, members]) => members.length >= 2).map(([sourceKey, members]) => {
    const shown = members.slice(0, MAX_MEMBERS);
    const baseDeliveryFee = Math.max(...shown.map((row) => row.deliveryFee ?? 0));
    const totalDeliveryFee = calculateLinkedDeliveryFee(baseDeliveryFee, shown.length);
    return {
      key: createHash("sha256").update(sourceKey).digest("hex").slice(0, 20),
      shopId: shown[0]!.batch.shopId,
      shopName: shown[0]!.batch.shop.name,
      hubId: shown[0]!.batch.hubId!,
      normalizedPhone: normalizeCustomerPhone(shown[0]!.customerPhone),
      normalizedName: normalizeCustomerText(shown[0]!.customerName),
      parcels: shown.map(({ id, trackingNumber, customerName, customerPhone, address, township, status, riderId, deliveryFee }) => ({ id, trackingNumber, customerName, customerPhone, address, townshipName: township, status, riderId, deliveryFee })),
      baseDeliveryFee,
      totalDeliveryFee,
      savings: shown.reduce((sum, row) => sum + (row.deliveryFee ?? 0), 0) - totalDeliveryFee,
      omittedCandidates: members.length - shown.length,
    };
  });
  return { groups: groups.slice(0, MAX_GROUPS), omittedGroups: Math.max(0, groups.length - MAX_GROUPS), omittedCandidates: groups.reduce((sum, group) => sum + group.omittedCandidates, 0) + groups.slice(MAX_GROUPS).reduce((sum, group) => sum + group.parcels.length, 0) };
}

export async function suggestParcelLinks(actor: { id: string; role: string }, requestedHubId?: string) {
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not review parcel links");
  if (user.role !== "SUPERADMIN" && (!user.hubId || (requestedHubId && requestedHubId !== user.hubId))) throw new ApiError(403, "FORBIDDEN", "Parcel links are outside your hub scope");
  const hubId = user.role === "SUPERADMIN" ? requestedHubId : user.hubId!;
  const where: Prisma.ParcelWhereInput = { linkGroupId: null, status: { notIn: ["DELIVERED", "RETURNED", "VOIDED"] }, customerPhone: { not: null }, batch: { hubId: hubId ? hubId : { not: null } } };
  const [total, rows] = await Promise.all([
    prisma.parcel.count({ where }),
    prisma.parcel.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_SCAN, select: {
      id: true, trackingNumber: true, customerName: true, customerPhone: true, address: true, township: true, status: true, riderId: true, deliveryFee: true, createdAt: true,
      batch: { select: { shopId: true, hubId: true, shop: { select: { name: true } } } },
    } }),
  ]);
  const result = buildParcelLinkSuggestions(rows);
  return { ...result, scanned: rows.length, unscannedParcelCount: Math.max(0, total - rows.length) };
}
