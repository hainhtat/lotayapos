import { FileUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManifestPreview } from "./batch-detail-types";
import { ManifestReviewTable } from "./manifest-review-table";

export function ManifestUploadControl({ pending, onUpload }: { pending: boolean; onUpload: (file: File) => void }) {
  const { t } = useTranslation();
  return <label className="cursor-pointer rounded-xl border border-[#1598ef] px-4 py-2 text-sm font-bold text-[#0787df] transition hover:bg-[#1598ef]/5">
    <FileUp className="mr-1 inline" size={16} />
    {pending ? t("parsingPdf") : t("uploadManifestPdf")}
    <input aria-label={t("uploadManifestPdf")} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} />
  </label>;
}

export function ManifestImportReview({ preview, onCancel, onApply }: { preview: ManifestPreview | null; onCancel: () => void; onApply: () => void }) {
  return preview ? <ManifestReviewTable preview={preview} onCancel={onCancel} onApply={onApply} /> : null;
}
