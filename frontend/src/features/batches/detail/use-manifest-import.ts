import { useState, type Dispatch, type SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ManifestPreview, ParcelRow } from "./batch-detail-types";
import { previewBatchManifest } from "./batch-detail-api";
import { isParcelRowBlank, normalizeManifestRow } from "./parcel-draft-rules";

export function useManifestImport(batchId: string, setRows: Dispatch<SetStateAction<ParcelRow[]>>, setMessage: (message: string) => void) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase().endsWith(".pdf")) throw new Error(t("pdfOnly"));
      try { return await previewBatchManifest(batchId, file); }
      catch (error) { throw error instanceof Error && error.message === "INVALID_MANIFEST_PREVIEW" ? new Error(t("loadError")) : error; }
    },
    onSuccess: (data) => { setPreview(data); setMessage(""); },
    onError: (error) => { setPreview(null); setMessage(error instanceof Error ? error.message : t("loadError")); },
  });
  const applyPreview = () => {
    if (!preview) return;
    setRows((current) => [...current.filter((row) => !isParcelRowBlank(row)), ...preview.rows.map(normalizeManifestRow)]);
    setMessage(t("manifestDraftApplied", { count: preview.rows.length }));
    setPreview(null);
  };
  return { preview, upload, applyPreview, clearPreview: () => setPreview(null) };
}
