import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "@/components/modal-portal";
import type { SavedParcel, Township, Zone } from "./batch-detail-types";

export type ParcelEditFields = {
  orderId: string;
  customerName: string;
  address: string;
  customerPhone: string;
  codAmount: string;
  deliveryFee: string;
  townshipId: string;
  zoneId: string;
};

const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
const editableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);

export function ParcelEditDialog({ parcel, fields, setFields, townships, zones, pending, onSave, onClose, onHistory }: {
  parcel: SavedParcel;
  fields: ParcelEditFields;
  setFields: Dispatch<SetStateAction<ParcelEditFields>>;
  townships: Township[];
  zones: Zone[];
  pending: boolean;
  onSave: () => void;
  onClose: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const editable = editableStatuses.has(parcel.status) && !parcel.linkGroupId;
  const change = (key: keyof ParcelEditFields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fields.customerName.trim() || !fields.address.trim()) return;
    if (editable && (!fields.townshipId || !/^\d+$/.test(fields.codAmount) || !/^\d+$/.test(fields.deliveryFee))) return;
    onSave();
  };
  return <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/45 p-4">
    <form role="dialog" aria-modal="true" aria-label={`${t("editParcel")} ${parcel.trackingNumber}`} onSubmit={submit} className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 className="font-display text-xl font-bold">{t("editParcel")}</h2><button type="button" aria-label={t("close")} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
      <p className="mt-1 text-sm text-slate-500">{parcel.trackingNumber}</p>
      {parcel.linkGroupId && <p role="note" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t("parcelUpdateError.PARCEL_LINKED")}</p>}
      <div className="mt-4 grid gap-3">
        <label className="text-xs font-bold text-slate-500">{t("orderId")}<input value={fields.orderId} onChange={(event) => change("orderId", event.target.value)} className={field} /></label>
        <label className="text-xs font-bold text-slate-500">{t("customer")}<input required value={fields.customerName} onChange={(event) => change("customerName", event.target.value)} className={field} /></label>
        <label className="text-xs font-bold text-slate-500">{t("address")}<input required value={fields.address} onChange={(event) => change("address", event.target.value)} className={field} /></label>
        <label className="text-xs font-bold text-slate-500">{t("customerPhone")}<input value={fields.customerPhone} onChange={(event) => change("customerPhone", event.target.value)} className={field} /></label>
        <label className="text-xs font-bold text-slate-500">{t("township")}<select required disabled={!editable} value={fields.townshipId} onChange={(event) => { const townshipId = event.target.value; const township = townships.find((item) => item.id === townshipId); setFields((current) => ({ ...current, townshipId, zoneId: "", ...(township ? { deliveryFee: String(township.deliveryFee) } : {}) })); }} className={field}><option value="">{t("township")}</option>{townships.map((township) => <option key={township.id} value={township.id}>{township.district?.regionState?.nameEn ? `${township.district.regionState.nameEn} · ` : ""}{township.district?.nameEn ? `${township.district.nameEn} · ` : ""}{township.nameEn}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">{t("zone")}<select disabled={!editable} value={fields.zoneId} onChange={(event) => change("zoneId", event.target.value)} className={field}><option value="">—</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">{t("deliveryFee")}<input required disabled={!editable} type="number" min={0} aria-label={t("deliveryFee")} value={fields.deliveryFee} onChange={(event) => change("deliveryFee", event.target.value)} className={field} /></label>
        <label className="text-xs font-bold text-slate-500">{t("cod")}<input required disabled={!editable} type="number" min={0} value={fields.codAmount} onChange={(event) => change("codAmount", event.target.value)} className={field} /></label>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onHistory} className="rounded-xl border px-4 py-2 text-sm font-bold">{t("viewFieldHistory")}</button>
        <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold">{t("cancel")}</button>
        <button disabled={pending} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? t("loading") : t("save")}</button>
      </div>
    </form>
  </div></ModalPortal>;
}
