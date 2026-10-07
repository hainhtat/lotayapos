import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManifestPreview } from "./batch-detail-types";
import { manifestReviewSummary } from "./parcel-draft-rules";

export function ManifestReviewTable({ preview, onCancel, onApply }: { preview: ManifestPreview; onCancel: () => void; onApply: () => void }) {
 const { t } = useTranslation();
 const review = manifestReviewSummary(preview.rows);
 return (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-400/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-display font-bold">{t("manifestPreview")}</h2><p className="text-sm text-slate-600 dark:text-slate-300">{t("manifestPreviewSummary", { rows: preview.rows.length, pages: preview.pageCount })}</p><p className="mt-1 font-bold">{t("manifestCodReview", { total: review.totalCod.toLocaleString(), count: review.needsReview })}</p>{preview.truncated && <p role="alert">{t("manifestTruncated")}</p>}<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("manifestNotSaved")}</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => onCancel()} className="rounded-lg border px-3 py-2 text-sm font-bold">{t("cancel")}</button><button type="button" onClick={onApply} className="rounded-lg bg-[#1598ef] px-3 py-2 text-sm font-bold text-white">{t("useEditableDraft")}</button></div>
          </div>
          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-amber-200 bg-white dark:border-white/10 dark:bg-[#181a1d]"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 dark:bg-[#222529]"><tr><th className="p-2">{t("sourcePage")}</th><th>{t("orderId")}</th><th>{t("customer")}</th><th>{t("address")}</th><th>{t("customerPhone")}</th><th className="text-right">{t("cod")}</th><th className="px-2">{t("confidence")}</th></tr></thead><tbody>{preview.rows.map((row,index)=><tr key={`${row.sourcePage}-${index}`} className="border-t dark:border-white/10"><td className="p-2">{row.sourcePage}</td><td>{row.orderId}</td><td>{row.customerName}</td><td className="max-w-xs p-2">{row.address}{row.warnings.length>0&&<span className="mt-1 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><AlertTriangle size={11}/>{row.warnings.map(code=>t(`manifestWarning.${code}`)).join(" · ")}</span>}</td><td>{row.customerPhone||"—"}</td><td className="text-right font-bold">{row.codAmount.toLocaleString()}</td><td className="px-2">{Math.round(row.confidence*100)}%</td></tr>)}</tbody></table></div>
        </section>
  );
}
