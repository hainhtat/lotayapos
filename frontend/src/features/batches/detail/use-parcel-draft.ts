import { useEffect, useState } from "react";
import type { ParcelRow } from "./batch-detail-types";
import { blank, isParcelRowBlank, restoreParcelDraft } from "./parcel-draft-rules";

export function useParcelDraft(batchId: string) {
  const storageKey = `lotaya-parcel-draft:${batchId}`;
  const [rows, setRows] = useState<ParcelRow[]>(() => {
    try {
      const parsed = restoreParcelDraft(localStorage.getItem(storageKey));
      if (parsed.length) return [...parsed, ...Array.from({ length: Math.max(0, 10 - parsed.length) }, blank)];
    } catch { /* Browser storage can be unavailable. */ }
    return Array.from({ length: 10 }, blank);
  });
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    try {
      const drafts = rows.filter((row) => !isParcelRowBlank(row));
      if (drafts.length) localStorage.setItem(storageKey, JSON.stringify(drafts));
      else localStorage.removeItem(storageKey);
      setStorageFailed(false);
    } catch { setStorageFailed(true); }
  }, [storageKey, rows]);
  return { rows, setRows, storageFailed };
}
