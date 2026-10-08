import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ModalPortal } from "@/components/modal-portal";
import { api } from "@/lib/api";
import { hubBusinessDate } from "@/lib/business-date";
import { isDateChangeReason } from "@/lib/exception-reasons";
import type { useDispatchController } from "./use-dispatch-controller";

type Model = ReturnType<typeof useDispatchController>;
type Decision = "RETRY_TOMORROW" | "RESCHEDULE" | "RETURN_TO_OS";
const control = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/20 dark:bg-[#121416]";

export function FailedWorkflowDialog({ model }: { model: Model }) {
  const { t, reasonPrompt, setReasonPrompt, failedDecision, setFailedDecision, reasonCode, setReasonCode, reasonNote, setReasonNote, reasonList, promptReasons, reasonLabel, updateStatus, decideFailed, failedDecisionReason, setFailedDecisionReason, rescheduleDate, setRescheduleDate } = model;
  const failedPrompt = reasonPrompt?.status === "FAILED" ? reasonPrompt : null;
  const [action, setAction] = useState<Decision | "">("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const detail = useQuery({
    queryKey: ["failed-decision-context", failedDecision?.id],
    enabled: Boolean(failedDecision),
    queryFn: () => api<{ status: string; reasonCode?: string | null; statusHistory?: Array<{ toStatus: string; reasonCode?: string | null; note?: string | null }> }>(`/parcels/${encodeURIComponent(failedDecision!.id)}`).then((response) => response.data),
  });
  const failure = detail.data?.statusHistory?.filter((event) => event.toStatus === "FAILED").at(-1);
  const latestReasonCode = failure?.reasonCode ?? detail.data?.reasonCode ?? failedDecision?.reasonCode;
  const latestReason = reasonList.find((reason) => reason.code === latestReasonCode);
  useEffect(() => {
    if (!failedDecision) return;
    setAction("");
    setFailedDecisionReason("");
    setRescheduleDate(hubBusinessDate());
  }, [failedDecision?.id, setFailedDecisionReason, setRescheduleDate]);
  useEffect(() => {
    if (isDateChangeReason(latestReasonCode)) setAction((current) => current || "RESCHEDULE");
  }, [latestReasonCode]);
  const isOpen = Boolean(failedPrompt || failedDecision);
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.inert;
    if (root) root.inert = true;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setReasonPrompt(null); setFailedDecision(null); return; }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); if (root) root.inert = wasInert ?? false; previousFocus?.focus(); };
  }, [isOpen, setReasonPrompt, setFailedDecision]);
  useEffect(() => { if (isOpen) closeRef.current?.focus(); }, [isOpen, Boolean(failedDecision)]);
  if (!failedPrompt && !failedDecision) return null;
  const step = failedDecision ? 2 : 1;
  const selectedReason = reasonList.find((reason) => reason.code === reasonCode);
  const canRecord = Boolean(reasonCode) && (!selectedReason?.noteRequired || Boolean(reasonNote.trim()));
  const canDecide = detail.isSuccess && detail.data.status === "FAILED" && Boolean(failure) && Boolean(action) && failedDecisionReason.trim().length >= 3 && (action !== "RESCHEDULE" || Boolean(rescheduleDate));
  const close = () => { setReasonPrompt(null); setFailedDecision(null); };

  return <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="failed-workflow-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4">
    <section ref={dialogRef} className="my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-[#181a1d] sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">{t("failedFlowStep", { step })}</p><h2 id="failed-workflow-title" className="mt-1 font-display text-xl font-bold">{step === 1 ? t("failedFlowAttempt") : t("failedDeliveryNextStep")}</h2><p className="mt-1 text-sm text-slate-500">{(failedDecision ?? failedPrompt?.parcel)?.trackingNumber}</p></div><button ref={closeRef} type="button" aria-label={t("close")} onClick={close} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
      {step === 1 ? <form onSubmit={(event) => { event.preventDefault(); if (!failedPrompt || !canRecord) return; updateStatus.mutate({ parcelId: failedPrompt.parcel.id, status: "FAILED", reasonCode, note: reasonNote.trim() || undefined }); }} className="mt-5 space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t("failedFlowAttemptHelp")}</p>
        <label className="block text-sm font-bold">{t("reasonCode")}<select aria-label={t("reasonCode")} required value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className={`${control} mt-2`}><option value="">{t("selectReasonCode")}</option>{promptReasons.map((reason) => <option key={reason.id} value={reason.code}>{reasonLabel(reason)}</option>)}</select></label>
        <label className="block text-sm font-bold">{t("reasonNote")}<textarea aria-label={t("reasonNote")} required={Boolean(selectedReason?.noteRequired)} value={reasonNote} onChange={(event) => setReasonNote(event.target.value)} className={`${control} mt-2 min-h-24`} /></label>
        {updateStatus.isError && <p role="alert" className="text-sm text-rose-600">{updateStatus.error instanceof Error ? updateStatus.error.message : t("loadError")}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={close} className="rounded-lg border px-4 py-2 text-sm">{t("cancel")}</button><button type="submit" disabled={!canRecord || updateStatus.isPending} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{updateStatus.isPending ? t("loading") : t("failedFlowSaveContinue")}</button></div>
      </form> : <form onSubmit={(event) => { event.preventDefault(); if (!failedDecision || !action || !canDecide) return; decideFailed.mutate({ parcel: failedDecision, action, ...(action === "RESCHEDULE" ? { plannedDeliveryDate: rescheduleDate } : {}), reason: failedDecisionReason.trim() }); }} className="mt-5 space-y-4">
        {detail.isLoading ? <p role="status" className="text-sm text-slate-500">{t("loading")}</p> : detail.isError || (detail.isSuccess && detail.data.status === "FAILED" && !failure) ? <div><p role="alert" className="text-sm text-rose-600">{t("failedFlowContextError")}</p><button type="button" onClick={() => void detail.refetch()} className="mt-2 text-sm font-bold text-sky-700">{t("retry")}</button></div> : detail.data?.status !== "FAILED" ? <p role="alert" className="text-sm text-rose-600">{t("failedFlowNoLongerFailed")}</p> : <p className="rounded-xl bg-sky-50 p-3 text-sm text-slate-700 dark:bg-sky-950/30 dark:text-slate-200">{t("failedFlowSaved")} {latestReasonCode && <strong>{latestReason ? reasonLabel(latestReason) : latestReasonCode.replaceAll("_", " ")}</strong>}{failure?.note && <span className="mt-1 block break-words">{failure.note}</span>}</p>}
        <fieldset><legend className="text-sm font-bold">{t("failedFlowDecision")}</legend><div className="mt-2 grid gap-2">{(["RETRY_TOMORROW", "RESCHEDULE", "RETURN_TO_OS"] as const).map((choice) => <label key={choice} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-semibold ${action === choice ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30" : "border-slate-200 dark:border-white/10"}`}><input type="radio" name="failed-next-step" value={choice} checked={action === choice} onChange={() => setAction(choice)} />{t(choice === "RETRY_TOMORROW" ? "tryAgainTomorrow" : choice === "RESCHEDULE" ? "rescheduleDate" : "returnToOs")}</label>)}</div></fieldset>
        {action === "RESCHEDULE" && <label className="block text-sm font-bold">{t("rescheduleDate")}<input aria-label={t("rescheduleDate")} type="date" min={hubBusinessDate()} required value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} className={`${control} mt-2`} /></label>}
        {action && <label className="block text-sm font-bold">{t("failedDecisionReason")}<textarea aria-label={t("failedDecisionReason")} required minLength={3} value={failedDecisionReason} onChange={(event) => setFailedDecisionReason(event.target.value)} className={`${control} mt-2 min-h-24`} /></label>}
        {decideFailed.isError && <p role="alert" className="text-sm text-rose-600">{decideFailed.error instanceof Error ? decideFailed.error.message : t("loadError")}</p>}
        <div className="flex flex-wrap justify-end gap-3"><button type="button" onClick={close} className="rounded-lg border px-4 py-2 text-sm">{t("failedFlowDecideLater")}</button><button type="submit" disabled={!canDecide || decideFailed.isPending} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{decideFailed.isPending ? t("loading") : t("failedFlowConfirmDecision")}</button></div>
      </form>}
    </section>
  </div></ModalPortal>;
}
