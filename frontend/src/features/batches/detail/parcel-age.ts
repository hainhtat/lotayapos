import type { SavedParcel } from "./batch-detail-types";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const RESOLVED_STATUSES = new Set(["DELIVERED", "RETURNED", "VOIDED"]);

export function isParcelThreeDaysInHand(parcel: Pick<SavedParcel, "status" | "createdAt">, now = Date.now()) {
  if (RESOLVED_STATUSES.has(parcel.status) || !parcel.createdAt) return false;
  const createdAt = Date.parse(parcel.createdAt);
  return Number.isFinite(createdAt) && createdAt <= now - THREE_DAYS_MS;
}
