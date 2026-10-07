import { ModalPortal } from "@/components/modal-portal";
import { X } from "lucide-react";
import type { useDispatchController } from "./use-dispatch-controller";
const control = "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
export function RiderStatusDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { t, message, reasonCode, partial, setPartial, correctingRider, setCorrectingRider, correctRiderId, setCorrectRiderId, correctReason, setCorrectReason, actualCod, setActualCod, collectionWallet, setCollectionWallet, setReasonCode, reasonNote, setReasonNote, reasons, reasonLabel, selectedReason, partialReasons, correctRider, savePartial, riders } = model;
  return <>
      {correctingRider && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="correct-rider-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!correctRiderId || correctReason.trim().length < 3 || correctRiderId === correctingRider.rider?.id) return;
              correctRider.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="correct-rider-title" className="font-display text-xl font-bold">
              {t("correctRider")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setCorrectingRider(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-1 text-sm text-slate-500">{correctingRider.trackingNumber}</p>
            <p role="note" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {t("correctRiderDescription")}
            </p>
            {message && correctRider.isError ? (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                {message}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              <label className="text-xs font-bold text-slate-500">
                {t("newRider")}
                <select
                  required
                  aria-label={t("newRider")}
                  value={correctRiderId}
                  onChange={(e) => setCorrectRiderId(e.target.value)}
                  className={`${control} mt-1 w-full`}
                >
                  <option value="">{t("selectRider")}</option>
                  {riders
                    .filter((rider) => rider.id !== correctingRider.rider?.id)
                    .map((rider) => (
                      <option key={rider.id} value={rider.id}>
                        {rider.user.name}
                        {rider.hub?.name ? ` · ${rider.hub.name}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-500">
                {t("correctRiderReason")}
                <textarea
                  required
                  minLength={3}
                  aria-label={t("correctRiderReason")}
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  className={`${control} mt-1 min-h-24 w-full`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setCorrectingRider(null);
                  setCorrectRiderId("");
                  setCorrectReason("");
                }}
                className={control}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={correctRider.isPending || !correctRiderId || correctReason.trim().length < 3}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {correctRider.isPending ? t("loading") : t("correctRider")}
              </button>
            </div>
          </form>
        </div></ModalPortal>
      )}

      {partial && (
        <ModalPortal><div role="dialog" aria-modal="true" aria-labelledby="partial-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/40 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                actualCod === "" ||
                !collectionWallet ||
                !reasonCode ||
                (selectedReason?.noteRequired && !reasonNote.trim()) ||
                Number(actualCod) < 0 ||
                Number(actualCod) > partial.codAmount
              ) {
                return;
              }
              savePartial.mutate();
            }}
            className="relative my-6 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex justify-between bg-white px-6 pt-6 dark:bg-[#181a1d]"><h2 id="partial-title" className="font-display text-xl font-bold">
              {t("partialReturn")}
            </h2><button type="button" aria-label={t("close")} onClick={() => setPartial(null)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button></div>
            <p className="mt-2 text-sm text-slate-500">
              {partial.trackingNumber} · {t("originalCod")}: {partial.codAmount.toLocaleString()} MMK
            </p>
            <label className="mt-5 block text-sm font-bold">
              {t("reasonCode")}
              <select
                aria-label={t("reasonCode")}
                required
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {partialReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            </label>
            {reasons.isError && <p className="mt-2 text-sm text-rose-500">{t("reasonCodesLoadError")}</p>}
            {selectedReason?.noteRequired && (
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
            <label className="mt-5 block text-sm font-bold">
              {t("actualCodCollected")}
              <input
                autoFocus
                type="number"
                min="0"
                max={partial.codAmount}
                required
                value={actualCod}
                onChange={(e) => setActualCod(e.target.value)}
                className={`${control} mt-2 w-full`}
              />
            </label>
            <label className="mt-4 block text-sm font-bold">
              {t("collectionWallet")}
              <select
                aria-label={t("collectionWallet")}
                required
                value={collectionWallet}
                onChange={(e) => setCollectionWallet(e.target.value)}
                className={`${control} mt-2 w-full`}
              >
                <option value="">{t("selectWallet")}</option>
                <option value="CASH">{t("walletCash")}</option>
                <option value="KBZ_PAY">{t("walletKbzPay")}</option>
                <option value="WAVE_PAY">{t("walletWavePay")}</option>
              </select>
            </label>
            {Number(actualCod) > partial.codAmount && (
              <p className="mt-2 text-sm text-rose-500">{t("codCannotExceedOriginal")}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPartial(null)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  savePartial.isPending ||
                  actualCod === "" ||
                  !collectionWallet ||
                  !reasonCode ||
                  (selectedReason?.noteRequired && !reasonNote.trim()) ||
                  Number(actualCod) > partial.codAmount
                }
                className="rounded-lg bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {savePartial.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </form>
        </div></ModalPortal>
      )}


  </>;
}
