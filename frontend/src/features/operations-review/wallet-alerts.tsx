import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth";

export type WalletAlert = {
  id: string;
  hubId: string;
  hubName: string;
  wallet: "CASH" | "KBZ_PAY" | "WAVE_PAY";
  balance: number;
  shortfall: number;
};

export function useWalletAlerts(enabled = true) {
  const user = useAuth().user;
  return useQuery({
    queryKey: ["wallet-alerts", user?.id ?? null],
    queryFn: () => api<unknown>("/operations/wallet-alerts").then((response) => {
      if (!Array.isArray(response.data)) throw new Error("Invalid wallet alerts response");
      return response.data as WalletAlert[];
    }),
    enabled: enabled && Boolean(user),
    refetchInterval: 60_000,
  });
}

export function WalletAlertItem({ alert }: { alert: WalletAlert }) {
  const { t } = useTranslation();
  const walletKey = alert.wallet === "CASH" ? "cash" : alert.wallet === "KBZ_PAY" ? "kbzPay" : "wavePay";
  return <article className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-800/60 dark:bg-rose-950/20">
    <p className="text-xs font-bold text-rose-800 dark:text-rose-300">{t("negativeWalletBalance")}</p>
    <p className="mt-1 text-sm font-semibold">{alert.hubName} · {t(walletKey)}</p>
    <p className="mt-1 text-sm text-rose-800 dark:text-rose-300">{t("walletCurrentBalance", { amount: alert.balance.toLocaleString() })}</p>
    <p className="mt-1 text-sm text-rose-800 dark:text-rose-300">{t("walletShortfall", { amount: alert.shortfall.toLocaleString() })}</p>
  </article>;
}
