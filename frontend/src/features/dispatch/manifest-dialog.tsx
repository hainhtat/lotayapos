import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeliveryStatusPanel, type ManifestPreviewData } from "@/components/delivery-status-panel";
import { ManifestStatusSelect } from "@/components/manifest-status-select";
import { MANIFEST_DATE_PRESETS, type ManifestDatePreset, type ManifestStatus } from "@/lib/manifest-filters";
import type { MasterData } from "./dispatch-types";

const control = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-[#1598ef] dark:border-white/10 dark:bg-[#181a1d] dark:text-slate-100";

type Props = {
  onClose: () => void;
  manifestDatePreset: ManifestDatePreset;
  setManifestDatePreset: (value: ManifestDatePreset) => void;
  manifestDateFrom: string;
  setManifestDateFrom: (value: string) => void;
  manifestDateTo: string;
  setManifestDateTo: (value: string) => void;
  manifestStatuses: ManifestStatus[];
  setManifestStatuses: (value: ManifestStatus[]) => void;
  manifestRiderIds: string[];
  setManifestRiderIds: (value: string[]) => void;
  toggleManifestRider: (id: string) => void;
  riders: MasterData["riders"];
  preview: { data?: ManifestPreviewData; isLoading: boolean; isError: boolean; refetch: () => unknown };
  download: { isPending: boolean; mutate: () => void };
};

export function ManifestDialog({ onClose, manifestDatePreset, setManifestDatePreset, manifestDateFrom, setManifestDateFrom, manifestDateTo, setManifestDateTo, manifestStatuses, setManifestStatuses, manifestRiderIds, setManifestRiderIds, toggleManifestRider, riders, preview, download }: Props) {
  const { t } = useTranslation();
  return createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/55 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="manifest-title" className="relative mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#181a1d]">
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="manifest-title" className="font-display text-xl font-bold">
              {t("downloadManifest")}
            </h2><button type="button" aria-label={t("close")} onClick={() => onClose()} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">{t("downloadManifestDescription")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {MANIFEST_DATE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setManifestDatePreset(preset)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${manifestDatePreset === preset ? "border-[#1598ef] bg-[#eaf6ff] text-[#0787df] dark:bg-[#1598ef]/15" : "border-slate-200 dark:border-white/10"}`}
                >
                  {preset === "all" ? t("allDates") : preset === "custom" ? t("customRange") : t(preset)}
                </button>
              ))}
            </div>
            {manifestDatePreset === "custom" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-500">
                  {t("dateFrom")}
                  <input aria-label={`${t("downloadManifest")} ${t("dateFrom")}`} type="date" value={manifestDateFrom} onChange={(e) => setManifestDateFrom(e.target.value)} className={`${control} mt-1 w-full`} />
                </label>
                <label className="text-xs font-bold text-slate-500">
                  {t("dateTo")}
                  <input aria-label={`${t("downloadManifest")} ${t("dateTo")}`} type="date" value={manifestDateTo} onChange={(e) => setManifestDateTo(e.target.value)} className={`${control} mt-1 w-full`} />
                </label>
              </div>
            )}
            <div className="mt-4"><ManifestStatusSelect id="manifest-statuses" value={manifestStatuses} onChange={setManifestStatuses} /></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setManifestRiderIds(riders.map((rider) => rider.id))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold dark:border-white/10"
              >
                {t("selectAll")}
              </button>
              <button
                type="button"
                onClick={() => setManifestRiderIds([])}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold dark:border-white/10"
              >
                {t("allRiders")}
              </button>
            </div>
            <div className="mt-4 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3 dark:border-white/10">
              {riders.map((rider) => {
                const checked = manifestRiderIds.includes(rider.id);
                return (
                  <label
                    key={rider.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${checked ? "bg-[#eaf6ff] dark:bg-[#1598ef]/15" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleManifestRider(rider.id)} className="accent-[#1598ef]" />
                    <span className="font-semibold">{rider.user.name}</span>
                    {rider.hub?.name && <span className="text-xs text-slate-400">{rider.hub.name}</span>}
                  </label>
                );
              })}
            </div>
            <div className="mt-5">
              <DeliveryStatusPanel preview={preview.data} loading={preview.isLoading} error={preview.isError} onRetry={() => void preview.refetch()} />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => onClose()} className={control}>
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={download.isPending || !preview.data?.parcelCount}
                onClick={() => download.mutate()}
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                <Download size={16} className="mr-2 inline" />
                {download.isPending ? t("loading") : t("downloadPdf")}
              </button>
            </div>
            </div>
          </div>
        </div>,
        document.body,
      );

}
