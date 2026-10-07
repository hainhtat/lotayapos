import { api, apiRaw } from "@/lib/api";
import type { Batch, Location, ManifestPreview, ParcelRow, SavedParcel, Township, Zone } from "./batch-detail-types";
import { normalizeCodAmount, normalizeManifestRow } from "./parcel-draft-rules";

export const getBatch = (id: string) => api<Batch>(`/operations/batches/${id}`).then((response) => response.data);
export const getRegions = () => api<Location[]>("/master-data/locations/regions").then((response) => response.data);
export const getTownships = () => api<Township[]>("/master-data/locations/townships").then((response) => response.data);
export const getZones = (hubId: string, townshipId: string) => api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(townshipId)}&hubId=${encodeURIComponent(hubId)}`).then((response) => response.data);
export const finalizeBatch = (id: string) => api(`/operations/batches/${id}/finalize`, { method: "POST" });
export const updateBatchParcel = (parcel: SavedParcel, fields: { orderId: string; customerName: string; address: string; customerPhone: string; codAmount: string; deliveryFee: string; townshipId: string; zoneId: string }, finalized: boolean) => {
  const canEditDeliveryFields = !finalized && ["CREATED", "PICKED_UP", "ASSIGNED"].includes(parcel.status) && !parcel.linkGroupId;
  return api(`/parcels/${parcel.id}`, { method: "PATCH", body: JSON.stringify({
    orderId: fields.orderId.trim() || null, customerName: fields.customerName.trim(), address: fields.address.trim(), customerPhone: fields.customerPhone.trim() || null,
    ...(canEditDeliveryFields ? { codAmount: Number(fields.codAmount), deliveryFee: Number(fields.deliveryFee), townshipId: fields.townshipId, zoneId: fields.zoneId || null } : {}),
  }) });
};
export const saveBatchParcels = (id: string, entries: Array<{ row: ParcelRow; index: number }>) => api(`/operations/batches/${id}/parcels/bulk`, {
  method: "POST", body: JSON.stringify({ parcels: entries.map(({ row }) => ({
    orderId: row.orderId.trim() || undefined, customerName: row.customerName.trim(), address: row.address.trim(), townshipId: row.townshipId, zoneId: row.zoneId || undefined,
    customerPhone: row.customerPhone.trim() || undefined, codAmount: Number(normalizeCodAmount(row.codAmount)),
  })) }),
});
export const previewBatchManifest = async (id: string, file: File): Promise<ManifestPreview> => {
  const response = await apiRaw(`/operations/batches/${id}/manifest-preview`, { method: "POST", headers: { "content-type": "application/pdf" }, body: file });
  const payload = await response.json() as { success: true; data: ManifestPreview };
  if (!Array.isArray(payload.data?.rows)) throw new Error("INVALID_MANIFEST_PREVIEW");
  return { ...payload.data, rows: payload.data.rows.map((row) => ({
    ...normalizeManifestRow(row ?? {}), sourcePage: Number.isSafeInteger(row?.sourcePage) ? row.sourcePage : 0,
    confidence: typeof row?.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0,
    warnings: Array.isArray(row?.warnings) ? row.warnings.filter((warning) => typeof warning === "string") : [],
  })) };
};
