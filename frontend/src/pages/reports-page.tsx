import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, PackageCheck, RotateCcw, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeliveryStatusPanel, type ManifestPreviewData } from "@/components/delivery-status-panel";
import { api, apiRaw } from "@/lib/api";
import { resolveManifestPdfFilename } from "@/lib/content-disposition";
import { ledgerAccounts, type LedgerReport } from "@/lib/ledger";
import {
  buildManifestBody,
  MANIFEST_DATE_PRESETS,
  MANIFEST_STATUS_FILTERS,
  manifestStatusLabelKey,
  type ManifestDatePreset,
  type ManifestStatusKey,
} from "@/lib/manifest-filters";

type Overview = { totalParcels: number; delivered: number; pendingReturn: number; cashCollected: number; grossProfit: number };
type MasterData = { riders: Array<{ id: string; user: { name: string }; hub?: { name: string } | null }> };

const control = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#121416]";
const chip = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs font-bold ${active ? "border-[#1598ef] bg-[#eaf6ff] text-[#0787df] dark:bg-[#1598ef]/15" : "border-slate-200 dark:border-white/10"}`;

export function ReportsPage() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ from: "", to: "", account: "" });
  const [filters, setFilters] = useState(draft);
  const [riderIds, setRiderIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ManifestStatusKey>("all");
  const [datePreset, setDatePreset] = useState<ManifestDatePreset>("today");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const overview = useQuery({ queryKey: ["report-overview"], queryFn: () => api<Overview>("/master-data/dashboard").then((r) => r.data) });
  const ledger = useQuery({
    queryKey: ["report-ledger", qs],
    queryFn: () => api<LedgerReport>(`/finance/ledger${qs ? `?${qs}` : ""}`).then((r) => ledgerAccounts(r.data)),
  });
  const masters = useQuery({
    queryKey: ["master-data"],
    queryFn: () => api<MasterData>("/master-data").then((r) => r.data),
  });
  const manifestBody = useMemo(
    () => buildManifestBody({ riderIds, status, datePreset, dateFrom, dateTo }),
    [riderIds, status, datePreset, dateFrom, dateTo],
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
  const riders = masters.data?.riders ?? [];
  const statusLabel = (key: ManifestStatusKey) => t(manifestStatusLabelKey(key));
  const dateLabel = (key: ManifestDatePreset) => (key === "all" ? t("allDates") : key === "custom" ? t("customRange") : t(key));

  return (
    <div className="mx-auto max-w-[1400px]">
      <h1 className="font-display text-3xl font-bold">{t("reports")}</h1>
      <p className="mt-2 text-slate-500">{t("reportsDescription")}</p>
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

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">
            {t("status")}
            <select aria-label={t("status")} value={status} onChange={(e) => setStatus(e.target.value as ManifestStatusKey)} className={`${control} mt-1 w-full`}>
              {MANIFEST_STATUS_FILTERS.map((key) => (
                <option key={key} value={key}>
                  {statusLabel(key)}
                </option>
              ))}
            </select>
          </label>
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
      </section>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm dark:bg-[#181a1d]">
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
      </section>
    </div>
  );
}
