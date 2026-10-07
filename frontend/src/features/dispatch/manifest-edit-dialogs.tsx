import { ModalPortal } from "@/components/modal-portal";
import { X } from "lucide-react";
import { ParcelFieldHistory } from "@/components/parcel-field-history";
import { ManifestDialog } from "./manifest-dialog";
import type { useDispatchController } from "./use-dispatch-controller";
const control = "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
const fieldEditableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);
export function ManifestAndEditDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { t, message, manifestOpen, setManifestOpen, manifestRiderIds, setManifestRiderIds, manifestStatuses, setManifestStatuses, manifestDatePreset, setManifestDatePreset, manifestDateFrom, setManifestDateFrom, manifestDateTo, setManifestDateTo, editing, setEditing, historyParcel, setHistoryParcel, editForm, setEditForm, townships, editZones, manifestPreview, downloadManifest, updateParcel, toggleManifestRider, riders } = model;
  return <>
      {manifestOpen && <ManifestDialog
        onClose={() => setManifestOpen(false)}
        manifestDatePreset={manifestDatePreset} setManifestDatePreset={setManifestDatePreset}
        manifestDateFrom={manifestDateFrom} setManifestDateFrom={setManifestDateFrom}
        manifestDateTo={manifestDateTo} setManifestDateTo={setManifestDateTo}
        manifestStatuses={manifestStatuses} setManifestStatuses={setManifestStatuses}
        manifestRiderIds={manifestRiderIds} setManifestRiderIds={setManifestRiderIds}
        toggleManifestRider={toggleManifestRider} riders={riders}
        preview={manifestPreview} download={downloadManifest}
      />}
      {editing && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="edit-parcel-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const canEditDeliveryFields = fieldEditableStatuses.has(editing.status) && !editing.linkGroup;
              if (!editForm.customerName.trim() || !editForm.address.trim() ||
                (canEditDeliveryFields && (!editForm.townshipId || !/^\d+$/.test(editForm.codAmount) || !/^\d+$/.test(editForm.deliveryFee)))) {
                return;
              }
              updateParcel.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="edit-parcel-title" className="font-display text-xl font-bold">
              {t("editParcel")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-1 text-sm text-slate-500">{editing.trackingNumber}</p>
            {!fieldEditableStatuses.has(editing.status) || editing.linkGroup ? (
              <p role="note" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {t("parcelContactOnly")}
              </p>
            ) : null}
            {updateParcel.isError && message ? (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{message}</p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">
                {t("orderId")}
                <input
                  value={editForm.orderId}
                  onChange={(e) => setEditForm((v) => ({ ...v, orderId: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("customer")}
                <input
                  required
                  value={editForm.customerName}
                  onChange={(e) => setEditForm((v) => ({ ...v, customerName: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("address")}
                <input
                  required
                  value={editForm.address}
                  onChange={(e) => setEditForm((v) => ({ ...v, address: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("customerPhone")}
                <input
                  value={editForm.customerPhone}
                  onChange={(e) => setEditForm((v) => ({ ...v, customerPhone: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("township")}
                <select
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  aria-label={t("township")}
                  value={editForm.townshipId}
                  onChange={(e) => {
                    const townshipId = e.target.value;
                    const township = townships.data?.find((item) => item.id === townshipId);
                    setEditForm((v) => ({
                      ...v,
                      townshipId,
                      zoneId: "",
                      ...(township ? { deliveryFee: String(township.deliveryFee) } : {}),
                    }));
                  }}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">{t("township")}</option>
                  {(townships.data ?? []).map((township) => (
                    <option key={township.id} value={township.id}>
                      {township.district?.regionState?.nameEn ? `${township.district.regionState.nameEn} · ` : ""}
                      {township.district?.nameEn ? `${township.district.nameEn} · ` : ""}
                      {township.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("zone")}
                <select
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  aria-label={t("zone")}
                  value={editForm.zoneId}
                  onChange={(e) => setEditForm((v) => ({ ...v, zoneId: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">—</option>
                  {(editZones.data ?? []).map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("deliveryFee")}
                <input
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  type="number"
                  min={0}
                  aria-label={t("deliveryFee")}
                  value={editForm.deliveryFee}
                  onChange={(e) => setEditForm((v) => ({ ...v, deliveryFee: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("cod")}
                <input
                  required
                  disabled={!fieldEditableStatuses.has(editing.status) || Boolean(editing.linkGroup)}
                  type="number"
                  min={0}
                  value={editForm.codAmount}
                  onChange={(e) => setEditForm((v) => ({ ...v, codAmount: e.target.value }))}
                  className={`${control} mt-1 w-full`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={()=>{setHistoryParcel({id:editing.id,trackingNumber:editing.trackingNumber});setEditing(null)}} className={control}>{t("viewFieldHistory")}</button>
              <button type="button" onClick={() => setEditing(null)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={updateParcel.isPending}
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {updateParcel.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div></ModalPortal>
      )}
      {historyParcel&&<ParcelFieldHistory parcel={historyParcel} onClose={()=>setHistoryParcel(null)}/>}


  </>;
}
