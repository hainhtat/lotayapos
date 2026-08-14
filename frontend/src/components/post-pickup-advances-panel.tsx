import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth";

type Batch = {
  id: string;
  label: string;
  pickupDate: string;
  advancePaid: number;
  advancePosted?: boolean;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};

type PostingResult = { batchId: string; postedCount: number; alreadyPosted: boolean };

const control =
  "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

const POST_ROLES = ["SUPERADMIN", "FINANCE"] as const;

function walletLabel(wallet: string, t: (key: string) => string) {
  if (wallet === "KBZ_PAY") return t("kbzPay");
  if (wallet === "WAVE_PAY") return t("wavePay");
  return t("cash");
}

export function PostPickupAdvancesPanel({
  batches,
  loading,
  error,
  onRetry,
  onMessage,
}: {
  batches: Batch[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onMessage: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canPost = POST_ROLES.includes((user?.role ?? "") as (typeof POST_ROLES)[number]);
  const [batchId, setBatchId] = useState("");
  const [wallet, setWallet] = useState<"CASH" | "KBZ_PAY" | "WAVE_PAY">("CASH");
  const [confirming, setConfirming] = useState(false);
  const locale = i18n.resolvedLanguage === "my" ? "my-MM" : "en-US";
  const money = (value: number) => `${value.toLocaleString(locale)} MMK`;

  const rows = useMemo(() => {
    return [...batches].sort((a, b) => {
      const rank = (batch: Batch) => {
        if (batch.advancePaid <= 0) return 2;
        if (batch.advancePosted) return 1;
        return 0;
      };
      return rank(a) - rank(b) || new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime();
    });
  }, [batches]);

  const unpostedCount = batches.filter((batch) => batch.advancePaid > 0 && !batch.advancePosted).length;
  const selectedBatch = batches.find((batch) => batch.id === batchId);

  const postAdvances = useMutation({
    mutationFn: () =>
      api<PostingResult>(`/operations/batches/${batchId}/pickup-advances`, {
        method: "POST",
        body: JSON.stringify({ fundingWallet: wallet }),
      }),
    onSuccess: async ({ data }) => {
      setConfirming(false);
      setBatchId("");
      onMessage(
        data.alreadyPosted
          ? t("pickupAdvancesAlreadyPosted")
          : t("pickupAdvancePostedSuccess", {
              amount: money(selectedBatch?.advancePaid ?? 0),
              wallet: walletLabel(wallet, t),
            }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operations-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["ledger"] }),
      ]);
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : t("loadError")),
  });

  const statusFor = (batch: Batch) => {
    if (batch.advancePaid <= 0) return { key: "advanceNotRequired", className: "bg-slate-100 text-slate-500 dark:bg-white/10" };
    if (batch.advancePosted) return { key: "advancePosted", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" };
    return { key: "advanceUnposted", className: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" };
  };

  const startReview = (id: string) => {
    setBatchId(id);
    setConfirming(true);
  };

  return (
    <section className="mt-7 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-display text-lg font-bold">{t("postPickupAdvances")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("postPickupAdvancesHelp")}</p>
        </div>
        {unpostedCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <CircleAlert size={14} /> {t("advanceUnpostedCount", { count: unpostedCount })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 size={14} /> {t("allAdvancesPosted")}
          </span>
        )}
      </div>

      <ol className="mt-5 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300 sm:grid-cols-3">
        <li>{t("postPickupAdvancesStep1")}</li>
        <li>{t("postPickupAdvancesStep2")}</li>
        <li>{t("postPickupAdvancesStep3")}</li>
      </ol>

      <div className="mt-5 overflow-x-auto">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">{t("loading")}</p>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-rose-500">{t("loadError")}</p>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="mt-2 text-sm font-bold text-[#0787df]">
                {t("retry")}
              </button>
            ) : null}
          </div>
        ) : !rows.length ? (
          <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-white/10">
                <th className="pb-3">{t("batch")}</th>
                <th className="pb-3">{t("onlineShop")}</th>
                <th className="pb-3">{t("pickupDate")}</th>
                <th className="pb-3 text-right">{t("totalAdvancePaid")}</th>
                <th className="pb-3 text-right">{t("parcels")}</th>
                <th className="pb-3 text-right">{t("advancePostingStatus")}</th>
                {canPost ? <th className="pb-3 text-right">{t("actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((batch) => {
                const status = statusFor(batch);
                const canPostBatch = canPost && batch.advancePaid > 0 && !batch.advancePosted;
                return (
                  <tr key={batch.id} className="border-b border-slate-50 align-top dark:border-white/5">
                    <td className="py-3 font-semibold">{batch.label}</td>
                    <td className="py-3">{batch.shop.name}</td>
                    <td className="py-3 whitespace-nowrap">{new Date(batch.pickupDate).toLocaleDateString(locale)}</td>
                    <td className="py-3 text-right font-semibold">{money(batch.advancePaid)}</td>
                    <td className="py-3 text-right">{batch.parcels.length}</td>
                    <td className="py-3 text-right">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>{t(status.key)}</span>
                    </td>
                    {canPost ? (
                      <td className="py-3 text-right">
                        {canPostBatch ? (
                          <button
                            type="button"
                            onClick={() => startReview(batch.id)}
                            className="rounded-lg border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df]"
                          >
                            {t("reviewPosting")}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirming && selectedBatch ? (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/45 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="posting-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="posting-title" className="font-display text-xl font-bold">
                  {t("confirmPickupAdvances")}
                </h2>
                <p className="mt-2 text-sm text-slate-500">{t("confirmPickupAdvancesDescription")}</p>
              </div>
              <button type="button" aria-label={t("cancel")} onClick={() => setConfirming(false)}>
                <X />
              </button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5">
              <dt className="text-slate-500">{t("batch")}</dt>
              <dd className="text-right font-bold">{selectedBatch.label}</dd>
              <dt className="text-slate-500">{t("onlineShop")}</dt>
              <dd className="text-right font-bold">{selectedBatch.shop.name}</dd>
              <dt className="text-slate-500">{t("pickupDate")}</dt>
              <dd className="text-right font-bold">{new Date(selectedBatch.pickupDate).toLocaleDateString(locale)}</dd>
              <dt className="text-slate-500">{t("totalAdvancePaid")}</dt>
              <dd className="text-right font-bold">{money(selectedBatch.advancePaid)}</dd>
            </dl>
            <label className="mt-4 block text-xs font-bold text-slate-500">
              {t("fundingWallet")}
              <select
                aria-label={t("fundingWallet")}
                value={wallet}
                onChange={(event) => setWallet(event.target.value as typeof wallet)}
                className={`${control} mt-1 w-full`}
              >
                <option value="CASH">{t("cash")}</option>
                <option value="KBZ_PAY">{t("kbzPay")}</option>
                <option value="WAVE_PAY">{t("wavePay")}</option>
              </select>
            </label>
            <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("journalPreview")}</p>
              <div className="mt-2 space-y-1">
                <p>
                  <span className="text-slate-500">{t("debit")}:</span> {t("osAdvanceReceivable")} · {money(selectedBatch.advancePaid)}
                </p>
                <p>
                  <span className="text-slate-500">{t("credit")}:</span> {walletLabel(wallet, t)} · {money(selectedBatch.advancePaid)}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirming(false)} className={control}>
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={postAdvances.isPending}
                onClick={() => postAdvances.mutate()}
                className="rounded-xl bg-[#1598ef] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {postAdvances.isPending ? t("loading") : t("confirmAndPost")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
