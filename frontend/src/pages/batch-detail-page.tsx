import { AlertTriangle, ClipboardPaste, FileUp, LayoutGrid, ListPlus, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { api, apiRaw } from "@/lib/api";

type Location = { id: string; code?: string; nameEn: string; nameMy?: string };
type Township = Location & {
  deliveryFee: number;
  district?: { id: string; nameEn: string; regionStateId?: string; regionState?: { id?: string; nameEn: string } };
};
type Zone = { id: string; code?: string; name: string };
type SavedParcel = {
  id: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  address: string;
  status: string;
  codAmount: number;
  deliveryFee?: number | null;
  townshipId?: string | null;
  zoneId?: string | null;
  townshipRelation?: { id: string; nameEn: string; deliveryFee: number; district?: { id: string; regionStateId: string } } | null;
  zoneRelation?: { id: string; name: string } | null;
};
type Batch = {
  id: string;
  label: string;
  advancePaid: number;
  totalCod: number;
  remainingToOs: number;
  nextTrackingSequence: number;
  shop: { name: string };
  parcels: SavedParcel[];
};

export type ParcelRow = {
  orderId: string;
  customerName: string;
  address: string;
  regionStateId: string;
  districtId: string;
  townshipId: string;
  zoneId: string;
  customerPhone: string;
  codAmount: string;
};
type ManifestPreviewRow = ParcelRow & { sourcePage: number; confidence: number; warnings: string[] };
type ManifestPreview = { rows: ManifestPreviewRow[]; pageCount: number; truncated: boolean; extraction: "LOCAL_TEXT"; saved: false };

const blank = (): ParcelRow => ({
  orderId: "",
  customerName: "",
  address: "",
  regionStateId: "",
  districtId: "",
  townshipId: "",
  zoneId: "",
  customerPhone: "",
  codAmount: "",
});

export function isParcelRowBlank(row: ParcelRow) {
  return !Object.values(row).some(Boolean);
}

export function isParcelRowComplete(row: ParcelRow) {
  return Boolean(row.customerName.trim() && row.address.trim() && row.townshipId && /^\d+$/.test(row.codAmount));
}

export function appendParcelDraft(rows: ParcelRow[], draft: ParcelRow): ParcelRow[] {
  const blankIndex = rows.findIndex(isParcelRowBlank);
  if (blankIndex >= 0) return rows.map((row, index) => (index === blankIndex ? { ...draft } : row));
  return [...rows, { ...draft }];
}

export function formatTrackingNumber(sequence: number) {
  return `LTY-${String(sequence).padStart(3, "0")}`;
}

export function parseParcelGrid(text: string): ParcelRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((value) =>
        value.trim().replace(/^"|"$/g, ""),
      );
      return {
        orderId: cells[0] ?? "",
        customerName: cells[1] ?? "",
        address: cells[2] ?? "",
        regionStateId: cells[3] ?? "",
        districtId: cells[4] ?? "",
        townshipId: cells[5] ?? "",
        zoneId: cells[6] ?? "",
        customerPhone: cells[7] ?? "",
        codAmount: cells[8] ?? "",
      };
    });
}

const match = (items: Location[], token: string) =>
  items.find((item) => [item.id, item.code, item.nameEn, item.nameMy].some((value) => value?.toLocaleLowerCase() === token.toLocaleLowerCase()))?.id ?? token;

const cell =
  "min-w-[130px] border-0 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-inset focus:ring-[#1598ef] dark:text-slate-100";
const field =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

