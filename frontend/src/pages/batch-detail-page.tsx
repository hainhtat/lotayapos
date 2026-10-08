import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useBatchDetail } from "@/features/batches/detail/use-batch-detail";
import { useManifestImport } from "@/features/batches/detail/use-manifest-import";
import { useParcelDraft } from "@/features/batches/detail/use-parcel-draft";
import { ParcelFieldHistory } from "@/components/parcel-field-history";
import { BatchWorkspaceSummary } from "@/components/batch-workspace-summary";
import { useAuth } from "@/app/auth";
import { VoidParcelDialog } from "@/components/void-parcel-dialog";
import { ParcelEntryForm } from "@/features/batches/detail/parcel-entry-form";
import { ParcelTable } from "@/features/batches/detail/parcel-table";
import { BatchDraftWorkspace } from "@/features/batches/detail/batch-draft-workspace";
import { ParcelEditDialog } from "@/features/batches/detail/parcel-edit-dialog";
import { FinalizeBatchDialog } from "@/features/batches/detail/finalize-batch-dialog";
import { isParcelThreeDaysInHand } from "@/features/batches/detail/parcel-age";

import type { SavedParcel, ParcelRow } from "@/features/batches/detail/batch-detail-types";
import { isParcelRowBlank, isParcelRowComplete, appendParcelDraft, formatTrackingNumber, applyTownshipToParcelRow, isParcelRowLocationConsistent, hydrateParcelRowLocations } from "@/features/batches/detail/parcel-draft-rules";

export function BatchDetailPage() {
  const { id = "" } = useParams();
  return <BatchDetailContent key={id} />;
}

