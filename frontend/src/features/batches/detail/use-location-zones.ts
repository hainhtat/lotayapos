import { useQuery } from "@tanstack/react-query";
import { getZones } from "./batch-detail-api";

export function useLocationZones(hubId?: string, townshipId?: string, enabled = true) {
  return useQuery({
    queryKey: ["locations", "zones", hubId, townshipId],
    enabled: enabled && Boolean(hubId && townshipId),
    queryFn: () => getZones(hubId!, townshipId!),
  });
}
