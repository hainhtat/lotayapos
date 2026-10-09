import { FileUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocationSuggestion, LocationSuggestionCandidate, ManifestPreview } from "./batch-detail-types";
import { ManifestReviewTable } from "./manifest-review-table";

export function ManifestUploadControl({ pending, onUpload }: { pending: boolean; onUpload: (file: File) => void }) {
  const { t } = useTranslation();
  return <label className="cursor-pointer rounded-xl border border-[#1598ef] px-4 py-2 text-sm font-bold text-[#0787df] transition hover:bg-[#1598ef]/5">
    <FileUp className="mr-1 inline" size={16} />
    {pending ? t("parsingPdf") : t("uploadManifestPdf")}
    <input aria-label={t("uploadManifestPdf")} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} />
  </label>;
}

export function ManifestImportReview({ preview, ...props }: { preview: ManifestPreview | null; suggestions: LocationSuggestion[]; suggestionPending: boolean; suggestionError: boolean; onRetrySuggestions: () => void; ignoredSuggestions: number[]; onIgnoreSuggestion: (index: number) => void; onApplyCandidate: (index: number, candidate: LocationSuggestionCandidate) => void; onApplySafe: () => void; onCancel: () => void; onApply: () => void }) {
  return preview ? <ManifestReviewTable preview={preview} {...props} /> : null;
}
