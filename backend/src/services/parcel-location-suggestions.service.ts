import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export type LocationDraftRow = { customerName: string; customerPhone?: string; address?: string; townshipId?: string };
type Candidate = {
  customerName: string; address: string; townshipId: string; township: string; districtId: string; district: string;
  regionStateId: string; regionState: string; lastUsedAt: string; source: "PHONE" | "NAME_ADDRESS";
};
type HistoryRow = Omit<Candidate, "source"> & { customerName: string; customerPhone: string | null };
const historyCache = new Map<string, { expiresAt: number; rows: Promise<HistoryRow[]> }>();
const HISTORY_CACHE_MS = 30_000;
const HISTORY_CACHE_LIMIT = 4;

// Myanmar's common local and +95 forms must compare equally. Other numbers remain exact digit matches.
export function normalizeCustomerPhone(value?: string | null) {
  const digits = (value ?? "").replace(/[\u1040-\u1049]/g, (digit) => String(digit.charCodeAt(0) - 0x1040)).replace(/\D/g, "");
  if (digits.startsWith("0095")) return `0${digits.slice(4)}`;
  if (digits.startsWith("95")) return `0${digits.slice(2)}`;
  return digits;
}

export function normalizeCustomerText(value?: string | null) {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

export function classifyLocationSuggestions(rows: LocationDraftRow[], history: HistoryRow[]) {
  const byPhone = new Map<string, HistoryRow[]>();
  const byNameAddress = new Map<string, HistoryRow[]>();
  for (const item of history) {
    const phone = normalizeCustomerPhone(item.customerPhone);
    if (phone.length >= 7) {
      const matches = byPhone.get(phone) ?? [];
      matches.push(item);
      byPhone.set(phone, matches);
    }
    const nameAddress = `${normalizeCustomerText(item.customerName)}|${normalizeCustomerText(item.address)}`;
    const matches = byNameAddress.get(nameAddress) ?? [];
    matches.push(item);
    byNameAddress.set(nameAddress, matches);
  }
  return rows.map((row, index) => {
    const phone = normalizeCustomerPhone(row.customerPhone);
    const phoneMatches = phone.length >= 7 ? byPhone.get(phone) ?? [] : [];
    const fallbackKey = `${normalizeCustomerText(row.customerName)}|${normalizeCustomerText(row.address)}`;
    const fallback = phoneMatches.length || !normalizeCustomerText(row.customerName) || !normalizeCustomerText(row.address)
      ? [] : byNameAddress.get(fallbackKey) ?? [];
    const source: Candidate["source"] = phoneMatches.length ? "PHONE" : "NAME_ADDRESS";
    const matches = phoneMatches.length ? phoneMatches : fallback;
    const unique = new Map<string, HistoryRow>();
    for (const match of matches) {
      const key = `${normalizeCustomerText(match.address)}|${match.townshipId}`;
      if (!unique.has(key)) unique.set(key, match);
    }
    const candidates: Candidate[] = [...unique.values()].slice(0, 3).map(({ customerPhone: _phone, ...candidate }) => ({ ...candidate, source }));
    if (!candidates.length) return { index, kind: "NONE" as const, candidates };
    if (source === "NAME_ADDRESS") return { index, kind: "NAME_ADDRESS" as const, candidates };
    if (unique.size > 1) return { index, kind: "MULTIPLE" as const, candidates };
    const candidate = candidates[0]!;
    const addressConflict = Boolean(normalizeCustomerText(row.address) && normalizeCustomerText(row.address) !== normalizeCustomerText(candidate.address));
    const townshipConflict = Boolean(row.townshipId && row.townshipId !== candidate.townshipId);
    const nameConflict = Boolean(normalizeCustomerText(row.customerName) && normalizeCustomerText(candidate.customerName) && normalizeCustomerText(row.customerName) !== normalizeCustomerText(candidate.customerName));
    return { index, kind: addressConflict || townshipConflict || nameConflict ? "CONFLICT" as const : "SAFE" as const, candidates };
  });
}

function loadRecentHistory(shopId: string, hubId: string | null): Promise<HistoryRow[]> {
  const key = `${shopId}:${hubId}`;
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  historyCache.delete(key);
  const rows = prisma.parcel.findMany({
    where: { status: { not: "VOIDED" }, townshipId: { not: null }, batch: { shopId, hubId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20_000,
    select: { customerName: true, customerPhone: true, address: true, createdAt: true,
      townshipRelation: { select: { id: true, nameEn: true, district: { select: { id: true, nameEn: true, regionState: { select: { id: true, nameEn: true } } } } } },
    },
  }).then((history) => history.flatMap((parcel) => {
    const township = parcel.townshipRelation;
    if (!township || !parcel.address.trim()) return [];
    return [{ address: parcel.address, townshipId: township.id, township: township.nameEn,
      districtId: township.district.id, district: township.district.nameEn,
      regionStateId: township.district.regionState.id, regionState: township.district.regionState.nameEn,
      lastUsedAt: parcel.createdAt.toISOString(), customerName: parcel.customerName, customerPhone: parcel.customerPhone }];
  })).catch((error) => { historyCache.delete(key); throw error; });
  historyCache.set(key, { expiresAt: Date.now() + HISTORY_CACHE_MS, rows });
  if (historyCache.size > HISTORY_CACHE_LIMIT) historyCache.delete(historyCache.keys().next().value!);
  return rows;
}

/** Read only. Historical search is bounded to the latest 20,000 parcels for the selected shop and hub. */
export async function suggestParcelLocations(batchId: string, rows: LocationDraftRow[], actor: { id: string; role: string }) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new ApiError(400, "INVALID_SUGGESTION_ROWS", "Provide 1 to 500 parcel rows");
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { active: true, role: true, hubId: true } });
  if (!user?.active || user.role !== actor.role || !["SUPERADMIN", "OPERATIONS_MANAGER", "DISPATCHER"].includes(user.role)) throw new ApiError(403, "FORBIDDEN", "You may not add parcels");
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ...(user.role === "SUPERADMIN" ? {} : { hubId: user.hubId }) },
    select: { shopId: true, hubId: true, finalizedAt: true },
  });
  if (!batch) throw new ApiError(404, "BATCH_NOT_FOUND", "Batch not found");
  if (batch.finalizedAt) throw new ApiError(409, "BATCH_FINALIZED", "A finalized batch cannot accept more parcels");
  const usable = await loadRecentHistory(batch.shopId, batch.hubId);
  return { rows: classifyLocationSuggestions(rows, usable) };
}
