import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocationSuggestion, LocationSuggestionCandidate, ManifestPreview } from "./batch-detail-types";
import { manifestReviewSummary } from "./parcel-draft-rules";

type Props = { preview: ManifestPreview; suggestions: LocationSuggestion[]; suggestionPending: boolean; suggestionError: boolean; onRetrySuggestions: () => void; ignoredSuggestions: number[]; onIgnoreSuggestion: (index: number) => void; onApplyCandidate: (index: number, candidate: LocationSuggestionCandidate) => void; onApplySafe: () => void; onCancel: () => void; onApply: () => void };

export function ManifestReviewTable({ preview, suggestions, suggestionPending, suggestionError, onRetrySuggestions, ignoredSuggestions, onIgnoreSuggestion, onApplyCandidate, onApplySafe, onCancel, onApply }: Props) {
  const { t, i18n } = useTranslation();
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const review = manifestReviewSummary(preview.rows);
  const byIndex = new Map(suggestions.map((item) => [item.index, item]));
  const counts = { safe: 0, multiple: 0, conflict: 0, none: 0 };
  for (const item of suggestions) {
    if (item.kind === "SAFE") counts.safe++;
    else if (item.kind === "MULTIPLE") counts.multiple++;
    else if (item.kind === "CONFLICT" || item.kind === "NAME_ADDRESS") counts.conflict++;
    else counts.none++;
  }
  const safeCount = suggestions.filter((item) => item.kind === "SAFE" && item.candidates.length === 1 && !preview.rows[item.index]?.townshipId && !ignoredSuggestions.includes(item.index)).length;
  const visible = preview.rows.map((row, index) => ({ row, index, suggestion: byIndex.get(index) })).filter(({ row, index, suggestion }) => !needsReviewOnly || (!ignoredSuggestions.includes(index) && !row.townshipId && suggestion?.kind !== "SAFE"));
  return <section aria-label={t("manifestPreview")} className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-400/10">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display font-bold">{t("manifestPreview")}</h2><p className="text-sm text-slate-600 dark:text-slate-300">{t("manifestPreviewSummary", { rows: preview.rows.length, pages: preview.pageCount })}</p><p className="mt-1 text-sm font-semibold">{t("manifestCodReview", { total: review.totalCod.toLocaleString(), count: review.needsReview })}</p>{preview.truncated && <p role="alert">{t("manifestTruncated")}</p>}<p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("manifestNotSaved")}</p></div>
      <div className="flex gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm font-bold">{t("cancel")}</button><button type="button" onClick={onApply} className="rounded-lg bg-[#1598ef] px-3 py-2 text-sm font-bold text-white">{t("useEditableDraft")}</button></div>
    </div>
    <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3 dark:border-white/10 dark:bg-[#181a1d]">
      <h3 className="text-sm font-bold">{t("locationSuggestions")}</h3>
      {suggestionPending ? <p role="status" className="mt-2 text-sm">{t("locationSuggestionsLoading")}</p> : suggestionError ? <p role="alert" className="mt-2 text-sm">{t("locationSuggestionsError")} <button type="button" onClick={onRetrySuggestions} className="font-bold text-[#0787df] underline">{t("retry")}</button></p> : <><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("locationSuggestionCounts", counts)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!safeCount} onClick={onApplySafe} className="rounded-lg bg-[#1598ef] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{t("applySafeLocations", { count: safeCount })}</button><button type="button" aria-pressed={needsReviewOnly} onClick={() => setNeedsReviewOnly((value) => !value)} className="rounded-lg border px-3 py-2 text-sm font-bold">{needsReviewOnly ? t("showAllRows") : t("showRowsNeedingReview")}</button></div></>}
    </div>
    <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto">
      {visible.map(({ row, index, suggestion }) => <article key={index} className="rounded-xl border border-amber-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{t("rowNumber", { number: index + 1 })} · {row.customerPhone || t("phoneMissingShort")}</h3><span className="text-xs text-slate-500">{t("sourcePage")} {row.sourcePage} · {row.orderId || row.customerName}</span></div>
        <p className="mt-1 font-medium">{row.customerName}</p>
        <p className="mt-1 text-slate-700 dark:text-slate-200">{row.address || t("addressMissingShort")}</p>
        {row.townshipId && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">{t("locationSelected")}</p>}
        {suggestion && !ignoredSuggestions.includes(index) && !row.townshipId && suggestion.candidates.length > 0 && <div className="mt-2 border-t pt-2 dark:border-white/10"><p className="text-xs font-semibold text-slate-500">{t(suggestion.kind === "NAME_ADDRESS" ? "possibleSecondPhoneMatch" : suggestion.kind === "CONFLICT" ? "locationConflict" : "previouslyUsedForShop")}</p><div className="mt-2 space-y-2">{suggestion.candidates.map((candidate, candidateIndex) => <div key={`${candidate.townshipId}-${candidateIndex}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 dark:bg-white/5"><div><p className="font-semibold">{candidate.customerName}</p><p>{candidate.address} · {candidate.township} · {candidate.regionState}</p><p className="text-xs text-slate-500">{new Intl.DateTimeFormat(i18n.resolvedLanguage === "my" ? "my-MM" : "en-GB", { dateStyle: "medium" }).format(new Date(candidate.lastUsedAt))}</p></div><button type="button" onClick={() => onApplyCandidate(index, candidate)} className="rounded-lg border border-[#1598ef] px-2 py-1 font-semibold text-[#0787df]">{t("useSuggestedLocation")}</button></div>)}</div><button type="button" onClick={() => onIgnoreSuggestion(index)} className="mt-2 text-xs font-semibold text-slate-500 underline">{t("ignoreSuggestion")}</button></div>}
        {suggestion?.kind === "NONE" && !row.townshipId && <p className="mt-2 text-xs text-slate-500">{t("noSavedLocation")}</p>}
      </article>)}
      {!visible.length && <p className="py-6 text-center text-sm text-slate-500">{t("noRowsNeedingReview")}</p>}
    </div>
  </section>;
}
