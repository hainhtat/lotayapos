import { ModalPortal } from "@/components/modal-portal";
import { X } from "lucide-react";
import type { useDispatchController } from "./use-dispatch-controller";
const control = "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
function money(value: number | null | undefined) { if (value == null) return "—"; return value.toLocaleString(); }
const OPS_CORRECTION_NOTE = "Ops correction";
export function DeliveryOutcomeDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { t, reasonCode, deliveryChoice, setDeliveryChoice, paidToOs, setPaidToOs, bulkDeliveryChoice, setBulkDeliveryChoice, bulkPaidToOs, setBulkPaidToOs, includeDeliveryFee, setIncludeDeliveryFee, reasonPrompt, setReasonPrompt, rejectAsCancelled, setRejectAsCancelled, setReasonCode, reasonNote, setReasonNote, rescheduleDate, setRescheduleDate, failedDecision, setFailedDecision, failedDecisionReason, setFailedDecisionReason, reasonList, reasonLabel, promptReasons, updateStatus, decideFailed, savePaidToOs, bulkPaidToOsHasLinkedParcel, applyStatusBulk } = model;
  return <>
      {deliveryChoice && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="delivery-choice-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <button type="button" aria-label={t("close")} onClick={() => setDeliveryChoice(null)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button>
            <h2 id="delivery-choice-title" className="font-display text-xl font-bold">{t("recordDelivered")}</h2>
            <p className="mt-2 text-sm text-slate-500">{t("recordDeliveredHelp")}</p>
            {updateStatus.isError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{updateStatus.error instanceof Error ? updateStatus.error.message : t("loadError")}</p>}
            <div className="mt-5 grid gap-3">
              <button type="button" onClick={() => updateStatus.mutate({ parcelId: deliveryChoice.id, status: "DELIVERED", collectionMode: "CASH_RECEIPT_EXCEPTION", note: OPS_CORRECTION_NOTE })} disabled={updateStatus.isPending} className="rounded-xl border border-[#1598ef] p-4 text-left hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/30"><span className="block font-bold text-[#0787df]">{t("deliveredRiderCollected")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredRiderCollectedHelp")}</span></button>
              <button type="button" onClick={() => { savePaidToOs.reset(); setDeliveryChoice(null); setPaidToOs(deliveryChoice); setIncludeDeliveryFee(false); }} className="rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"><span className="block font-bold">{t("deliveredPaidToOs")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</span></button>
            </div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setDeliveryChoice(null)} className={control}>{t("cancel")}</button></div>
          </div>
        </div></ModalPortal>
      )}

      {bulkDeliveryChoice && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="bulk-delivery-choice-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <div className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <button type="button" aria-label={t("close")} onClick={() => setBulkDeliveryChoice(false)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button>
            <h2 id="bulk-delivery-choice-title" className="font-display text-xl font-bold">{t("recordDelivered")}</h2>
            <p className="mt-2 text-sm text-slate-500">{t("recordDeliveredHelp")}</p>
            <div className="mt-5 grid gap-3">
              <button type="button" onClick={() => { setBulkDeliveryChoice(false); applyStatusBulk.mutate({ collectionMode: "CASH_RECEIPT_EXCEPTION" }); }} disabled={applyStatusBulk.isPending} className="rounded-xl border border-[#1598ef] p-4 text-left hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/30"><span className="block font-bold text-[#0787df]">{t("deliveredRiderCollected")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredRiderCollectedHelp")}</span></button>
              <button type="button" onClick={() => { setBulkDeliveryChoice(false); setBulkPaidToOs(true); setIncludeDeliveryFee(false); }} className="rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"><span className="block font-bold">{t("deliveredPaidToOs")}</span><span className="mt-1 block text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</span></button>
            </div>
            <div className="mt-6 flex justify-end"><button type="button" onClick={() => setBulkDeliveryChoice(false)} className={control}>{t("cancel")}</button></div>
          </div>
        </div></ModalPortal>
      )}

      {bulkPaidToOs && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="bulk-paid-to-os-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={(event) => { event.preventDefault(); applyStatusBulk.mutate({ collectionMode: "PAID_BY_OS", paidToOsIncludeDeliveryFee: includeDeliveryFee }); }} className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
            <button type="button" aria-label={t("close")} onClick={() => setBulkPaidToOs(false)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button>
            <h2 id="bulk-paid-to-os-title" className="font-display text-xl font-bold">{t("deliveredPaidToOs")}</h2>
            <p className="mt-2 text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</p>
            {applyStatusBulk.isError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{applyStatusBulk.error instanceof Error ? applyStatusBulk.error.message : t("loadError")}</p>}
            <label className={`mt-5 flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10 ${bulkPaidToOsHasLinkedParcel ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}><input aria-label={t("includeFullDeliveryFee")} type="checkbox" disabled={bulkPaidToOsHasLinkedParcel} checked={includeDeliveryFee} onChange={(event) => setIncludeDeliveryFee(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><span className="block font-bold">{t("includeFullDeliveryFee")}</span>{bulkPaidToOsHasLinkedParcel&&<span className="mt-1 block text-slate-500">{t("linkedPaidToOsCodOnlyHelp")}</span>}</span></label>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setBulkPaidToOs(false)} className={control}>{t("cancel")}</button><button type="submit" disabled={applyStatusBulk.isPending} className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{applyStatusBulk.isPending ? t("loading") : t("confirmDeliveredPaidToOs")}</button></div>
          </form>
        </div></ModalPortal>
      )}

      {paidToOs && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="paid-to-os-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              savePaidToOs.mutate();
            }}
            className="relative my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="flex items-start justify-between gap-4"><div><h2 id="paid-to-os-title" className="font-display text-xl font-bold">{t("deliveredPaidToOs")}</h2><p className="mt-2 text-sm text-slate-500">{t("deliveredPaidToOsHelp")}</p></div><button type="button" aria-label={t("close")} onClick={() => setPaidToOs(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            {savePaidToOs.isError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{savePaidToOs.error instanceof Error ? savePaidToOs.error.message : t("loadError")}</p>}
            <div className="mt-5 rounded-xl bg-sky-50 p-4 text-sm dark:bg-sky-950/50"><p className="font-bold">{paidToOs.trackingNumber}</p><p className="mt-1 text-slate-600 dark:text-slate-300">{t("cod")}: {money(paidToOs.codAmount)} MMK</p><p className="mt-1 text-slate-600 dark:text-slate-300">{t("fee")}: {money(paidToOs.deliveryFee ?? 0)} MMK</p></div>
            <label className={`mt-5 flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10 ${paidToOs.linkGroup ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}><input aria-label={t("includeFullDeliveryFee")} type="checkbox" disabled={Boolean(paidToOs.linkGroup)} checked={includeDeliveryFee} onChange={(event) => setIncludeDeliveryFee(event.target.checked)} className="mt-0.5 h-4 w-4"/><span><span className="block font-bold">{t("includeFullDeliveryFee")}</span><span className="mt-1 block text-slate-500">{paidToOs.linkGroup?t("linkedPaidToOsCodOnlyHelp"):t("includeFullDeliveryFeeHelp", { amount: money(paidToOs.deliveryFee ?? 0) })}</span></span></label>
            <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{t("osCreditWillBe", { amount: money(paidToOs.codAmount + (includeDeliveryFee ? paidToOs.deliveryFee ?? 0 : 0)) })}</p>
            <p className="mt-2 text-xs text-slate-500">{t("osCreditAutoOffsetHelp")}</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setPaidToOs(null)} className={control}>{t("cancel")}</button><button type="submit" disabled={savePaidToOs.isPending} className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savePaidToOs.isPending ? t("loading") : t("confirmDeliveredPaidToOs")}</button></div>
          </form>
        </div></ModalPortal>
      )}

      {reasonPrompt && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="reason-prompt-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reasonPrompt.status === "PENDING_RETURN") {
                if (!reasonNote.trim()) return;
                if(reasonPrompt.parcel.status==="FAILED"){
                  decideFailed.mutate({parcel:reasonPrompt.parcel,action:"RETURN_TO_OS",reason:reasonNote});
                  return;
                }
                updateStatus.mutate({ parcelId: reasonPrompt.parcel.id, status: reasonPrompt.status, reasonCode: "RETURN_TO_OS", note: reasonNote.trim() });
                return;
              }
              if (!reasonCode) return;
              const noteNeeded = reasonList.find((r) => r.code === reasonCode)?.noteRequired;
              if (noteNeeded && !reasonNote.trim()) return;
              updateStatus.mutate({
                parcelId: reasonPrompt.parcel.id,
                status: reasonPrompt.status,
                reasonCode,
                note: reasonNote.trim() || OPS_CORRECTION_NOTE,
                ...(reasonPrompt.status === "REJECTED" && rejectAsCancelled ? { returnToOs: true } : {}),
              });
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="reason-prompt-title" className="font-display text-xl font-bold">
              {reasonPrompt.status === "PENDING_RETURN" ? t("returnReason") : t("reasonCode")} · {reasonPrompt.status.replaceAll("_", " ")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setReasonPrompt(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">{reasonPrompt.parcel.trackingNumber}</p>
            {reasonPrompt.status === "PENDING_RETURN" ? <label className="mt-5 block text-sm font-bold">{t("returnReason")}<textarea aria-label={t("returnReason")} required minLength={3} maxLength={500} value={reasonNote} onChange={event=>setReasonNote(event.target.value)} className={`${control} mt-2 min-h-28 w-full whitespace-normal`}/></label> : <label className="mt-5 block text-sm font-bold">
              {t("reasonCode")}
              <select
                aria-label={t("reasonCode")}
                required
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {promptReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            </label>}
            {reasonPrompt.status !== "PENDING_RETURN" && reasonList.find((r) => r.code === reasonCode)?.noteRequired && (
              <label className="mt-4 block text-sm font-bold">
                {t("reasonNote")}
                <textarea
                  aria-label={t("reasonNote")}
                  required
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  className={`${control} mt-2 w-full`}
                />
              </label>
            )}
            {reasonPrompt.status === "REJECTED" && <label className="mt-4 flex items-start gap-2 text-sm"><input aria-label={t("customerCancelled")} type="checkbox" checked={rejectAsCancelled} onChange={event=>setRejectAsCancelled(event.target.checked)} /><span><span className="font-bold">{t("customerCancelled")}</span><span className="mt-1 block text-xs text-slate-500">{t("customerCancelledHelp")}</span></span></label>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setReasonPrompt(null);
                  setReasonCode("");
                  setReasonNote("");
                }}
                className={control}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  updateStatus.isPending || decideFailed.isPending ||
                  (reasonPrompt.status === "PENDING_RETURN" ? reasonNote.trim().length < 3 : !reasonCode || (Boolean(reasonList.find((r) => r.code === reasonCode)?.noteRequired) && !reasonNote.trim()))
                }
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {updateStatus.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div></ModalPortal>
      )}
      {failedDecision && <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="failed-decision-title" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"><div className="flex items-start justify-between gap-3"><div><h2 id="failed-decision-title" className="text-xl font-bold">{t("failedDeliveryNextStep")}</h2><p className="mt-2 text-sm text-slate-500">{t("failedDeliveryNextStepHelp", { tracking: failedDecision.trackingNumber })}</p></div><button type="button" aria-label={t("close")} onClick={()=>setFailedDecision(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div><label className="mt-4 block text-xs font-bold text-slate-500">{t("reason")}<textarea aria-label={t("failedDecisionReason")} required minLength={3} value={failedDecisionReason} onChange={event=>setFailedDecisionReason(event.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-5 grid gap-3"><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RETRY_TOMORROW"})} className="rounded-xl border border-sky-200 p-4 text-left font-bold text-sky-800 disabled:opacity-40 dark:border-sky-800 dark:text-sky-200">{t("tryAgainTomorrow")}</button><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RESCHEDULE",plannedDeliveryDate:rescheduleDate})} className="rounded-xl border border-slate-200 p-4 text-left font-bold disabled:opacity-40 dark:border-white/10">{t("rescheduleDate")}</button><button type="button" disabled={decideFailed.isPending||failedDecisionReason.trim().length<3} onClick={()=>decideFailed.mutate({parcel:failedDecision,action:"RETURN_TO_OS"})} className="rounded-xl border border-amber-300 p-4 text-left font-bold text-amber-800 disabled:opacity-40 dark:border-amber-800 dark:text-amber-200">{t("returnToOs")}</button></div><label className="mt-4 block text-xs font-bold text-slate-500">{t("rescheduleDate")}<input aria-label={t("rescheduleDate")} type="date" value={rescheduleDate} onChange={event=>setRescheduleDate(event.target.value)} className={`${control} mt-1 w-full`}/></label>{decideFailed.isError&&<p role="alert" className="mt-3 text-sm text-rose-600">{decideFailed.error instanceof Error?decideFailed.error.message:t("loadError")}</p>}<p className="mt-4 text-xs text-slate-500">{t("cancelledDeliveryHelp")}</p></section></div></ModalPortal>}

  </>;
}
