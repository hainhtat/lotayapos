import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, PackageCheck, RotateCcw, TrendingUp, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DeliveryStatusPanel, type ManifestPreviewData } from "@/components/delivery-status-panel";
import { ManifestStatusSelect } from "@/components/manifest-status-select";
import { DetailedReportsPanel } from "@/components/detailed-reports-panel";
import { ProfitCompositionChart } from "@/components/profit-composition-chart";
import { api, apiRaw } from "@/lib/api";
import { hubBusinessDate } from "@/lib/business-date";
import { resolveManifestPdfFilename } from "@/lib/content-disposition";
import { ledgerAccounts, type LedgerReport } from "@/lib/ledger";
import {
  buildManifestBody,
  MANIFEST_DATE_PRESETS,
  ALL_MANIFEST_STATUSES,
  type ManifestDatePreset,
  type ManifestStatus,
} from "@/lib/manifest-filters";

type Overview = { totalParcels: number; delivered: number; pendingReturn: number; cashCollected: number; grossProfit: number };
type DailyRiderReceivable = { receipts?: Array<{lines?:Array<{wallet:string;amount:number}>}>; settlements?:Array<{lines?:Array<{wallet:string;amount:number}>}>; settlement?:{lines?:Array<{wallet:string;amount:number}>}|null };
type MasterData = {
  hubs?: Array<{ id: string; name: string }>;
  riders: Array<{ id: string; user: { name: string }; hub?: { name: string } | null }>;
};
type ProfitEffect = {
  deliveryFeeRevenue: number;
  riderCommissionCost: number;
  riderSalaryCost: number;
  returnAdvanceRecovery: number;
  expenseCost: number;
  adjustmentContribution: number;
};
type ProfitReport = {
  period: { from: string; to: string; timezone: string };
  currency: string;
  components: {
    deliveryFeeRevenue: number;
    riderCommissionCost: number;
    riderSalaryCost: number;
    riderCompensationCost: number;
    returns: { advanceRecovery: number; includedInProfit: boolean; explanation: string };
    adjustments: { contribution: number };
    expenses: { cost: number };
  };
  grossProfit: number;
  netProfit: number;
  journalEntries: Array<{
    id: string;
    businessDate: string;
    description: string;
    effectiveSourceType: string;
    effects: ProfitEffect;
    lines: Array<{ id: string; account: string; debit: number; credit: number }>;
  }>;
};
type ReportView = "overview" | "profit" | "operations" | "delivery" | "ledger";

const today = () => hubBusinessDate();
const money = (value: number) => `${value.toLocaleString()} MMK`;

