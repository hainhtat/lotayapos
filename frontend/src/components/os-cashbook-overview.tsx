import { Link } from "react-router-dom";
import { ArrowUpRight, RotateCcw, Store } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LedgerAccount } from "@/lib/ledger";

const OS_ACCOUNTS = ["OS_ADVANCE_RECEIVABLE", "OS_SETTLEMENT_OFFSET", "OS_RETURN_DEDUCTION"] as const;

export function OsCashbookOverview({ ledger }: { ledger: LedgerAccount[] }) {
  const { t } = useTranslation();
  const byAccount = new Map(ledger.map((line) => [line.account, line.balance]));
  const cards = [
    {
      key: "OS_ADVANCE_RECEIVABLE",
      label: t("osAdvanceReceivable"),
      hint: t("osAdvanceReceivableHint"),
      icon: Store,
    },
    {
      key: "OS_SETTLEMENT_OFFSET",
      label: t("osSettlementOffset"),
      hint: t("osSettlementOffsetHint"),
      icon: RotateCcw,
    },
  ] as const;

  return (
    <section className="mt-7 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-display text-lg font-bold">{t("osCashbookSnapshot")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("osCashbookSnapshotDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/finance?tab=settlements#os-settlements"
            className="inline-flex items-center gap-1 rounded-xl border border-[#1598ef] px-3 py-2 text-xs font-bold text-[#0787df]"
          >
            {t("goToOsSettlements")} <ArrowUpRight size={14} />
          </Link>
          <Link
            to="/finance?tab=settlements#os-pending-returns"
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-slate-300"
          >
            {t("goToOsPendingReturns")} <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {cards.map(({ key, label, hint, icon: Icon }) => {
          const balance = byAccount.get(key) ?? 0;
          return (
            <div key={key} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 shrink-0 text-[#1598ef]" size={18} />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 font-display text-2xl font-bold">{balance.toLocaleString()} MMK</p>
                  <p className="mt-2 text-xs text-slate-500">{hint}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-white/10">
              <th className="pb-2">{t("account")}</th>
              <th className="pb-2 text-right">{t("balance")}</th>
            </tr>
          </thead>
          <tbody>
            {OS_ACCOUNTS.map((account) => {
              const line = ledger.find((entry) => entry.account === account);
              return (
                <tr key={account} className="border-b border-slate-50 dark:border-white/5">
                  <td className="py-2.5 font-medium">{account.replaceAll("_", " ")}</td>
                  <td className="py-2.5 text-right font-semibold">{(line?.balance ?? 0).toLocaleString()} MMK</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
