import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type OperationsAlert = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
  parcel: { id: string; trackingNumber: string; orderId?: string | null; status: string; reasonCode?: string | null } | null;
};

export function useOperationsAlerts(enabled = true) {
  return useQuery({ queryKey: ["alerts"], queryFn: () => api<OperationsAlert[]>("/operations/alerts").then((response) => response.data), enabled, refetchInterval: 60_000 });
}

export function useAcknowledgeAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/operations/alerts/${encodeURIComponent(id)}/acknowledge`, { method: "POST" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["alerts"] }); },
  });
}
