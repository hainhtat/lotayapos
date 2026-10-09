import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocationSuggestionCandidate, ParcelRow } from "./batch-detail-types";
import { useLocationSuggestion } from "./use-location-suggestion";

export function RowPhoneSuggestion({ batchId, row, index, onUse }: { batchId: string; row: ParcelRow; index: number; onUse: (candidate: LocationSuggestionCandidate) => void }) {
  const { t } = useTranslation();
  const [ignoredPhone, setIgnoredPhone] = useState("");
  const lookup = useLocationSuggestion(batchId, row);
  if (ignoredPhone === row.customerPhone) return null;
  return <tr><td colSpan={13} className="px-3 pb-2">
    {lookup.pending && <p role="status" className="text-xs text-slate-500">{t("locationSuggestionsLoading")}</p>}
    {lookup.isError && <p role="alert" className="text-xs text-rose-600">{t("locationSuggestionsError")}</p>}
    {lookup.suggestion?.kind === "NONE" && <p role="status" className="text-xs text-slate-500">{t("noSavedLocation")}</p>}
    {lookup.suggestion?.candidates.length ? <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-sm dark:border-sky-800 dark:bg-sky-950/30"><p className="font-semibold">{t("rowNumber", { number: index + 1 })} · {t(lookup.suggestion.kind === "NAME_ADDRESS" ? "possibleSecondPhoneMatch" : lookup.suggestion.kind === "CONFLICT" ? "locationConflict" : "previouslyUsedForShop")}</p>{lookup.suggestion.candidates.map((candidate, candidateIndex) => <div key={candidateIndex} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 dark:border-white/10"><p><strong>{candidate.customerName}</strong> · {candidate.address} · {candidate.township} · {candidate.regionState}</p><button type="button" onClick={() => { onUse(candidate); setIgnoredPhone(row.customerPhone); }} className="font-semibold text-[#0787df] underline">{t("useSuggestedLocation")}</button></div>)}<button type="button" onClick={() => setIgnoredPhone(row.customerPhone)} className="mt-2 text-xs text-slate-500 underline">{t("ignoreSuggestion")}</button></div> : null}
  </td></tr>;
}
