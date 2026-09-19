import { useTranslation } from "react-i18next";

type BatchWorkspaceSummaryProps = {
  shopName?: string;
  label?: string;
  finalized: boolean;
  canFinalize: boolean;
  parcelCount: number;
  totalCod: number;
  advancePaid: number;
  remainingToOs: number;
  balanceError?: string | null;
  accountBreakdown: string;
  onFinalize: () => void;
};

export function BatchWorkspaceSummary({ shopName, label, finalized, canFinalize, parcelCount, totalCod, advancePaid, remainingToOs, balanceError, accountBreakdown, onFinalize }: BatchWorkspaceSummaryProps) {
  const { t } = useTranslation();
  const metrics = [
    { label: t("savedParcels"), value: parcelCount.toLocaleString() },
    { label: t("totalCodFromOs"), value: `${totalCod.toLocaleString()} MMK` },
    { label: t("totalAdvancePaid"), value: `${advancePaid.toLocaleString()} MMK` },
  ];
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-bold text-[#0787df]">{shopName}</p><h1 className="font-display text-3xl font-bold">{label ?? t("batchDetail")}</h1><p className="mt-2 max-w-2xl text-sm text-slate-500">{t("batchEntryDescription")}</p></div>
      <div className="text-right">{finalized?<span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{t("finalized")}</span>:canFinalize&&<button type="button" disabled={!parcelCount} onClick={onFinalize} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t("finalizeBatch")}</button>}</div>
    </div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(metric=><div key={metric.label} className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{metric.label}</p><p className="mt-2 font-display text-2xl font-bold">{metric.value}</p></div>)}
      <div className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-[#181a1d] ${remainingToOs<0?"border-amber-200 dark:border-amber-900/60":"border-black/5 dark:border-white/10"}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("remainingToOs")}</p>
        <p className={`mt-2 font-display text-2xl font-bold ${remainingToOs<0?"text-amber-700 dark:text-amber-300":""}`}>{balanceError?"—":`${remainingToOs.toLocaleString()} MMK`}</p>
        <p className="mt-2 text-xs text-slate-500">{t("remainingToOsHint")}</p>
        {balanceError?<p role="alert" className="mt-2 text-sm text-amber-700">{balanceError}</p>:<p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{accountBreakdown}</p>}
      </div>
    </div>
  </>;
}
