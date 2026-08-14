import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, WalletCards } from "lucide-react";
import { OsCashbookOverview } from "@/components/os-cashbook-overview";
import { PostPickupAdvancesPanel } from "@/components/post-pickup-advances-panel";
import { api } from "@/lib/api";
import { ledgerAccounts, type LedgerReport } from "@/lib/ledger";
import { CashbookExpenses } from "./cashbook-expenses";
import { SettlementWorkspaces } from "./settlement-workspaces";

type Batch = {
  id: string;
  label: string;
  pickupDate: string;
  advancePaid: number;
  advancePosted?: boolean;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};
type LedgerFilters = { from: string; to: string; account: string };
type FinanceTab = "overview" | "settlements";

const control =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";

function resolveFinanceTab(searchParams: URLSearchParams, hash: string): FinanceTab {
  if (searchParams.get("tab") === "settlements") return "settlements";
  if (hash === "#os-settlements" || hash === "#os-pending-returns" || hash === "#rider-outstanding") return "settlements";
  return "overview";
}

export function FinancePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<FinanceTab>(() => resolveFinanceTab(searchParams, location.hash));
  const [filters, setFilters] = useState<LedgerFilters>({ from: "", to: "", account: "" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showFilters, setShowFilters] = useState(false);
  const [message, setMessage] = useState("");
  const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const ledger = useQuery({
    queryKey: ["ledger", queryString],
    queryFn: () => api<LedgerReport>(`/finance/ledger${queryString ? `?${queryString}` : ""}`).then((r) => ledgerAccounts(r.data)),
  });
  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<Batch[]>("/operations/batches").then((r) => r.data),
    enabled: tab === "overview",
  });

  useEffect(() => {
    setTab(resolveFinanceTab(searchParams, location.hash));
  }, [searchParams, location.hash]);

  const selectTab = (next: FinanceTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", "settlements");
    setSearchParams(params, { replace: true });
    if (next === "overview" && (location.hash === "#os-settlements" || location.hash === "#os-pending-returns" || location.hash === "#rider-outstanding")) {
      window.history.replaceState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`);
    }
  };

  const walletBalance = (name: string) => ledger.data?.find((line) => line.account === name)?.balance ?? 0;
  const formatBalance = (name: string) => {
    const balance = walletBalance(name);
    return balance === 0 ? t("noBalance") : `${balance.toLocaleString()} MMK`;
  };

  const tabClass = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-bold ${active ? "bg-[#eaf6ff] text-[#0787df] dark:bg-[#133044]" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("finance")}</h1>
          <p className="mt-2 text-slate-500">{t("financeDescription")}</p>
        </div>
        <div role="tablist" aria-label={t("financeTabs")} className="flex flex-wrap gap-2">
          <button type="button" role="tab" aria-selected={tab === "overview"} className={tabClass(tab === "overview")} onClick={() => selectTab("overview")}>
            {t("financeOverview")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "settlements"} className={tabClass(tab === "settlements")} onClick={() => selectTab("settlements")}>
            {t("financeOsAndRiders")}
          </button>
        </div>
      </div>
      {message && <p role="status" className="mt-5 rounded-xl bg-[#eaf6ff] p-3 text-sm font-semibold text-[#0787df]">{message}</p>}

      {tab === "overview" ? (
        <>
          <OsCashbookOverview ledger={ledger.data ?? []} />
          <PostPickupAdvancesPanel
            batches={batches.data ?? []}
            loading={batches.isLoading}
            error={batches.isError}
            onRetry={() => void batches.refetch()}
            onMessage={setMessage}
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#101318] p-5 text-white">
              <WalletCards className="text-[#4db7ff]" size={20} />
              <p className="mt-6 text-sm text-slate-400">{t("cashWallet")}</p>
              <p className="mt-1 font-display text-2xl font-bold">{formatBalance("WALLET_CASH")}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">{t("kbzPay")}</p>
              <p className="mt-7 font-display text-2xl font-bold">{formatBalance("WALLET_KBZ_PAY")}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">{t("wavePay")}</p>
              <p className="mt-7 font-display text-2xl font-bold">{formatBalance("WALLET_WAVE_PAY")}</p>
            </div>
          </div>

          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">{t("journalBalances")}</h2>
              <button aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)} className="flex items-center gap-2 text-sm font-bold text-[#0787df]">
                {t("viewReconciliation")} <ArrowUpRight size={15} />
              </button>
            </div>
            {showFilters && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setFilters(draftFilters);
                }}
                className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5 sm:grid-cols-4"
              >
                <label className="text-xs font-bold text-slate-500">
                  {t("dateFrom")}
                  <input aria-label={t("dateFrom")} type="date" value={draftFilters.from} onChange={(event) => setDraftFilters((value) => ({ ...value, from: event.target.value }))} className={`${control} mt-1 w-full`} />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  {t("dateTo")}
                  <input aria-label={t("dateTo")} type="date" value={draftFilters.to} onChange={(event) => setDraftFilters((value) => ({ ...value, to: event.target.value }))} className={`${control} mt-1 w-full`} />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  {t("account")}
                  <input aria-label={t("account")} value={draftFilters.account} onChange={(event) => setDraftFilters((value) => ({ ...value, account: event.target.value }))} className={`${control} mt-1 w-full`} />
                </label>
                <button className="self-end rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">{t("applyFilters")}</button>
              </form>
            )}
            <div className="mt-5 overflow-x-auto">
              {ledger.isLoading ? (
                <p className="py-10 text-center text-sm text-slate-400">{t("loading")}</p>
              ) : ledger.isError ? (
                <div className="py-10 text-center">
                  <p className="text-sm text-rose-500">{t("loadError")}</p>
                  <button onClick={() => void ledger.refetch()} className="mt-3 text-sm font-bold text-[#0787df]">
                    {t("retry")}
                  </button>
                </div>
              ) : !ledger.data?.length ? (
                <p className="py-10 text-center text-sm text-slate-400">{t("empty")}</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400 dark:border-white/10">
                      <th className="pb-3">{t("account")}</th>
                      <th className="pb-3 text-right">{t("debit")}</th>
                      <th className="pb-3 text-right">{t("credit")}</th>
                      <th className="pb-3 text-right">{t("balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.map((line) => (
                      <tr key={line.account} className="border-b border-slate-50 dark:border-white/5">
                        <td className="py-4 font-semibold">{line.account}</td>
                        <td className="py-4 text-right">{line.debit.toLocaleString()}</td>
                        <td className="py-4 text-right">{line.credit.toLocaleString()}</td>
                        <td className="py-4 text-right font-bold">{line.balance.toLocaleString()} MMK</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          <CashbookExpenses />
        </>
      ) : (
        <SettlementWorkspaces />
      )}
    </div>
  );
}