function useRowLocationData(row: ParcelRow, regions: Location[]) {
  const resolvedRegion = match(regions, row.regionStateId);
  const districts = useQuery({
    queryKey: ["locations", "districts", resolvedRegion],
    enabled: Boolean(resolvedRegion),
    queryFn: () =>
      api<Location[]>(`/master-data/locations/districts?regionStateId=${encodeURIComponent(resolvedRegion!)}`).then((response) => response.data),
  });
  const resolvedDistrict = match(districts.data ?? [], row.districtId);
  const townships = useQuery({
    queryKey: ["locations", "townships", resolvedDistrict],
    enabled: Boolean(resolvedDistrict),
    queryFn: () =>
      api<Township[]>(`/master-data/locations/townships?districtId=${encodeURIComponent(resolvedDistrict!)}`).then((response) => response.data),
  });
  const resolvedTownship = match(townships.data ?? [], row.townshipId);
  const zones = useQuery({
    queryKey: ["locations", "zones", resolvedTownship],
    enabled: Boolean(resolvedTownship),
    queryFn: () =>
      api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(resolvedTownship!)}`).then((response) => response.data),
  });
  const deliveryFee = townships.data?.find((township) => township.id === resolvedTownship)?.deliveryFee;
  return { districts, townships, zones, deliveryFee, resolvedRegion, resolvedDistrict, resolvedTownship };
}

function LocationCells({
  row,
  index,
  regions,
  onChange,
  onMove,
}: {
  row: ParcelRow;
  index: number;
  regions: Location[];
  onChange: (key: keyof ParcelRow, value: string) => void;
  onMove: (event: React.KeyboardEvent<HTMLElement>, column: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const { districts, townships, zones, resolvedRegion, resolvedDistrict, resolvedTownship } = useRowLocationData(row, regions);
  const label = (value: Location) => (i18n.resolvedLanguage === "my" && value.nameMy ? value.nameMy : value.nameEn);
  const select = (key: keyof ParcelRow, column: number, items: Location[], name: string) => (
    <select
      data-cell={`${index}-${column}`}
      aria-label={`${name} ${index + 1}`}
      value={match(items, row[key])}
      onChange={(event) => onChange(key, event.target.value)}
      onKeyDown={(event) => onMove(event, column)}
      className={cell}
      disabled={
        (key === "districtId" && !resolvedRegion) ||
        (key === "townshipId" && !resolvedDistrict) ||
        (key === "zoneId" && !resolvedTownship)
      }
    >
      <option value="">—</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {label(item)}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <td>{select("regionStateId", 4, regions, t("region"))}</td>
      <td>{select("districtId", 5, districts.data ?? [], t("district"))}</td>
      <td>{select("townshipId", 6, townships.data ?? [], t("township"))}</td>
      <td>{select("zoneId", 7, (zones.data ?? []).map((zone) => ({ ...zone, nameEn: zone.name })), t("zone"))}</td>
    </>
  );
}

function DeliveryFeeCell({ row, regions }: { row: ParcelRow; regions: Location[] }) {
  const { deliveryFee } = useRowLocationData(row, regions);
  return (
    <td className="px-2 text-sm font-bold">
      {deliveryFee != null ? `${deliveryFee.toLocaleString()} MMK` : "—"}
    </td>
  );
}

const SAVED_PARCELS_PAGE_SIZE = 50;

export function BatchDetailPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const gridRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(() => Array.from({ length: 10 }, blank));
  const [entryMode, setEntryMode] = useState<"spreadsheet" | "form">("spreadsheet");
  const [formOpen, setFormOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<ParcelRow>(blank);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const [editing, setEditing] = useState<SavedParcel | null>(null);
  const [savedPage, setSavedPage] = useState(1);
  const [editForm, setEditForm] = useState({ orderId: "", customerName: "", address: "", customerPhone: "", codAmount: "", townshipId: "", zoneId: "" });
  const batch = useQuery({
    queryKey: ["batch", id],
    queryFn: () => api<Batch>(`/operations/batches/${id}`).then((response) => response.data),
  });
  const regions = useQuery({
    queryKey: ["locations", "regions"],
    queryFn: () => api<Location[]>("/master-data/locations/regions").then((response) => response.data),
  });
  const allTownships = useQuery({
    queryKey: ["locations", "townships", "all"],
    queryFn: () => api<Array<Township & { district?: { id: string; nameEn: string; regionState?: { nameEn: string } } }>>("/master-data/locations/townships").then((response) => response.data),
  });
  const editZones = useQuery({
    queryKey: ["locations", "zones", editForm.townshipId],
    enabled: Boolean(editForm.townshipId),
    queryFn: () => api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(editForm.townshipId)}`).then((response) => response.data),
  });
  const formZones = useQuery({
    queryKey: ["locations", "zones", formDraft.townshipId],
    enabled: Boolean(formOpen && formDraft.townshipId),
    queryFn: () => api<Zone[]>(`/master-data/locations/zones?townshipId=${encodeURIComponent(formDraft.townshipId)}`).then((response) => response.data),
  });
  useEffect(() => {
    if (!editing) return;
    setEditForm({
      orderId: editing.orderId ?? "",
      customerName: editing.customerName,
      address: editing.address,
      customerPhone: editing.customerPhone ?? "",
      codAmount: String(editing.codAmount),
      townshipId: editing.townshipId ?? "",
      zoneId: editing.zoneId ?? "",
    });
  }, [editing]);
  const savedParcels = batch.data?.parcels ?? [];
  const savedPageCount = Math.max(1, Math.ceil(savedParcels.length / SAVED_PARCELS_PAGE_SIZE));
  const pagedSavedParcels = savedParcels.slice(
    (savedPage - 1) * SAVED_PARCELS_PAGE_SIZE,
    savedPage * SAVED_PARCELS_PAGE_SIZE,
  );
  useEffect(() => {
    setSavedPage(1);
  }, [savedParcels.length]);
  useEffect(() => {
    if (savedPage > savedPageCount) setSavedPage(savedPageCount);
  }, [savedPage, savedPageCount]);
  const remainingToOs = batch.data?.remainingToOs ?? 0;
  const updateParcel = useMutation({
    mutationFn: () =>
      api(`/parcels/${editing!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          orderId: editForm.orderId.trim() || null,
          customerName: editForm.customerName.trim(),
          address: editForm.address.trim(),
          customerPhone: editForm.customerPhone.trim() || null,
          codAmount: Number(editForm.codAmount),
          townshipId: editForm.townshipId,
          zoneId: editForm.zoneId || null,
        }),
      }),
    onSuccess: async () => {
      setMessage(t("parcelUpdated"));
      setEditing(null);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["batch", id] }), queryClient.invalidateQueries({ queryKey: ["parcels"] })]);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });
  const uploadManifest = useMutation({
    mutationFn: async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase().endsWith(".pdf")) throw new Error(t("pdfOnly"));
      const response = await apiRaw(`/operations/batches/${id}/manifest-preview`, { method: "POST", headers: { "content-type": "application/pdf" }, body: file });
      const payload = await response.json() as { success: true; data: ManifestPreview };
      return payload.data;
    },
    onSuccess: (data) => { setPreview(data); setMessage(""); },
    onError: (error) => { setPreview(null); setMessage(error instanceof Error ? error.message : t("loadError")); },
  });
  const applyManifestPreview = () => {
    if (!preview) return;
    setRows(preview.rows.map(({ sourcePage: _sourcePage, confidence: _confidence, warnings: _warnings, ...row }) => row));
    setMessage(t("manifestDraftApplied", { count: preview.rows.length }));
    setPreview(null);
  };
  const trackingBase = batch.data?.nextTrackingSequence ?? 1;
  const trackingForIndex = (index: number) => formatTrackingNumber(trackingBase + index);
  const populated = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !isParcelRowBlank(row)),
    [rows],
  );
  const invalid = populated.some(({ row }) => !isParcelRowComplete(row));
  const applyFormTownship = (townshipId: string) => {
    const township = allTownships.data?.find((item) => item.id === townshipId);
    setFormDraft((current) => ({
      ...current,
      townshipId,
      zoneId: "",
      districtId: township?.district?.id ?? "",
      regionStateId: township?.district?.regionState?.id ?? township?.district?.regionStateId ?? "",
    }));
  };
  const commitFormDraft = (close: boolean) => {
    if (!isParcelRowComplete(formDraft)) return;
    setRows((current) => appendParcelDraft(current, formDraft));
    setFormDraft(blank());
    if (close) setFormOpen(false);
  };
  const update = (index: number, key: keyof ParcelRow, value: string) =>
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: value,
              ...(key === "regionStateId" ? { districtId: "", townshipId: "", zoneId: "" } : {}),
              ...(key === "districtId" ? { townshipId: "", zoneId: "" } : {}),
              ...(key === "townshipId" ? { zoneId: "" } : {}),
            }
          : row,
      ),
    );
  const move = (event: React.KeyboardEvent<HTMLElement>, row: number, column: number) => {
    if (!["Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, row + (event.key === "ArrowUp" ? -1 : 1)));
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next}-${column}"]`)?.focus();
  };
  const save = useMutation({
    mutationFn: () =>
      api(`/operations/batches/${id}/parcels/bulk`, {
        method: "POST",
        body: JSON.stringify({
          parcels: populated.map(({ row, index }) => ({
            trackingNumber: trackingForIndex(index),
            orderId: row.orderId.trim() || undefined,
            customerName: row.customerName.trim(),
            address: row.address.trim(),
            townshipId: row.townshipId,
            zoneId: row.zoneId || undefined,
            customerPhone: row.customerPhone.trim() || undefined,
            codAmount: Number(row.codAmount),
          })),
        }),
      }),
    onSuccess: async () => {
      setMessage(t("parcelsSaved", { count: populated.length }));
      setRows(Array.from({ length: 10 }, blank));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["batch", id] }), queryClient.invalidateQueries({ queryKey: ["parcels"] })]);
    },
  });

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#0787df]">{batch.data?.shop.name}</p>
          <h1 className="font-display text-3xl font-bold">{batch.data?.label ?? t("batchDetail")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">{t("batchEntryDescription")}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("savedParcels")}</p>
          <p className="mt-2 font-display text-2xl font-bold">{savedParcels.length.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("totalCodFromOs")}</p>
          <p className="mt-2 font-display text-2xl font-bold">{(batch.data?.totalCod ?? 0).toLocaleString()} MMK</p>
        </div>
        <div className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("totalAdvancePaid")}</p>
          <p className="mt-2 font-display text-2xl font-bold">{(batch.data?.advancePaid ?? 0).toLocaleString()} MMK</p>
        </div>
        <div
          className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-[#181a1d] ${
            remainingToOs < 0
              ? "border-amber-200 dark:border-amber-900/60"
              : "border-black/5 dark:border-white/10"
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("remainingToOs")}</p>
          <p
            className={`mt-2 font-display text-2xl font-bold ${
              remainingToOs < 0 ? "text-amber-700 dark:text-amber-300" : ""
            }`}
          >
            {remainingToOs.toLocaleString()} MMK
          </p>
          <p className="mt-2 text-xs text-slate-500">{t("remainingToOsHint")}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 p-1 dark:border-white/10">
          <button
            type="button"
            aria-pressed={entryMode === "spreadsheet"}
            onClick={() => setEntryMode("spreadsheet")}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${entryMode === "spreadsheet" ? "bg-[#eaf6ff] text-[#0787df]" : "text-slate-500"}`}
          >
            <LayoutGrid size={14} className="mr-1 inline" />
            {t("entrySpreadsheet")}
          </button>
          <button
            type="button"
            aria-pressed={entryMode === "form"}
            onClick={() => setEntryMode("form")}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold ${entryMode === "form" ? "bg-[#eaf6ff] text-[#0787df]" : "text-slate-500"}`}
          >
            <ListPlus size={14} className="mr-1 inline" />
            {t("entryForm")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-xl border border-[#1598ef] px-4 py-2 text-sm font-bold text-[#0787df] transition hover:bg-[#1598ef]/5">
            <FileUp className="mr-1 inline" size={16} />
            {uploadManifest.isPending ? t("parsingPdf") : t("uploadManifestPdf")}
            <input aria-label={t("uploadManifestPdf")} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={uploadManifest.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadManifest.mutate(file); event.currentTarget.value = ""; }} />
          </label>
          {entryMode === "spreadsheet" && (
            <button onClick={() => setRows((current) => [...current, ...Array.from({ length: 10 }, blank)])} className="rounded-xl border px-4 py-2 text-sm font-bold">
              <Plus className="mr-1 inline" size={16} />
              {t("addTenRows")}
            </button>
          )}
          {entryMode === "form" && (
            <button
              type="button"
              onClick={() => {
                setFormDraft(blank());
                setFormOpen(true);
              }}
              className="rounded-xl border px-4 py-2 text-sm font-bold"
            >
              <Plus className="mr-1 inline" size={16} />
              {t("addParcelModal")}
            </button>
          )}
          <button disabled={!populated.length || invalid || save.isPending} onClick={() => save.mutate()} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Save className="mr-1 inline" size={16} />
            {t("saveParcels", { count: populated.length })}
          </button>
        </div>
      </div>
      {entryMode === "spreadsheet" && (
        <p className="mt-3 text-sm text-slate-500">
          <ClipboardPaste className="mr-2 inline" size={16} />
          {t("pasteGridHint")}
        </p>
      )}
      {entryMode === "form" && (
        <p className="mt-3 text-sm text-slate-500">{t("formEntryHint")}</p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-[#0787df]">
          {message}
        </p>
      )}
      {preview && (
        <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-400/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-display font-bold">{t("manifestPreview")}</h2><p className="text-sm text-slate-600 dark:text-slate-300">{t("manifestPreviewSummary", { rows: preview.rows.length, pages: preview.pageCount })}</p><p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("manifestNotSaved")}</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => setPreview(null)} className="rounded-lg border px-3 py-2 text-sm font-bold">{t("cancel")}</button><button type="button" onClick={applyManifestPreview} className="rounded-lg bg-[#1598ef] px-3 py-2 text-sm font-bold text-white">{t("useEditableDraft")}</button></div>
          </div>
          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-amber-200 bg-white dark:border-white/10 dark:bg-[#181a1d]"><table className="w-full min-w-[780px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 dark:bg-[#222529]"><tr><th className="p-2">{t("sourcePage")}</th><th>{t("orderId")}</th><th>{t("customer")}</th><th>{t("address")}</th><th>{t("customerPhone")}</th><th className="text-right">{t("cod")}</th><th className="px-2">{t("confidence")}</th></tr></thead><tbody>{preview.rows.map((row,index)=><tr key={`${row.sourcePage}-${index}`} className="border-t dark:border-white/10"><td className="p-2">{row.sourcePage}</td><td>{row.orderId}</td><td>{row.customerName}</td><td className="max-w-xs p-2">{row.address}{row.warnings.length>0&&<span className="mt-1 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><AlertTriangle size={11}/>{row.warnings.map(code=>t(`manifestWarning.${code}`)).join(" · ")}</span>}</td><td>{row.customerPhone||"—"}</td><td className="text-right font-bold">{row.codAmount.toLocaleString()}</td><td className="px-2">{Math.round(row.confidence*100)}%</td></tr>)}</tbody></table></div>
        </section>
      )}
      {invalid && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {t("parcelGridValidation")}
        </p>
      )}
      {entryMode === "form" && (
        <section className="mt-4 rounded-2xl border bg-white p-4 dark:border-white/10 dark:bg-[#181a1d]">
          <h2 className="font-display font-bold">{t("draftParcels")}</h2>
          {!populated.length ? (
            <p className="mt-3 text-sm text-slate-400">{t("empty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase text-slate-500">
                    <th className="pb-2">{t("tracking")}</th>
                    <th className="pb-2">{t("orderId")}</th>
                    <th className="pb-2">{t("customer")}</th>
                    <th className="pb-2">{t("township")}</th>
                    <th className="pb-2 text-right">{t("cod")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {populated.map(({ row, index }) => (
                    <tr key={index} className="border-t dark:border-white/10">
                      <td className="py-2 font-bold">{trackingForIndex(index)}</td>
                      <td className="py-2">{row.orderId || "—"}</td>
                      <td className="py-2">{row.customerName}</td>
                      <td className="py-2">{allTownships.data?.find((township) => township.id === row.townshipId)?.nameEn || row.townshipId || "—"}</td>
                      <td className="py-2 text-right">{row.codAmount}</td>
                      <td className="py-2 text-right">
                        <button aria-label={`${t("removeParcel")} ${index + 1}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="p-2 text-rose-500">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {entryMode === "spreadsheet" && (
      <div
        ref={gridRef}
        onPaste={(event) => {
          const parsed = parseParcelGrid(event.clipboardData.getData("text"));
          if (parsed.length) {
            event.preventDefault();
            setRows((current) => [...parsed, ...current].slice(0, 500));
          }
        }}
        className="mt-4 overflow-auto rounded-2xl border bg-white dark:border-white/10 dark:bg-[#181a1d]"
      >
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-[#222529]">
            <tr>
              <th>#</th>
              {["tracking", "orderId", "customer", "address", "region", "district", "township", "zone", "customerPhone", "cod", "deliveryFee"].map((key) => (
                <th key={key} className="min-w-[130px] px-2 py-3">
                  {t(key)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const input = (key: keyof ParcelRow, column: number, type = "text") => (
                <input
                  data-cell={`${index}-${column}`}
                  aria-label={`${t(key === "customerName" ? "customer" : key === "codAmount" ? "cod" : key)} ${index + 1}`}
                  type={type}
                  value={row[key]}
                  onChange={(event) => update(index, key, event.target.value)}
                  onKeyDown={(event) => move(event, index, column)}
                  className={`${cell} ${key === "address" ? "min-w-[240px]" : ""}`}
                />
              );
              return (
                <tr key={index} className="border-t dark:border-white/10">
                  <td className="px-2 text-xs">{index + 1}</td>
                  <td className="px-2 text-sm font-semibold text-slate-500">{trackingForIndex(index)}</td>
                  <td>{input("orderId", 1)}</td>
                  <td>{input("customerName", 2)}</td>
                  <td>{input("address", 3)}</td>
                  <LocationCells row={row} index={index} regions={regions.data ?? []} onChange={(key, value) => update(index, key, value)} onMove={(event, column) => move(event, index, column)} />
                  <td>{input("customerPhone", 8)}</td>
                  <td>{input("codAmount", 9, "number")}</td>
                  <DeliveryFeeCell row={row} regions={regions.data ?? []} />
                  <td>
                    <button aria-label={`${t("removeParcel")} ${index + 1}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="p-2 text-rose-500">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {(batch.data?.parcels.length ?? 0) > 0 && (
        <section className="mt-8 rounded-2xl border bg-white p-6 dark:border-white/10 dark:bg-[#181a1d]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">{t("savedParcelList")}</h2>
            {savedParcels.length > SAVED_PARCELS_PAGE_SIZE && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">{t("savedParcelsPage", { page: savedPage, total: savedPageCount })}</span>
                <button
                  type="button"
                  disabled={savedPage <= 1}
                  onClick={() => setSavedPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border px-3 py-1 font-bold disabled:opacity-40"
                >
                  {t("previous")}
                </button>
                <button
                  type="button"
                  disabled={savedPage >= savedPageCount}
                  onClick={() => setSavedPage((page) => Math.min(savedPageCount, page + 1))}
                  className="rounded-lg border px-3 py-1 font-bold disabled:opacity-40"
                >
                  {t("next")}
                </button>
              </div>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-slate-500 dark:border-white/10">
                  <th className="pb-3">{t("tracking")}</th>
                  <th className="pb-3">{t("orderId")}</th>
                  <th className="pb-3">{t("customer")}</th>
                  <th className="pb-3">{t("township")}</th>
                  <th className="pb-3 text-right">{t("cod")}</th>
                  <th className="pb-3 text-right">{t("deliveryFee")}</th>
                  <th className="pb-3">{t("status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pagedSavedParcels.map((parcel) => (
                  <tr key={parcel.id} className="border-b dark:border-white/5">
                    <td className="py-3 font-bold">{parcel.trackingNumber}</td>
                    <td className="py-3">{parcel.orderId || "—"}</td>
                    <td className="py-3">{parcel.customerName}</td>
                    <td className="py-3">{parcel.townshipRelation?.nameEn || "—"}</td>
                    <td className="py-3 text-right font-bold">{parcel.codAmount.toLocaleString()} MMK</td>
                    <td className="py-3 text-right">{(parcel.deliveryFee ?? 0).toLocaleString()} MMK</td>
                    <td className="py-3">{parcel.status}</td>
                    <td className="py-3 text-right">
                      {["CREATED", "PICKED_UP", "ASSIGNED"].includes(parcel.status) && (
                        <button aria-label={`${t("editParcel")} ${parcel.trackingNumber}`} onClick={() => setEditing(parcel)} className="rounded-lg border px-2 py-1 text-xs font-bold text-[#0787df]">
                          <Pencil size={14} className="mr-1 inline" />
                          {t("editParcel")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {formOpen && (
        <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/45 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-parcel-title"
            onSubmit={(event) => {
              event.preventDefault();
              commitFormDraft(false);
            }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"
          >
            <h2 id="add-parcel-title" className="font-display text-xl font-bold">{t("addParcelModal")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("formEntryHint")}</p>
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">{t("orderId")}<input value={formDraft.orderId} onChange={(e) => setFormDraft((v) => ({ ...v, orderId: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("customer")}<input required value={formDraft.customerName} onChange={(e) => setFormDraft((v) => ({ ...v, customerName: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("address")}<input required value={formDraft.address} onChange={(e) => setFormDraft((v) => ({ ...v, address: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("customerPhone")}<input value={formDraft.customerPhone} onChange={(e) => setFormDraft((v) => ({ ...v, customerPhone: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("township")}<select required value={formDraft.townshipId} onChange={(e) => applyFormTownship(e.target.value)} className={field}><option value="">{t("township")}</option>{allTownships.data?.map((township) => <option key={township.id} value={township.id}>{township.district?.regionState?.nameEn ? `${township.district.regionState.nameEn} · ` : ""}{township.district?.nameEn ? `${township.district.nameEn} · ` : ""}{township.nameEn}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("zone")}<select value={formDraft.zoneId} onChange={(e) => setFormDraft((v) => ({ ...v, zoneId: e.target.value }))} className={field}><option value="">—</option>{formZones.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("cod")}<input required type="number" min={0} value={formDraft.codAmount} onChange={(e) => setFormDraft((v) => ({ ...v, codAmount: e.target.value }))} className={field} /></label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-bold">{t("cancel")}</button>
              <button type="button" disabled={!isParcelRowComplete(formDraft)} onClick={() => commitFormDraft(true)} className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50">{t("addAndClose")}</button>
              <button disabled={!isParcelRowComplete(formDraft)} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t("addNextParcel")}</button>
            </div>
          </form>
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!editForm.customerName.trim() || !editForm.address.trim() || !editForm.townshipId || !/^\d+$/.test(editForm.codAmount)) return;
              updateParcel.mutate();
            }}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"
          >
            <h2 className="font-display text-xl font-bold">{t("editParcel")}</h2>
            <p className="mt-1 text-sm text-slate-500">{editing.trackingNumber}</p>
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">{t("orderId")}<input value={editForm.orderId} onChange={(e) => setEditForm((v) => ({ ...v, orderId: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("customer")}<input required value={editForm.customerName} onChange={(e) => setEditForm((v) => ({ ...v, customerName: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("address")}<input required value={editForm.address} onChange={(e) => setEditForm((v) => ({ ...v, address: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("customerPhone")}<input value={editForm.customerPhone} onChange={(e) => setEditForm((v) => ({ ...v, customerPhone: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("township")}<select required value={editForm.townshipId} onChange={(e) => setEditForm((v) => ({ ...v, townshipId: e.target.value, zoneId: "" }))} className={field}><option value="">{t("township")}</option>{allTownships.data?.map((township) => <option key={township.id} value={township.id}>{township.district?.regionState?.nameEn ? `${township.district.regionState.nameEn} · ` : ""}{township.district?.nameEn ? `${township.district.nameEn} · ` : ""}{township.nameEn}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("zone")}<select value={editForm.zoneId} onChange={(e) => setEditForm((v) => ({ ...v, zoneId: e.target.value }))} className={field}><option value="">—</option>{editZones.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("cod")}<input required type="number" min={0} value={editForm.codAmount} onChange={(e) => setEditForm((v) => ({ ...v, codAmount: e.target.value }))} className={field} /></label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm font-bold">{t("cancel")}</button>
              <button disabled={updateParcel.isPending} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{updateParcel.isPending ? t("loading") : t("save")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
