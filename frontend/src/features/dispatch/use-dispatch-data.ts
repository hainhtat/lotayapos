import { useQuery } from "@tanstack/react-query";
import type { ManifestPreviewData } from "@/components/delivery-status-panel";
import { api, apiRaw } from "@/lib/api";
import { buildManifestBody } from "@/lib/manifest-filters";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { DispatchFilters as Filters } from "@/lib/dispatch-filters";
import type { Parcel, Township, Zone, BatchSummary, MasterData, ReasonCode, OsReturnListPreview, PaidToOsHandoverPreview } from "./dispatch-types";

function responseItems<T>(data: unknown, label: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && "items" in data && Array.isArray(data.items)) return data.items as T[];
  throw new Error(`Invalid ${label} list response`);
}

function masterData(data: unknown): MasterData {
  if (!data || typeof data !== "object" || !("riders" in data) || !Array.isArray(data.riders)) {
    throw new Error("Invalid master data response");
  }
  if ("shops" in data && data.shops != null && !Array.isArray(data.shops)) {
    throw new Error("Invalid master data response");
  }
  return data as MasterData;
}

export function useDispatchData(filters: Filters, page: number, editing: Parcel | null, townshipId: string) {
  const debouncedTextFilters=useDebouncedValue({trackingNumber:filters.trackingNumber,orderId:filters.orderId,customerName:filters.customerName,township:filters.township},350);
  const queryFilters={...filters,...debouncedTextFilters};
  const query = Object.entries(queryFilters)
    .filter(([, value]) => value)
    .map(([key, value]) => [key === "from" ? "dateFrom" : key === "to" ? "dateTo" : key, value]);
  const queryString = new URLSearchParams([...query, ["page", String(page)], ["pageSize", "100"]]).toString();

  const parcels = useQuery({
    queryKey: ["parcels", queryString],
    queryFn: async () => {
      const response = await apiRaw(`/parcels?${queryString}`);
      const body = (await response.json()) as {
        data: unknown;
        pagination?: { page: number; pageSize: number; total: number; totalPages: number };
      };
      return { items: responseItems<Parcel>(body.data, "parcel"), pagination: body.pagination };
    },
  });
  const overdueUnsent = useQuery({
    queryKey: ["overdue-unsent", 3],
    queryFn: () => apiRaw("/operations/parcels/overdue-unsent?days=3&pageSize=100").then(async response => {
      const body = await response.json() as { data?: Parcel[]; pagination?: { total: number } };
      return { items: body.data ?? [], total: body.pagination?.total ?? body.data?.length ?? 0 };
    }),
  });
  const masters = useQuery({
    queryKey: ["master-data"],
    queryFn: () => api<unknown>("/master-data").then((r) => masterData(r.data)),
  });
  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<unknown>("/operations/batches").then((r) => responseItems<BatchSummary>(r.data, "batch")),
  });
  const reasons = useQuery({
    queryKey: ["reason-codes"],
    queryFn: () => api<ReasonCode[]>("/master-data/reason-codes").then((r) => r.data),
  });
  const townships = useQuery({
    queryKey: ["locations", "townships", "all"],
    enabled: Boolean(editing),
    queryFn: () => api<Township[]>("/master-data/locations/townships").then((r) => r.data),
  });
  const editZones = useQuery({
    queryKey: ["locations", "zones", townshipId],
    enabled: Boolean(editing && townshipId),
    queryFn: () =>
      api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(townshipId)}`).then((r) => r.data),
  });

  return { queryString, parcels, overdueUnsent, masters, batches, reasons, townships, editZones };
}

export function useDispatchPreviews({ manifestBody, manifestOpen, selectedParcelIds, returnListOpen, returnListEligible, includePaidToOsHandover, canPaidToOsHandover, paidToOsHandoverBody }: {
  manifestBody: ReturnType<typeof buildManifestBody>;
  manifestOpen: boolean;
  selectedParcelIds: string[];
  returnListOpen: boolean;
  returnListEligible: boolean;
  includePaidToOsHandover: boolean;
  canPaidToOsHandover: boolean;
  paidToOsHandoverBody: Record<string, string>;
}) {
  const manifestPreview = useQuery({
    queryKey: ["manifest-preview", manifestBody],
    enabled: manifestOpen,
    queryFn: () => api<ManifestPreviewData>("/operations/parcels/manifest/preview", { method: "POST", body: JSON.stringify(manifestBody) }).then((result) => result.data),
  });
  const returnListPreview = useQuery({
    queryKey: ["os-return-list-preview", selectedParcelIds],
    enabled: returnListOpen && returnListEligible,
    queryFn: () => api<OsReturnListPreview>("/operations/parcels/returns/preview", { method: "POST", body: JSON.stringify({ parcelIds: selectedParcelIds }) }).then((result) => result.data),
  });
  const paidToOsListPreview = useQuery({
    queryKey: ["paid-to-os-handover-preview", paidToOsHandoverBody],
    enabled: returnListOpen && includePaidToOsHandover && canPaidToOsHandover,
    queryFn: () => api<PaidToOsHandoverPreview>("/operations/parcels/paid-to-os/preview", { method: "POST", body: JSON.stringify(paidToOsHandoverBody) }).then((result) => result.data),
  });
  return { manifestPreview, returnListPreview, paidToOsListPreview };
}
