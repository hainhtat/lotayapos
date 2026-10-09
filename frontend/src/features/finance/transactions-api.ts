import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type WalletName = "CASH" | "KBZ_PAY" | "WAVE_PAY";
export type WalletStatement = { wallet: WalletName; opening: number; in: number; out: number; closing: number };
export type Transaction = {
  id: string;
  businessDate: string;
  createdAt: string;
  type: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  reverses?: { sourceType: string; sourceId: string | null; description: string } | null;
  reference: string | null;
  counterparty: string | null;
  recordedBy: string | null;
  wallets: Array<{ wallet: WalletName; amount: number }>;
  balancesAfter: Array<{ wallet: WalletName; balance: number }>;
};
export type TransactionStatement = {
  summary: { wallets: WalletStatement[] };
  items: Transaction[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export type StatementFilters = { hubId: string; from: string; to: string; wallet: string; type: string; riderId: string; shopId: string; page: number };

export function useTransactions(filters: StatementFilters) {
  return useQuery({
    queryKey: ["finance-transactions", filters],
    enabled: Boolean(filters.hubId && filters.from && filters.to && filters.from <= filters.to),
    queryFn: () => {
      const params = new URLSearchParams({ hubId: filters.hubId, from: filters.from, to: filters.to, page: String(filters.page), pageSize: "50" });
      if (filters.wallet) params.set("wallet", filters.wallet);
      if (filters.type) params.set("type", filters.type);
      if (filters.riderId) params.set("riderId", filters.riderId);
      if (filters.shopId) params.set("shopId", filters.shopId);
      return api<TransactionStatement>(`/finance/transactions?${params}`).then((response) => response.data);
    },
  });
}
