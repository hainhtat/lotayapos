import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, WalletCards, X } from "lucide-react";
import { OsCashbookOverview } from "@/components/os-cashbook-overview";
import { PostPickupAdvancesPanel } from "@/components/post-pickup-advances-panel";
import { api } from "@/lib/api";
import { ledgerAccounts, type LedgerSummary } from "@/lib/ledger";
import { CashbookExpenses } from "./cashbook-expenses";
import { SettlementWorkspaces } from "./settlement-workspaces";
import { useAuth } from "@/app/auth";
import { hubBusinessDate } from "@/lib/business-date";
import { ModalPortal } from "@/components/modal-portal";

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
type Hub = { id: string; name: string };
type Wallet = "CASH" | "KBZ_PAY" | "WAVE_PAY";

const control =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";

function resolveFinanceTab(searchParams: URLSearchParams, hash: string, pathname = ""): FinanceTab {
  if (pathname.endsWith("/settlements")) return "settlements";
  if (searchParams.get("tab") === "settlements") return "settlements";
  if (hash === "#os-settlements" || hash === "#os-pending-returns" || hash === "#rider-outstanding") return "settlements";
  return "overview";
}

function WalletAdjustmentDialog({ wallet, currentBalance, hubs, onClose, onSaved }: { wallet: Wallet; currentBalance: number; hubs: Hub[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [actual, setActual] = useState(String(Math.max(0, currentBalance)));
  const [businessDate, setBusinessDate] = useState(() => hubBusinessDate());
  const [hubId, setHubId] = useState(hubs.length === 1 ? hubs[0].id : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());
  const actualAmount = Number(actual);
  const difference = Number.isInteger(actualAmount) && actualAmount >= 0 ? actualAmount - currentBalance : null;
  const requiresHub = user?.role === "SUPERADMIN";
  const save = useMutation({
    mutationFn: () => {
      if (difference === null || difference === 0) throw new Error(t("invalidAmount"));
      if (reason.trim().length < 3) throw new Error(t("walletAdjustmentReasonRequired"));
      if (requiresHub && !hubId) throw new Error(t("selectHubBeforeWalletAdjustment"));
      return api("/finance/cashbook/adjustments", { method: "POST", body: JSON.stringify({ businessDate, ...(hubId ? { hubId } : {}), wallet, amount: Math.abs(difference), direction: difference > 0 ? "INCREASE" : "DECREASE", reason: reason.trim(), idempotencyKey: idempotencyKey.current }) });
    },
    onSuccess: async () => {
      await Promise.all(["ledger", "dashboard", "operations-batches"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      onSaved();
      onClose();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("loadError")),
  });
  const walletLabel = wallet === "CASH" ? t("cash") : wallet === "KBZ_PAY" ? t("kbzPay") : t("wavePay");
  return <ModalPortal><div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/55 p-4"><form role="dialog" aria-modal="true" aria-labelledby="wallet-adjustment-title" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }} className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"><div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><div><h2 id="wallet-adjustment-title" className="text-xl font-bold">{t("walletAdjustment")}</h2><p className="mt-1 text-sm text-slate-500">{t("walletAdjustmentDescription")}</p></div><button type="button" aria-label={t("close")} disabled={save.isPending} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-white/10"><X size={18}/></button></div><div className="mt-5 grid gap-4"><label className="text-sm font-bold">{t("walletToAdjust")}<input readOnly value={walletLabel} className={`${control} mt-1 w-full opacity-70`} /></label>{requiresHub && <label className="text-sm font-bold">{t("hub")}<select required value={hubId} onChange={(event) => setHubId(event.target.value)} className={`${control} mt-1 w-full`}><option value="">{t("selectHub")}</option>{hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>}<label className="text-sm font-bold">{t("businessDate")}<input required type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} className={`${control} mt-1 w-full`} /></label><p className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">{t("currentWalletBalance")}: <b>{currentBalance.toLocaleString()} MMK</b></p><label className="text-sm font-bold">{t("actualWalletBalance")}<input aria-label={t("actualWalletBalance")} required type="number" min="0" step="1" value={actual} onChange={(event) => setActual(event.target.value)} className={`${control} mt-1 w-full`} /></label>{difference !== null && <p className={`rounded-xl p-3 text-sm ${difference > 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : difference < 0 ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" : "bg-slate-50 dark:bg-white/5"}`}>{t("walletAdjustmentDifference")}: <b>{difference > 0 ? "+" : ""}{difference.toLocaleString()} MMK</b></p>}<label className="text-sm font-bold">{t("walletAdjustmentReason")}<textarea aria-label={t("walletAdjustmentReason")} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={`${control} mt-1 min-h-24 w-full`} /></label>{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}</div><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={save.isPending} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-40">{t("cancel")}</button><button disabled={save.isPending || difference === null || difference === 0 || reason.trim().length < 3 || (requiresHub && !hubId)} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{save.isPending ? t("loading") : t("saveWalletAdjustment")}</button></div></form></div></ModalPortal>;
}

export function FinancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<FinanceTab>(() => resolveFinanceTab(searchParams, location.hash, location.pathname));
  const [filters, setFilters] = useState<LedgerFilters>({ from: "", to: "", account: "" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showFilters, setShowFilters] = useState(false);
  const [message, setMessage] = useState("");
  const [adjustingWallet, setAdjustingWallet] = useState<Wallet | null>(null);
  const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const ledger = useQuery({
    queryKey: ["ledger", queryString],
    queryFn: () => api<LedgerSummary>(`/finance/ledger/summary${queryString ? `?${queryString}` : ""}`).then((r) => ledgerAccounts(r.data)),
  });
  const walletSummary = useQuery({
    queryKey: ["ledger", "wallet-summary"],
    queryFn: () => api<LedgerSummary>("/finance/ledger/summary").then((r) => ledgerAccounts(r.data)),
    enabled: Boolean(queryString),
  });
  const currentBalances = queryString ? walletSummary : ledger;
  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<Batch[]>("/operations/batches").then((r) => r.data),
    enabled: tab === "overview",
  });
  const hubs = useQuery({ queryKey: ["master-data", "hubs"], queryFn: () => api<{ hubs: Hub[] }>("/master-data").then((response) => response.data.hubs), enabled: user?.role === "SUPERADMIN" });

  useEffect(() => {
    setTab(resolveFinanceTab(searchParams, location.hash, location.pathname));
  }, [searchParams, location.hash, location.pathname]);

  const selectTab = (next: FinanceTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", "settlements");
    const pathname = location.pathname.startsWith("/finance/") ? `/finance/${next === "overview" ? "overview" : "settlements"}` : location.pathname;
    navigate({ pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  };

  const walletBalance = (name: string) => currentBalances.data?.find((line) => line.account === name)?.balance ?? 0;
  const formatBalance = (name: string) => {
    if (!currentBalances.data) return currentBalances.isError ? t("loadError") : "…";
    const balance = walletBalance(name);
    return balance === 0 ? t("noBalance") : `${balance.toLocaleString()} MMK`;
  };
  const walletMeaning = (name: string) => {
    if (!currentBalances.data) return t("loading");
    const balance = walletBalance(name);
    return balance < 0 ? t("walletFundsOut") : balance > 0 ? t("walletFundsAvailable") : t("walletBalanced");
  };

  const tabClass = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-bold ${active ? "bg-[#eaf6ff] text-[#0787df] dark:bg-[#133044]" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5"}`;
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTab(tab === "overview" ? "settlements" : "overview");
    requestAnimationFrame(() => document.getElementById(tab === "overview" ? "finance-settlements-tab" : "finance-overview-tab")?.focus());
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("finance")}</h1>
          <p className="mt-2 text-slate-500">{t("financeDescription")}</p>
        </div>
        <div role="tablist" aria-label={t("financeTabs")} onKeyDown={moveTab} className="flex flex-wrap gap-2">
          <button id="finance-overview-tab" type="button" role="tab" aria-controls="finance-overview-panel" tabIndex={tab === "overview" ? 0 : -1} aria-selected={tab === "overview"} className={tabClass(tab === "overview")} onClick={() => selectTab("overview")}>
            {t("financeOverview")}
          </button>
          <button id="finance-settlements-tab" type="button" role="tab" aria-controls="finance-settlements-panel" tabIndex={tab === "settlements" ? 0 : -1} aria-selected={tab === "settlements"} className={tabClass(tab === "settlements")} onClick={() => selectTab("settlements")}>
            {t("financeOsAndRiders")}
          </button>
        </div>
      </div>
      {message && <p role="status" className="mt-5 rounded-xl bg-[#eaf6ff] p-3 text-sm font-semibold text-[#0787df]">{message}</p>}

      {tab === "overview" ? (
        <div id="finance-overview-panel" role="tabpanel" aria-labelledby="finance-overview-tab">
          <OsCashbookOverview ledger={currentBalances.data ?? []} hubs={hubs.data ?? []} />
          <section className="mt-6" aria-labelledby="wallet-health-heading">
          <div className="mb-3"><h2 id="wallet-health-heading" className="font-display text-lg font-bold">{t("walletHealth")}</h2><p className="text-sm text-slate-500">{t("walletHealthDescription")}</p></div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#101318] p-5 text-white">
              <WalletCards className="text-[#4db7ff]" size={20} />
              <p className="mt-6 text-sm text-slate-400">{t("cashWallet")}</p>
              <p className="mt-1 font-display text-2xl font-bold">{formatBalance("WALLET_CASH")}</p>
              <p className="mt-2 text-xs text-slate-400">{walletMeaning("WALLET_CASH")}</p>
              {user?.role === "SUPERADMIN" && <button type="button" onClick={() => setAdjustingWallet("CASH")} className="mt-3 text-xs font-bold text-[#4db7ff]">{t("walletAdjustment")}</button>}
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">{t("kbzPay")}</p>
              <p className="mt-7 font-display text-2xl font-bold">{formatBalance("WALLET_KBZ_PAY")}</p>
              <p className="mt-2 text-xs text-slate-500">{walletMeaning("WALLET_KBZ_PAY")}</p>
              {user?.role === "SUPERADMIN" && <button type="button" onClick={() => setAdjustingWallet("KBZ_PAY")} className="mt-3 text-xs font-bold text-[#0787df]">{t("walletAdjustment")}</button>}
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">{t("wavePay")}</p>
              <p className="mt-7 font-display text-2xl font-bold">{formatBalance("WALLET_WAVE_PAY")}</p>
              <p className="mt-2 text-xs text-slate-500">{walletMeaning("WALLET_WAVE_PAY")}</p>
              {user?.role === "SUPERADMIN" && <button type="button" onClick={() => setAdjustingWallet("WAVE_PAY")} className="mt-3 text-xs font-bold text-[#0787df]">{t("walletAdjustment")}</button>}
            </div>
          </div>
          </section>

          <details className="mt-6 rounded-2xl border border-amber-200 bg-white shadow-sm dark:border-amber-900/60 dark:bg-[#181a1d]">
            <summary className="cursor-pointer list-none p-5 font-display font-bold">{t("reconciliationIssues")}</summary>
            <div className="border-t border-slate-100 dark:border-white/10">
              <PostPickupAdvancesPanel
                batches={batches.data ?? []}
                loading={batches.isLoading}
                error={batches.isError}
                onRetry={() => void batches.refetch()}
                onMessage={setMessage}
              />
            </div>
          </details>

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
                  <p className="text-sm text-rose-500">{ledger.error instanceof Error && ledger.error.message ? ledger.error.message : t("loadError")}</p>
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
          <CashbookExpenses hubs={hubs.data ?? []} />
          {adjustingWallet && <WalletAdjustmentDialog wallet={adjustingWallet} currentBalance={walletBalance(adjustingWallet === "CASH" ? "WALLET_CASH" : adjustingWallet === "KBZ_PAY" ? "WALLET_KBZ_PAY" : "WALLET_WAVE_PAY")} hubs={hubs.data ?? []} onClose={() => setAdjustingWallet(null)} onSaved={() => setMessage(t("walletAdjustmentSaved"))} />}
        </div>
      ) : (
        <div id="finance-settlements-panel" role="tabpanel" aria-labelledby="finance-settlements-tab"><SettlementWorkspaces /></div>
      )}
    </div>
  );
}