const control = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";
const chip = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs font-bold ${active ? "border-[#1598ef] bg-[#eaf6ff] text-[#0787df] dark:bg-[#1598ef]/15" : "border-slate-200 dark:border-white/10"}`;

export function ReportsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportParam = searchParams.get("report");
  const initialReport: ReportView = ["overview", "profit", "operations", "delivery", "ledger"].includes(reportParam ?? "") ? reportParam as ReportView : "overview";
  const [reportView, setReportView] = useState<ReportView>(initialReport);
  const [draft, setDraft] = useState({ from: "", to: "", account: "" });
  const [filters, setFilters] = useState(draft);
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<ManifestStatus[]>([...ALL_MANIFEST_STATUSES]);
  const [datePreset, setDatePreset] = useState<ManifestDatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [profitDraft, setProfitDraft] = useState({ from: today(), to: today(), hubId: "" });
  const [profitFilters, setProfitFilters] = useState(profitDraft);
  useEffect(() => {
    const next = searchParams.get("report");
    if (next && ["overview", "profit", "operations", "delivery", "ledger"].includes(next)) setReportView(next as ReportView);
  }, [searchParams]);
  const selectReport = (next: ReportView) => {
    setReportView(next);
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("report");
    else params.set("report", next);
    setSearchParams(params, { replace: true });
  };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const overview = useQuery({ queryKey: ["report-overview"], queryFn: () => api<Overview>("/master-data/dashboard").then((r) => r.data) });
  const canViewRiderReceipts=["SUPERADMIN","FINANCE","OPERATIONS_MANAGER"].includes(user?.role??"");
  const riderReceipts=useQuery({queryKey:["report-rider-receipts",today()],queryFn:()=>api<DailyRiderReceivable[]>(`/finance/rider-outstanding?businessDate=${today()}`).then(r=>r.data),enabled:canViewRiderReceipts});
  const ledger = useQuery({
    queryKey: ["report-ledger", qs],
    queryFn: () => api<LedgerReport>(`/finance/ledger${qs ? `?${qs}` : ""}`).then((r) => ledgerAccounts(r.data)),
  });
  const masters = useQuery({
    queryKey: ["master-data"],
    queryFn: () => api<MasterData>("/master-data").then((r) => r.data),
  });
  const canViewProfit = ["SUPERADMIN", "FINANCE", "OPERATIONS_MANAGER", "AUDITOR"].includes(user?.role ?? "");
  const profitParams = new URLSearchParams({ from: profitFilters.from, to: profitFilters.to });
  if (profitFilters.hubId) profitParams.set("hubId", profitFilters.hubId);
  const profit = useQuery({
    queryKey: ["profit-report", profitParams.toString()],
    queryFn: () => api<ProfitReport>(`/reports/profit?${profitParams}`).then((response) => response.data),
    enabled: canViewProfit && Boolean(profitFilters.from && profitFilters.to) && (user?.role !== "SUPERADMIN" || Boolean(profitFilters.hubId)),
  });
  const manifestBody = useMemo(
    () => buildManifestBody({ riderIds, statuses, datePreset, dateFrom, dateTo }),
    [riderIds, statuses, datePreset, dateFrom, dateTo],
  );
  const delivery = useQuery({
    queryKey: ["delivery-status", manifestBody],
    queryFn: () =>
      api<ManifestPreviewData>("/operations/parcels/manifest/preview", {
        method: "POST",
        body: JSON.stringify(manifestBody),
      }).then((r) => r.data),
  });
  const downloadPdf = useMutation({
    mutationFn: () =>
      apiRaw("/operations/parcels/manifest", {
        method: "POST",
        body: JSON.stringify(manifestBody),
      }),
    onSuccess: async (response) => {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition"));
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  const stats = [
    { key: "totalParcels", value: overview.data?.totalParcels ?? 0, icon: PackageCheck },
    { key: "pendingReturn", value: overview.data?.pendingReturn ?? 0, icon: RotateCcw },
    { key: "cashCollected", value: `${(overview.data?.cashCollected ?? 0).toLocaleString()} MMK`, icon: Wallet },
  ];
  const dailyWallets=(Array.isArray(riderReceipts.data)?riderReceipts.data:[]).reduce((totals,row)=>{const receipts=row.receipts??row.settlements??(row.settlement?[row.settlement]:[]);for(const receipt of receipts)for(const line of receipt.lines??[]){if(line.wallet==="CASH")totals.cash+=line.amount;else if(line.wallet==="KBZ_PAY")totals.kbzPay+=line.amount;else if(line.wallet==="WAVE_PAY")totals.wavePay+=line.amount;}return totals;},{cash:0,kbzPay:0,wavePay:0});
  const riders = masters.data?.riders ?? [];
  const dateLabel = (key: ManifestDatePreset) => (key === "all" ? t("allDates") : key === "custom" ? t("customRange") : t(key));

  return (
    <div className="mx-auto max-w-[1400px]">
      <h1 className="font-display text-3xl font-bold">{t("reports")}</h1>
      <p className="mt-2 text-slate-500">{t("reportsDescription")}</p>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
        <label className="text-sm font-bold" htmlFor="report-view">{t("reportType")}</label>
        <select id="report-view" value={reportView} onChange={(event) => selectReport(event.target.value as ReportView)} className={`${control} mt-2 w-full sm:max-w-sm`}>
          <option value="overview">{t("reportOverview")}</option>
          {canViewProfit && <option value="profit">{t("profitBreakdown")}</option>}
          {canViewProfit && <option value="operations">{t("operationalReports")}</option>}
          <option value="delivery">{t("dailyDeliveryStatus")}</option>
          <option value="ledger">{t("financialReport")}</option>
        </select>
        <p className="mt-2 text-xs text-slate-500">{t("reportPickerDescription")}</p>
      </section>
      {reportView === "overview" && <>
      {overview.isLoading ? (
        <p className="mt-8">{t("loading")}</p>
      ) : overview.isError ? (
        <button onClick={() => void overview.refetch()} className={`${control} mt-8`}>
          {t("retry")}
        </button>
      ) : (
        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          {stats.map(({ key, value, icon: Icon }) => (
            <div key={key} className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#181a1d]">
              <Icon className="text-[#1598ef]" />
              <p className="mt-5 text-sm text-slate-500">{t(key)}</p>
              <p className="mt-1 text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {canViewRiderReceipts&&<section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]"><h2 className="font-display text-base font-bold">{t("riderReceiptsToday")}</h2><dl className="mt-3 grid gap-3 sm:grid-cols-3">{(["cash","kbzPay","wavePay"] as const).map(wallet=><div key={wallet} className="rounded-xl bg-slate-50 p-3 dark:bg-white/5"><dt className="text-xs font-semibold text-slate-500">{t(wallet)}</dt><dd className="mt-1 font-bold">{(dailyWallets[wallet]??0).toLocaleString()} MMK</dd></div>)}</dl></section>}
      </>}

      {reportView === "profit" && canViewProfit && (
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
          <div className="flex items-center gap-3">
            <TrendingUp className="text-[#1598ef]" />
            <div>
              <h2 className="font-display text-lg font-bold">{t("profitBreakdown")}</h2>
              <p className="text-sm text-slate-500">{t("profitBreakdownDescription")}</p>
            </div>
          </div>
          <form
            className="mt-5 grid gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setProfitFilters(profitDraft);
            }}
          >
            <label className="text-xs font-bold text-slate-500">
              {t("dateFrom")}
              <input aria-label={`${t("profitBreakdown")} ${t("dateFrom")}`} required type="date" value={profitDraft.from} onChange={(event) => setProfitDraft((value) => ({ ...value, from: event.target.value }))} className={`${control} mt-1 w-full`} />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t("dateTo")}
              <input aria-label={`${t("profitBreakdown")} ${t("dateTo")}`} required type="date" value={profitDraft.to} onChange={(event) => setProfitDraft((value) => ({ ...value, to: event.target.value }))} className={`${control} mt-1 w-full`} />
            </label>
            {user?.role === "SUPERADMIN" && (
              <label className="text-xs font-bold text-slate-500">
                {t("hub")}
                <select aria-label={`${t("profitBreakdown")} ${t("hub")}`} required value={profitDraft.hubId} onChange={(event) => setProfitDraft((value) => ({ ...value, hubId: event.target.value }))} className={`${control} mt-1 w-full`}>
                  <option value="">{t("selectHub")}</option>
                  {(masters.data?.hubs ?? []).map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}
                </select>
              </label>
            )}
            <button className="self-end rounded-xl bg-[#1598ef] px-4 py-2.5 text-sm font-bold text-white">{t("runProfitReport")}</button>
          </form>
          {user?.role === "SUPERADMIN" && !profitFilters.hubId ? (
            <p className="mt-6 rounded-xl bg-sky-50 p-4 text-sm text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">{t("selectHubForProfit")}</p>
          ) : profit.isLoading ? (
            <p className="mt-6 py-8 text-center">{t("loading")}</p>
          ) : profit.isError ? (
            <div role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
              <p>{t("profitLoadError")}</p>
              <button type="button" onClick={() => void profit.refetch()} className="mt-2 font-bold underline">{t("retry")}</button>
            </div>
          ) : profit.data ? (
            <div className="mt-6">
              <p className="text-xs text-slate-500">{t("profitPeriod", { from: profit.data.period.from, to: profit.data.period.to, timezone: profit.data.period.timezone })}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["deliveryFeeRevenue", profit.data.components.deliveryFeeRevenue],
                  ["riderCompensationCost", -profit.data.components.riderCompensationCost],
                  ["grossProfit", profit.data.grossProfit],
                  ["netProfit", profit.data.netProfit],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                    <p className="text-xs text-slate-500">{t(String(label))}</p>
                    <p className="mt-1 text-xl font-bold">{money(Number(value))}</p>
                  </div>
                ))}
              </div>
              <ProfitCompositionChart
                deliveryFeeRevenue={profit.data.components.deliveryFeeRevenue}
                riderCompensationCost={profit.data.components.riderCompensationCost}
                expenseCost={profit.data.components.expenses.cost}
                adjustmentContribution={profit.data.components.adjustments.contribution}
              />
              <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2 dark:bg-white/5">
                <div className="flex justify-between gap-3"><dt>{t("riderCommissionCost")}</dt><dd>{money(profit.data.components.riderCommissionCost)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t("riderSalaryCost")}</dt><dd>{money(profit.data.components.riderSalaryCost)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t("expenseCost")}</dt><dd>{money(profit.data.components.expenses.cost)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t("adjustmentContribution")}</dt><dd>{money(profit.data.components.adjustments.contribution)}</dd></div>
                <div className="flex justify-between gap-3 sm:col-span-2"><dt>{t("returnAdvanceRecovery")}</dt><dd>{money(profit.data.components.returns.advanceRecovery)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-slate-500">{t("returnsExcludedFromProfit")}</p>
              <h3 className="mt-6 font-display font-bold">{t("profitJournalDrilldown")}</h3>
              {!profit.data.journalEntries.length ? (
                <p className="py-8 text-center text-slate-400">{t("profitEmpty")}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {profit.data.journalEntries.map((entry) => (
                    <details key={entry.id} className="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                      <summary className="cursor-pointer font-semibold"><span>{entry.businessDate} · {entry.description}</span><span className="ml-2 text-xs text-slate-400">{entry.effectiveSourceType}</span></summary>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-xs"><thead><tr className="border-b text-slate-400"><th className="pb-2">{t("account")}</th><th className="pb-2 text-right">{t("debit")}</th><th className="pb-2 text-right">{t("credit")}</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={line.id} className="border-b border-slate-100 dark:border-white/10"><td className="py-2">{line.account}</td><td className="py-2 text-right">{line.debit.toLocaleString()}</td><td className="py-2 text-right">{line.credit.toLocaleString()}</td></tr>)}</tbody></table>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {reportView === "operations" && canViewProfit && <DetailedReportsPanel />}

      {reportView === "delivery" && <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">{t("dailyDeliveryStatus")}</h2>
            <p className="text-sm text-slate-500">{t("dailyDeliveryStatusDescription")}</p>
          </div>
          <button
            type="button"
            disabled={downloadPdf.isPending || !delivery.data?.parcelCount}
            onClick={() => downloadPdf.mutate()}
            className="rounded-xl border border-[#1598ef] px-4 py-2 text-sm font-bold text-[#0787df] disabled:opacity-50"
          >
            <Download size={16} className="mr-2 inline" />
            {downloadPdf.isPending ? t("loading") : t("downloadPdf")}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {MANIFEST_DATE_PRESETS.map((preset) => (
            <button key={preset} type="button" onClick={() => setDatePreset(preset)} className={chip(datePreset === preset)}>
              {dateLabel(preset)}
            </button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-500">
              {t("dateFrom")}
              <input aria-label={`${t("dailyDeliveryStatus")} ${t("dateFrom")}`} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${control} mt-1 w-full`} />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t("dateTo")}
              <input aria-label={`${t("dailyDeliveryStatus")} ${t("dateTo")}`} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${control} mt-1 w-full`} />
            </label>
          </div>
        )}
        <div className="mt-4 grid gap-3">
          <ManifestStatusSelect id="report-statuses" value={statuses} onChange={setStatuses} />
          <label className="text-xs font-bold text-slate-500">
            {t("rider")}
            <select
              aria-label={t("rider")}
              value={riderIds[0] ?? ""}
              onChange={(e) => setRiderIds(e.target.value ? [e.target.value] : [])}
              className={`${control} mt-1 w-full`}
            >
              <option value="">{t("allRiders")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5">
          <DeliveryStatusPanel preview={delivery.data} loading={delivery.isLoading} error={delivery.isError} onRetry={() => void delivery.refetch()} />
        </div>
      </section>}

      {reportView === "ledger" && <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
        <div className="flex items-center gap-3">
          <FileBarChart className="text-[#1598ef]" />
          <div>
            <h2 className="font-display text-lg font-bold">{t("financialReport")}</h2>
            <p className="text-sm text-slate-500">{t("financialReportDescription")}</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draft);
          }}
          className="mt-5 grid gap-3 sm:grid-cols-4"
        >
          <label className="text-xs font-bold text-slate-500">
            {t("dateFrom")}
            <input aria-label={t("dateFrom")} type="date" value={draft.from} onChange={(e) => setDraft((v) => ({ ...v, from: e.target.value }))} className={`${control} mt-1 w-full`} />
          </label>
          <label className="text-xs font-bold text-slate-500">
            {t("dateTo")}
            <input aria-label={t("dateTo")} type="date" value={draft.to} onChange={(e) => setDraft((v) => ({ ...v, to: e.target.value }))} className={`${control} mt-1 w-full`} />
          </label>
          <label className="text-xs font-bold text-slate-500">
            {t("account")}
            <input aria-label={t("account")} value={draft.account} onChange={(e) => setDraft((v) => ({ ...v, account: e.target.value }))} className={`${control} mt-1 w-full`} />
          </label>
          <button className="self-end rounded-xl bg-[#1598ef] px-4 py-2.5 text-sm font-bold text-white">{t("runReport")}</button>
        </form>
        <div className="mt-6 overflow-x-auto">
          {ledger.isLoading ? (
            <p className="py-8 text-center">{t("loading")}</p>
          ) : ledger.isError ? (
            <button onClick={() => void ledger.refetch()}>{t("retry")}</button>
          ) : !ledger.data?.length ? (
            <p className="py-8 text-center text-slate-400">{t("empty")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-slate-400">
                  <th className="pb-3">{t("account")}</th>
                  <th className="pb-3 text-right">{t("debit")}</th>
                  <th className="pb-3 text-right">{t("credit")}</th>
                  <th className="pb-3 text-right">{t("balance")}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((line) => (
                  <tr key={line.account} className="border-b border-slate-100 dark:border-white/10">
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
      </section>}
    </div>
  );
}