function BatchDetailContent() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const user = useAuth()?.user;
  const preferMyanmar = i18n.resolvedLanguage === "my";
  const gridRef = useRef<HTMLDivElement>(null);
  const { rows, setRows, storageFailed } = useParcelDraft(id);
  const [entryMode, setEntryMode] = useState<"spreadsheet" | "form">("spreadsheet");
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<SavedParcel | null>(null);
  const [voiding, setVoiding] = useState<SavedParcel | null>(null);
  const [historyParcel,setHistoryParcel]=useState<{id:string;trackingNumber:string}|null>(null);
  const [confirmFinalize,setConfirmFinalize]=useState(false);
  const [showThreeDaysInHand, setShowThreeDaysInHand] = useState(false);
  const [editForm, setEditForm] = useState({ orderId: "", customerName: "", address: "", customerPhone: "", codAmount: "", deliveryFee: "", townshipId: "", zoneId: "" });
  const { batch, regions, allTownships, editZones, finalize, updateParcel, save } = useBatchDetail({
    id, editing, editForm, setEditing, setRows, setMessage, closeFinalize: () => setConfirmFinalize(false),
  });
  const manifest = useManifestImport(id, setRows, setMessage);
  useEffect(() => {
    if (!editing) return;
    setEditForm({
      orderId: editing.orderId ?? "",
      customerName: editing.customerName,
      address: editing.address,
      customerPhone: editing.customerPhone ?? "",
      codAmount: String(editing.codAmount),
      deliveryFee: String(editing.deliveryFee ?? 0),
      townshipId: editing.townshipId ?? "",
      zoneId: editing.zoneId ?? "",
    });
  }, [editing]);
  const savedParcels = batch.data?.parcels ?? [];
  const activeParcelCount = savedParcels.filter((parcel) => parcel.status !== "VOIDED").length;
  const threeDaysInHandIds = new Set(batch.data?.threeDaysInHand?.parcelIds ?? savedParcels.filter((parcel) => isParcelThreeDaysInHand(parcel)).map((parcel) => parcel.id));
  const nextThreeDaysDueAt = batch.data?.threeDaysInHand?.nextDueAt;
  const threeDaysCalculatedAt = batch.data?.threeDaysInHand?.calculatedAt;
  useEffect(() => {
    if (!nextThreeDaysDueAt || !threeDaysCalculatedAt) return;
    const delay = Math.max(0, Date.parse(nextThreeDaysDueAt) - Date.parse(threeDaysCalculatedAt)) + 100;
    if (!Number.isFinite(delay)) return;
    const timer = window.setTimeout(() => { void batch.refetch(); }, delay);
    return () => window.clearTimeout(timer);
  }, [nextThreeDaysDueAt, threeDaysCalculatedAt, batch.refetch]);
  const remainingToOs = batch.data?.remainingToOs ?? 0;
  const finalized = Boolean(batch.data?.finalizedAt);
  const canFinalize=["SUPERADMIN","OPERATIONS_MANAGER","DISPATCHER"].includes(user?.role??"");
  const canVoidParcel=["SUPERADMIN","OPERATIONS_MANAGER"].includes(user?.role??"");
  const trackingBase = batch.data?.nextTrackingSequence ?? 1;
  const trackingForIndex = (index: number) => formatTrackingNumber(trackingBase + index);
  const populated = useMemo(
    () =>
      rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => !isParcelRowBlank(row)),
    [rows],
  );
  const saveable = populated.filter(
    ({ row }) => isParcelRowComplete(row) && isParcelRowLocationConsistent(row, allTownships.data ?? []),
  );
  const invalid = saveable.length !== populated.length;
  const nextSave = saveable.slice(0, 500);
  useEffect(() => {
    const catalogTownships = allTownships.data;
    const catalogRegions = regions.data;
    if (!catalogTownships?.length || !catalogRegions?.length) return;
    setRows((current) => {
      let changed = false;
      const next = current.map((row) => {
        if (isParcelRowBlank(row)) return row;
        const hydrated = hydrateParcelRowLocations(row, catalogTownships, catalogRegions);
        if (
          hydrated.regionStateId !== row.regionStateId ||
          hydrated.districtId !== row.districtId ||
          hydrated.townshipId !== row.townshipId ||
          hydrated.zoneId !== row.zoneId
        ) {
          changed = true;
          return hydrated;
        }
        return row;
      });
      return changed ? next : current;
    });
  }, [allTownships.data, regions.data]);
  const update = (index: number, key: keyof ParcelRow, value: string) =>
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    );
  const applyRowRegion = (index: number, regionStateId: string) =>
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, regionStateId, districtId: "", townshipId: "", zoneId: "" }
          : row,
      ),
    );
  const applyRowTownship = (index: number, townshipId: string) =>
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? applyTownshipToParcelRow(row, townshipId, allTownships.data ?? []) : row,
      ),
    );
  const move = (event: React.KeyboardEvent<HTMLElement>, row: number, column: number) => {
    if (!["Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(rows.length - 1, row + (event.key === "ArrowUp" ? -1 : 1)));
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next}-${column}"]`)?.focus();
  };
  return (
    <div className="mx-auto max-w-[1600px]">
      <BatchWorkspaceSummary shopName={batch.data?.shop.name} label={batch.data?.label} finalized={finalized} canFinalize={!finalized&&canFinalize} parcelCount={activeParcelCount} threeDaysInHandCount={threeDaysInHandIds.size} totalCod={batch.data?.totalCod??0} advancePaid={batch.data?.advancePaid??0} remainingToOs={finalized ? remainingToOs : (batch.data?.expectedOutstanding ?? remainingToOs)} balanceError={batch.data?.balanceError} onFinalize={()=>setConfirmFinalize(true)} onShowThreeDaysInHand={() => setShowThreeDaysInHand(true)} />
      {finalized && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">{t("finalizedBatchLocked")}</p>}
      {!finalized && <BatchDraftWorkspace entryMode={entryMode} setEntryMode={setEntryMode} rows={rows} setRows={setRows} gridRef={gridRef} townships={allTownships.data ?? []} regions={regions.data ?? []} hubId={batch.data?.hubId} uploadPending={manifest.upload.isPending} onUpload={(file) => manifest.upload.mutate(file)} savePending={save.isPending} onSave={(entries) => save.mutate(entries)} nextSave={nextSave} message={message} preview={manifest.preview} onClearPreview={manifest.clearPreview} onApplyPreview={manifest.applyPreview} invalid={invalid} saveableCount={saveable.length} populated={populated} storageFailed={storageFailed} trackingForIndex={trackingForIndex} update={update} applyRowRegion={applyRowRegion} applyRowTownship={applyRowTownship} move={move} onOpenForm={() => setFormOpen(true)} />}
      <ParcelTable parcels={savedParcels} threeDaysInHandIds={threeDaysInHandIds} showThreeDaysInHand={showThreeDaysInHand} onShowThreeDaysInHandChange={setShowThreeDaysInHand} finalized={finalized} canVoidParcel={canVoidParcel} onHistory={(parcel) => setHistoryParcel({ id: parcel.id, trackingNumber: parcel.trackingNumber })} onEdit={setEditing} onVoid={setVoiding} />
      {voiding && <VoidParcelDialog parcel={voiding} batchId={id} finalized={finalized} onClose={() => setVoiding(null)} onSuccess={(success) => { setVoiding(null); setMessage(success); }} />}
      {formOpen && <ParcelEntryForm townships={allTownships.data ?? []} hubId={batch.data?.hubId} preferMyanmar={preferMyanmar} onClose={() => setFormOpen(false)} onCommit={(row) => setRows((current) => appendParcelDraft(current, row))} />}
      {editing && <ParcelEditDialog parcel={editing} fields={editForm} setFields={setEditForm} townships={allTownships.data ?? []} zones={editZones.data ?? []} pending={updateParcel.isPending} onSave={() => updateParcel.mutate()} onClose={() => setEditing(null)} onHistory={() => { setHistoryParcel({ id: editing.id, trackingNumber: editing.trackingNumber }); setEditing(null); }} />}
      {confirmFinalize && <FinalizeBatchDialog batch={batch.data} parcelCount={activeParcelCount} pending={finalize.isPending} onClose={() => setConfirmFinalize(false)} onConfirm={() => finalize.mutate()} />}
      {historyParcel&&<ParcelFieldHistory parcel={historyParcel} onClose={()=>setHistoryParcel(null)}/>}
    </div>
  );
}
