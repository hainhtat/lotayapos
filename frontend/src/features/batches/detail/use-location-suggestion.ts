import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ParcelRow } from "./batch-detail-types";
import { getLocationSuggestions } from "./batch-detail-api";

export function hasLookupPhone(phone: string) {
  return (phone.match(/[0-9\u1040-\u1049]/g) ?? []).length >= 7;
}

export function useLocationSuggestion(batchId: string, row: ParcelRow, enabled = true) {
  const [lookupRow, setLookupRow] = useState<ParcelRow | null>(null);
  useEffect(() => {
    setLookupRow(null);
    if (!enabled || !hasLookupPhone(row.customerPhone)) return;
    const timer = window.setTimeout(() => setLookupRow(row), 450);
    return () => window.clearTimeout(timer);
  }, [enabled, row.customerPhone, row.customerName, row.address, row.townshipId]);
  const query = useQuery({ queryKey: ["location-suggestion", batchId, lookupRow?.customerPhone, lookupRow?.customerName, lookupRow?.address, lookupRow?.townshipId], queryFn: () => getLocationSuggestions(batchId, [lookupRow!]), enabled: Boolean(lookupRow), retry: false, staleTime: 30_000 });
  const current = lookupRow?.customerPhone === row.customerPhone && lookupRow?.customerName === row.customerName && lookupRow?.address === row.address && lookupRow?.townshipId === row.townshipId;
  return { ...query, suggestion: current ? query.data?.[0] : undefined, pending: enabled && hasLookupPhone(row.customerPhone) && (!current || query.isPending) };
}
