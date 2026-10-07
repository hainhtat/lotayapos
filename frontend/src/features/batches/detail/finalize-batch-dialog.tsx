import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "@/components/modal-portal";
import type { Batch } from "./batch-detail-types";

export function FinalizeBatchDialog({ batch, parcelCount, pending, onClose, onConfirm }: {
  batch?: Batch;
  parcelCount: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const money = (amount: number) => `${amount.toLocaleString()} ${t("mmk")}`;
  const values = [
    [t("savedParcels"), parcelCount],
    [t("totalCodFromOs"), money(batch?.totalCod ?? 0)],
    [t("totalAdvancePaid"), money(batch?.advancePaid ?? 0)],
    [t("availableOsCredit"), money(batch?.availableOsCredit ?? 0)],
    [t("osCreditApplied"), money(batch?.expectedOsCreditApplied ?? 0)],
    [t("outstanding"), money(batch?.expectedOutstanding ?? 0)],
    [t("creditRemainingAfterFinalize"), money(Math.max(0, (batch?.availableOsCredit ?? 0) - (batch?.expectedOsCreditApplied ?? 0)))],
    [t("overAdvanceCarryForward"), money(batch?.expectedCarryForwardCredit ?? 0)],
  ] as const;
  return <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="finalize-title" className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 dark:bg-[#181a1d]">
      <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="finalize-title" className="text-xl font-bold">{t("finalizeBatch")}</h2><button type="button" aria-label={t("close")} disabled={pending} onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-white/10"><X size={18}/></button></div>
      <p className="mt-3 text-sm text-slate-500">{t("finalizeBatchExplanation")}</p>
      <dl className="mt-5 divide-y rounded-xl border px-4 text-sm dark:border-white/10">{values.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-bold">{value}</dd></div>)}</dl>
      <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={pending} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-40">{t("cancel")}</button><button type="button" disabled={pending} onClick={onConfirm} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{pending ? t("loading") : t("confirmFinalize")}</button></div>
    </section>
  </div></ModalPortal>;
}
