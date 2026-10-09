import { useState, type Dispatch, type SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LocationSuggestion, LocationSuggestionCandidate, ManifestPreview, ParcelRow } from "./batch-detail-types";
import { getLocationSuggestions, previewBatchManifest } from "./batch-detail-api";
import { isParcelRowBlank, normalizeManifestRow } from "./parcel-draft-rules";

export function useManifestImport(batchId: string, setRows: Dispatch<SetStateAction<ParcelRow[]>>, setMessage: (message: string) => void) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState(false);
  const [ignored, setIgnored] = useState<number[]>([]);
  const lookup = useMutation({ mutationFn: (data: ManifestPreview) => getLocationSuggestions(batchId, data.rows), onSuccess: (rows) => { setSuggestions(rows); setSuggestionError(false); }, onError: () => setSuggestionError(true) });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase().endsWith(".pdf")) throw new Error(t("pdfOnly"));
      try { return await previewBatchManifest(batchId, file); }
      catch (error) { throw error instanceof Error && error.message === "INVALID_MANIFEST_PREVIEW" ? new Error(t("loadError")) : error; }
    },
    onSuccess: (data) => { setPreview(data); setSuggestions([]); setIgnored([]); setSuggestionError(false); setMessage(""); lookup.mutate(data); },
    onError: (error) => { setPreview(null); setSuggestions([]); setMessage(error instanceof Error ? error.message : t("loadError")); },
  });
  const applyCandidate = (index: number, candidate: LocationSuggestionCandidate) => setPreview((current) => current && ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, address: row.address.trim() || candidate.address, townshipId: candidate.townshipId, districtId: candidate.districtId, regionStateId: candidate.regionStateId } : row) }));
  const applySafe = () => setPreview((current) => current && ({ ...current, rows: current.rows.map((row, index) => {
    const suggestion = suggestions.find((item) => item.index === index);
    if (ignored.includes(index) || suggestion?.kind !== "SAFE" || suggestion.candidates.length !== 1 || row.townshipId.trim()) return row;
    const candidate = suggestion.candidates[0]!;
    return { ...row, address: row.address.trim() || candidate.address, townshipId: candidate.townshipId, districtId: candidate.districtId, regionStateId: candidate.regionStateId };
  }) }));
  const applyPreview = () => {
    if (!preview) return;
    setRows((current) => [...current.filter((row) => !isParcelRowBlank(row)), ...preview.rows.map(normalizeManifestRow)]);
    setMessage(t("manifestDraftApplied", { count: preview.rows.length }));
    setPreview(null); setSuggestions([]); setIgnored([]);
  };
  return { preview, suggestions, suggestionPending: lookup.isPending, suggestionError, retrySuggestions: () => { if (preview) lookup.mutate(preview); }, ignored, ignoreSuggestion: (index: number) => setIgnored((current) => [...current, index]), applyCandidate, applySafe, upload, applyPreview, clearPreview: () => { setPreview(null); setSuggestions([]); setIgnored([]); } };
}
