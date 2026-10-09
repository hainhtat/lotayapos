import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "@/components/modal-portal";
import { useLocationZones } from "./use-location-zones";
import type { ParcelRow, Township } from "./batch-detail-types";
import { useLocationSuggestion } from "./use-location-suggestion";
import { applyTownshipToParcelRow, blank, isParcelRowComplete } from "./parcel-draft-rules";
import { townshipOptionLabel } from "./parcel-entry-locations";

const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

export function ParcelEntryForm({ batchId, townships, hubId, preferMyanmar, onClose, onCommit }: { batchId: string; townships: Township[]; hubId?: string; preferMyanmar: boolean; onClose: () => void; onCommit: (row: ParcelRow) => void }) {
  const { t } = useTranslation();
  const [formDraft, setFormDraft] = useState<ParcelRow>(blank);
  const [ignoredPhone, setIgnoredPhone] = useState("");
  const lookup = useLocationSuggestion(batchId, formDraft);
  const zones = useLocationZones(hubId, formDraft.townshipId);
  const applyFormTownship = (townshipId: string) => setFormDraft((current) => applyTownshipToParcelRow(current, townshipId, townships, { syncRegion: true }));
  const commitFormDraft = (close: boolean) => { if (!isParcelRowComplete(formDraft)) return; onCommit(formDraft); setFormDraft(blank()); setIgnoredPhone(""); if (close) onClose(); };
  return (
        <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/45 p-4">
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
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="add-parcel-title" className="font-display text-xl font-bold">{t("addParcelModal")}</h2><button type="button" aria-label={t("close")} onClick={() => onClose()} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-1 text-sm text-slate-500">{t("formEntryHint")}</p>
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">{t("orderId")}<input value={formDraft.orderId} onChange={(e) => setFormDraft((v) => ({ ...v, orderId: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("customerPhone")}<input value={formDraft.customerPhone} onChange={(e) => setFormDraft((v) => ({ ...v, customerPhone: e.target.value }))} className={field} /></label>
              {lookup.pending && <p role="status" className="text-xs text-slate-500">{t("locationSuggestionsLoading")}</p>}
              {lookup.isError && <p role="alert" className="text-xs text-rose-600">{t("locationSuggestionsError")}</p>}
              {lookup.suggestion?.candidates.length && ignoredPhone !== formDraft.customerPhone && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950/30"><p className="font-semibold">{t(lookup.suggestion.kind === "NAME_ADDRESS" ? "possibleSecondPhoneMatch" : lookup.suggestion.kind === "CONFLICT" ? "locationConflict" : "previouslyUsedForShop")}</p>{lookup.suggestion.candidates.map((candidate, index) => <div key={index} className="mt-2 border-t pt-2 dark:border-white/10"><p className="font-semibold">{candidate.customerName}</p><p>{candidate.address} · {candidate.township} · {candidate.regionState}</p><button type="button" onClick={() => { setFormDraft((current) => ({ ...current, customerName: current.customerName.trim() || candidate.customerName, address: current.address.trim() || candidate.address, townshipId: candidate.townshipId, districtId: candidate.districtId, regionStateId: candidate.regionStateId })); setIgnoredPhone(formDraft.customerPhone); }} className="mt-1 font-semibold text-[#0787df] underline">{t("useSuggestedLocation")}</button></div>)}<button type="button" onClick={() => setIgnoredPhone(formDraft.customerPhone)} className="mt-2 text-xs text-slate-500 underline">{t("ignoreSuggestion")}</button></div>}
              <label className="text-xs font-bold text-slate-500">{t("customer")}<input required value={formDraft.customerName} onChange={(e) => setFormDraft((v) => ({ ...v, customerName: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("address")}<input required value={formDraft.address} onChange={(e) => setFormDraft((v) => ({ ...v, address: e.target.value }))} className={field} /></label>
              <label className="text-xs font-bold text-slate-500">{t("township")}<select required value={formDraft.townshipId} onChange={(e) => applyFormTownship(e.target.value)} className={field}><option value="">{t("township")}</option>{townships.map((township) => <option key={township.id} value={township.id}>{townshipOptionLabel(township, preferMyanmar, { includeRegion: true, includeDistrict: true })}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("zone")}<select value={formDraft.zoneId} onChange={(e) => setFormDraft((v) => ({ ...v, zoneId: e.target.value }))} className={field}><option value="">—</option>{zones.data?.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">{t("cod")}<input required type="number" min={0} value={formDraft.codAmount} onChange={(e) => setFormDraft((v) => ({ ...v, codAmount: e.target.value }))} className={field} /></label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => onClose()} className="rounded-xl border px-4 py-2 text-sm font-bold">{t("cancel")}</button>
              <button type="button" disabled={!isParcelRowComplete(formDraft)} onClick={() => commitFormDraft(true)} className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50">{t("addAndClose")}</button>
              <button disabled={!isParcelRowComplete(formDraft)} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t("addNextParcel")}</button>
            </div>
          </form>
        </div></ModalPortal>
  );
}
