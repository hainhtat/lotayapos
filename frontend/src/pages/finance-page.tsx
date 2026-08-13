import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, CheckCircle2, WalletCards, X } from "lucide-react";
import { ledgerAccounts, type LedgerReport } from "@/lib/ledger";
import { CashbookExpenses } from "./cashbook-expenses";
import { SettlementWorkspaces } from "./settlement-workspaces";

type Batch = {
  id: string;
  label: string;
  pickupDate: string;
  advancePaid: number;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};
type PostingResult = { batchId: string; postedCount: number; alreadyPosted: boolean };
type LedgerFilters = { from: string; to: string; account: string };
type FinanceTab = "overview" | "settlements";

const control =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

function resolveFinanceTab(searchParams: URLSearchParams, hash: string): FinanceTab {
  if (searchParams.get("tab") === "settlements") return "settlements";
  if (hash === "#os-settlements" || hash === "#os-pending-returns" || hash === "#rider-outstanding") return "settlements";
  return "overview";
}

export function FinancePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<FinanceTab>(() => resolveFinanceTab(searchParams, location.hash));
  const [filters, setFilters] = useState<LedgerFilters>({ from: "", to: "", account: "" });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showFilters, setShowFilters] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [wallet, setWallet] = useState<"CASH" | "KBZ_PAY" | "WAVE_PAY">("CASH");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const ledger = useQuery({
    queryKey: ["ledger", queryString],
    queryFn: () => api<LedgerReport>(`/finance/ledger${queryString ? `?${queryString}` : ""}`).then((r) => ledgerAccounts(r.data)),
  });
  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<Batch[]>("/operations/batches").then((r) => r.data),
  });
  const selectedBatch = batches.data?.find((batch) => batch.id === batchId);
  const postAdvances = useMutation({
    mutationFn: () =>
      api<PostingResult>(`/operations/batches/${batchId}/pickup-advances`, {
        method: "POST",
        body: JSON.stringify({ fundingWallet: wallet }),
      }),
    onSuccess: async ({ data }) => {
      setConfirming(false);
      setBatchId("");
      setMessage(data.alreadyPosted ? t("pickupAdvancesAlreadyPosted") : t("pickupAdvancesPosted", { count: data.postedCount }));
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
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
          <section className="mt-7 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">{t("postPickupAdvances")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("postPickupAdvancesDescription")}</p>
              </div>
              <CheckCircle2 className="text-[#12a66a]" />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
              <label className="text-xs font-bold text-slate-500">
                {t("batch")}
                <select aria-label={t("batch")} value={batchId} onChange={(event) => setBatchId(event.target.value)} className={`${control} mt-1 w-full`}>
                  <option value="">{batches.isLoading ? t("loading") : t("selectBatch")}</option>
                  {batches.data?.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.label} · {batch.shop.name} · {batch.parcels.length} {t("records")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("fundingWallet")}
                <select aria-label={t("fundingWallet")} value={wallet} onChange={(event) => setWallet(event.target.value as typeof wallet)} className={`${control} mt-1 w-full`}>
                  <option value="CASH">Cash</option>
                  <option value="KBZ_PAY">KBZ Pay</option>
                  <option value="WAVE_PAY">Wave Pay</option>
                </select>
              </label>
              <button disabled={!batchId || postAdvances.isPending} onClick={() => setConfirming(true)} className="self-end rounded-xl bg-[#1598ef] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {t("reviewPosting")}
              </button>
            </div>
            {batches.isError && (
              <button onClick={() => void batches.refetch()} className="mt-3 text-sm font-bold text-[#0787df]">
                {t("retry")}
              </button>
            )}
          </section>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#101318] p-5 text-white">
              <WalletCards className="text-[#4db7ff]" size={20} />
              <p className="mt-6 text-sm text-slate-400">{t("cashWallet")}</p>
              <p className="mt-1 font-display text-2xl font-bold">{formatBalance("WALLET_CASH")}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">KBZ Pay</p>
              <p className="mt-7 font-display text-2xl font-bold">{formatBalance("WALLET_KBZ_PAY")}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <p className="text-sm text-slate-500">Wave Pay</p>
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

      {confirming && selectedBatch && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/45 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="posting-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="posting-title" className="font-display text-xl font-bold">
                  {t("confirmPickupAdvances")}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {t("confirmPickupAdvancesDescription")} · {t("totalAdvancePaid")}: {(selectedBatch.advancePaid ?? 0).toLocaleString()} MMK
                </p>
              </div>
              <button aria-label={t("cancel")} onClick={() => setConfirming(false)}>
                <X />
              </button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5">
              <dt className="text-slate-500">{t("batch")}</dt>
              <dd className="text-right font-bold">{selectedBatch.label}</dd>
              <dt className="text-slate-500">{t("pickupDate")}</dt>
              <dd className="text-right font-bold">{new Date(selectedBatch.pickupDate).toLocaleDateString()}</dd>
              <dt className="text-slate-500">{t("parcels")}</dt>
              <dd className="text-right font-bold">{selectedBatch.parcels.length}</dd>
              <dt className="text-slate-500">{t("fundingWallet")}</dt>
              <dd className="text-right font-bold">{wallet.replace("_", " ")}</dd>
            </dl>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setConfirming(false)} className={control}>
                {t("cancel")}
              </button>
              <button disabled={postAdvances.isPending} onClick={() => postAdvances.mutate()} className="rounded-xl bg-[#1598ef] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {postAdvances.isPending ? t("loading") : t("confirmAndPost")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
