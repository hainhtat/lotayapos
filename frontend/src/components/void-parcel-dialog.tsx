import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/lib/api";
import { ModalPortal } from "@/components/modal-portal";

type Parcel = { id: string; trackingNumber: string; codAmount: number; deliveryFee?: number | null };
type VoidResponse = { parcelId: string; status: "VOIDED"; reversedCod: number; remainingOsBalance: number | null; replay: boolean };
type VoidPreview = { proposedObligationReduction: number; currentOsBalance: number | null; projectedOsBalance: number | null; advancePaid: number | null; availableOsCredit: number | null; lastZeroing: { codBefore: number | null; feeBefore: number | null; changedAt: string } | null };

export function VoidParcelDialog({ parcel, batchId, finalized, onClose, onSuccess }: {
  parcel: Parcel;
  batchId: string;
  finalized: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = useRef(crypto.randomUUID());
  const preview = useQuery({ queryKey: ["parcel-void-preview", parcel.id], queryFn: () => api<VoidPreview>(`/parcels/${encodeURIComponent(parcel.id)}/void-preview`).then((result) => result.data), retry: false });
  const dialogRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<{ reason: string }>({ defaultValues: { reason: "" } });
  const reasonField = register("reason", { required: true, validate: (value) => value.trim().length >= 3 && value.trim().length <= 500 });
  const mutation = useMutation({
    mutationFn: ({ reason }: { reason: string }) => api<VoidResponse>(`/parcels/${encodeURIComponent(parcel.id)}/void`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim(), idempotencyKey: key.current }),
    }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["batch", batchId] }),
        queryClient.invalidateQueries({ queryKey: ["batches"] }),
        queryClient.invalidateQueries({ queryKey: ["parcels"] }),
        queryClient.invalidateQueries({ queryKey: ["parcel-detail", parcel.id] }),
        queryClient.invalidateQueries({ queryKey: ["parcel-field-history", parcel.id] }),
        queryClient.invalidateQueries({ queryKey: ["os-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      onSuccess(result.data.remainingOsBalance === null ? t("parcelVoidDraftSuccess") : t("parcelVoidSuccess", { reversed: result.data.reversedCod.toLocaleString(), remaining: result.data.remainingOsBalance.toLocaleString() }));
    },
  });
  const error = mutation.error;
  const errorKey = error instanceof ApiError && error.status === 403 ? "parcelVoidForbidden"
    : error instanceof ApiError && error.status === 409 ? "parcelVoidConflict" : "parcelVoidError";
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reasonRef.current?.focus();
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert;
    if (appRoot) appRoot.inert = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mutation.isPending) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("textarea:not([disabled]), button:not([disabled])");
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); if (appRoot) appRoot.inert = wasInert ?? false; previousFocus?.focus(); };
  }, [mutation.isPending, onClose]);

  return <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4">
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="void-parcel-title" onSubmit={handleSubmit((values) => mutation.mutate(values))} className="my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]">
      <h2 id="void-parcel-title" className="font-display text-xl font-bold">{t("parcelVoidTitle", { tracking: parcel.trackingNumber })}</h2>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("parcelVoidExplanation")}</p>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <p>{t(finalized ? "parcelVoidFinalizedImpact" : "parcelVoidDraftImpact")}</p>
        <p className="mt-2 font-semibold">{t("parcelVoidCurrentAmounts", { cod: parcel.codAmount.toLocaleString(), fee: (parcel.deliveryFee ?? 0).toLocaleString() })}</p>
        {preview.isLoading && <p className="mt-2">{t("loading")}</p>}
        {preview.isError && <p role="alert" className="mt-2">{t("parcelVoidPreviewError")}</p>}
        {preview.data && finalized && <p className="mt-2">{t("parcelVoidBalancePreview", { before: preview.data.currentOsBalance?.toLocaleString() ?? "—", reversed: preview.data.proposedObligationReduction.toLocaleString(), after: preview.data.projectedOsBalance?.toLocaleString() ?? "—" })}</p>}
        {preview.data && finalized && <p className="mt-1">{t("parcelVoidCreditPreview", { advance: preview.data.advancePaid?.toLocaleString() ?? "—", credit: preview.data.availableOsCredit?.toLocaleString() ?? "—" })}</p>}
        {preview.data?.lastZeroing && <p className="mt-1">{t("parcelVoidZeroingAudit", { cod: preview.data.lastZeroing.codBefore?.toLocaleString() ?? "—", fee: preview.data.lastZeroing.feeBefore?.toLocaleString() ?? "—" })}</p>}
        <p className="mt-1">{t("parcelVoidZeroWarning")}</p>
      </div>
      <label htmlFor="parcel-void-reason" className="mt-5 block text-sm font-semibold">{t("parcelVoidReason")}</label>
      <textarea id="parcel-void-reason" rows={3} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? "parcel-void-reason-error" : undefined} className="mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-white/20" {...reasonField} ref={(element) => { reasonField.ref(element); reasonRef.current = element; }} />
      {errors.reason && <p id="parcel-void-reason-error" role="alert" className="mt-1 text-sm text-rose-700 dark:text-rose-300">{t("parcelVoidReasonValidation")}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{t(errorKey)}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={mutation.isPending} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">{t("cancel")}</button>
        <button type="submit" disabled={mutation.isPending || preview.isLoading || preview.isError || (finalized && preview.data?.projectedOsBalance === null)} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-50">{mutation.isPending ? t("loading") : t("parcelVoidConfirm")}</button>
      </div>
    </form>
  </div></ModalPortal>;
}
