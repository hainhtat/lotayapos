import { Fragment, type KeyboardEvent, type RefObject, type Dispatch, type SetStateAction } from "react";
import { ClipboardPaste, LayoutGrid, ListPlus, Plus, Save, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Location, ManifestPreview, ParcelRow, Township } from "./batch-detail-types";
import { blank, hydrateParcelRowLocations, isStructuredParcelPaste, parseParcelGrid, parcelRowErrorKeys, prependParcelDrafts } from "./parcel-draft-rules";
import { ManifestImportReview, ManifestUploadControl } from "./manifest-import";
import { LocationCells, DeliveryFeeCell, cell } from "./parcel-grid-cells";

type DraftEntry = { row: ParcelRow; index: number };
export function BatchDraftWorkspace({ entryMode, setEntryMode, rows, setRows, gridRef, townships, regions, hubId, uploadPending, onUpload, savePending, onSave, nextSave, message, preview, onClearPreview, onApplyPreview, invalid, saveableCount, populated, storageFailed, trackingForIndex, update, applyRowRegion, applyRowTownship, move, onOpenForm }: {
  entryMode: "spreadsheet" | "form"; setEntryMode: Dispatch<SetStateAction<"spreadsheet" | "form">>; rows: ParcelRow[]; setRows: Dispatch<SetStateAction<ParcelRow[]>>; gridRef: RefObject<HTMLDivElement | null>;
  townships: Township[]; regions: Location[]; hubId?: string; uploadPending: boolean; onUpload: (file: File) => void; savePending: boolean; onSave: (entries: DraftEntry[]) => void; nextSave: DraftEntry[];
  message: string; preview: ManifestPreview | null; onClearPreview: () => void; onApplyPreview: () => void; invalid: boolean; saveableCount: number; populated: DraftEntry[]; storageFailed: boolean;
  trackingForIndex: (index: number) => string; update: (index: number, key: keyof ParcelRow, value: string) => void; applyRowRegion: (index: number, region: string) => void; applyRowTownship: (index: number, township: string) => void; move: (event: KeyboardEvent<HTMLElement>, row: number, column: number) => void; onOpenForm: () => void;
}) {
  const { t } = useTranslation();
  return <>
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
          <ManifestUploadControl pending={uploadPending} onUpload={onUpload} />
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
                onOpenForm();
              }}
              className="rounded-xl border px-4 py-2 text-sm font-bold"
            >
              <Plus className="mr-1 inline" size={16} />
              {t("addParcelModal")}
            </button>
          )}
          <button disabled={!nextSave.length || savePending} onClick={() => onSave(nextSave)} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Save className="mr-1 inline" size={16} />
            {t("saveParcels", { count: nextSave.length })}
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
      <ManifestImportReview preview={preview} onCancel={onClearPreview} onApply={onApplyPreview} />
      {invalid && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {t("parcelGridValidation")}
        </p>
      )}
      {saveableCount > nextSave.length && <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-300">{t("parcelSaveChunk", { count: saveableCount - nextSave.length })}</p>}
      {populated.length > 0 && <p role={storageFailed ? "alert" : undefined} className="mt-2 text-xs font-medium text-slate-500">{t(storageFailed ? "draftStorageUnavailable" : "draftSavedLocally")}</p>}
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
                      <td className="py-2">{townships.find((township) => township.id === row.townshipId)?.nameEn || row.townshipId || "—"}</td>
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
          const pastedText = event.clipboardData.getData("text");
          if (!isStructuredParcelPaste(pastedText)) return;
          const parsed = parseParcelGrid(pastedText).map((row) =>
            hydrateParcelRowLocations(row, townships, regions),
          );
          if (parsed.length) {
            event.preventDefault();
            setRows((current) => prependParcelDrafts(current, parsed));
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
              const errorKeys = parcelRowErrorKeys(row, townships);
              return (
                <Fragment key={index}>
                <tr className={`border-t dark:border-white/10 ${errorKeys.length ? "bg-rose-50/40 dark:bg-rose-950/10" : ""}`}>
                  <td className="px-2 text-xs">{index + 1}</td>
                  <td className="px-2 text-sm font-semibold text-slate-500">{trackingForIndex(index)}</td>
                  <td>{input("orderId", 1)}</td>
                  <td>{input("customerName", 2)}</td>
                  <td>{input("address", 3)}</td>
                  <LocationCells
                    row={row}
                    index={index}
                    regions={regions}
                    townships={townships}
                    hubId={hubId}
                    onChangeRegion={(regionStateId) => applyRowRegion(index, regionStateId)}
                    onApplyTownship={(townshipId) => applyRowTownship(index, townshipId)}
                    onChangeZone={(zoneId) => update(index, "zoneId", zoneId)}
                    onMove={(event, column) => move(event, index, column)}
                  />
                  <td>{input("customerPhone", 8)}</td>
                  <td>{input("codAmount", 9, "text")}</td>
                  <DeliveryFeeCell row={row} townships={townships} hubId={hubId} />
                  <td>
                    <button aria-label={`${t("removeParcel")} ${index + 1}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="p-2 text-rose-500">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                {errorKeys.length > 0 && <tr><td colSpan={13} className="px-3 pb-2 text-xs font-medium text-rose-600">{t("rowNumber", { number:index+1 })}: {errorKeys.map(key=>t(key)).join(" · ")}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
  </>;
}
