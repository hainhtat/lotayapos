import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, BadgeDollarSign } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { api } from "@/lib/api";
import type { LedgerAccount } from "@/lib/ledger";

type Hub = { id: string; name: string };
type OsAccounts = { shops?: Array<{ returnedCod: number; creditAvailable: number }> };

export function OsCashbookOverview({ ledger, hubs = [] }: { ledger: LedgerAccount[]; hubs?: Hub[] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const requiresHub = user?.role === "SUPERADMIN";
  const [hubId, setHubId] = useState("");

  useEffect(() => {
    if (requiresHub && hubs.length === 1 && !hubId) setHubId(hubs[0].id);
  }, [requiresHub, hubs, hubId]);

  const accounts = useQuery({
    queryKey: ["finance-os-credit-snapshot", hubId],
    queryFn: () => api<OsAccounts>(`/finance/os-accounts${hubId ? `?hubId=${encodeURIComponent(hubId)}` : ""}`).then((response) => response.data),
    enabled: !requiresHub || Boolean(hubId),
  });
  const creditsRecorded = accounts.data?.shops?.reduce((sum, shop) => sum + shop.returnedCod, 0) ?? 0;
  const creditAvailable = accounts.data?.shops?.reduce((sum, shop) => sum + shop.creditAvailable, 0) ?? 0;
  const codPayable = ledger.find((entry) => entry.account === "OS_COD_PAYABLE")?.balance ?? 0;
  const cards = [
    { key: "recorded", value: creditsRecorded, label: t("osCreditsRecorded"), hint: t("osCreditsRecordedHint") },
    { key: "available", value: creditAvailable, label: t("osCreditAvailable"), hint: t("osCreditAvailableHint") },
  ];

  return (
    <section className="mt-7 rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl"><h2 className="font-display text-lg font-bold">{t("osCashbookSnapshot")}</h2><p className="mt-1 text-sm text-slate-500">{t("osCashbookSnapshotDescription")}</p></div>
        <div className="flex flex-wrap gap-2">
          <Link to="/finance?tab=settlements#os-settlements" className="inline-flex items-center gap-1 rounded-xl border border-[#1598ef] px-3 py-2 text-xs font-bold text-[#0787df]">{t("goToOsSettlements")} <ArrowUpRight size={14} /></Link>
          <Link to="/finance?tab=settlements#os-pending-returns" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-slate-300">{t("goToOsPendingReturns")} <ArrowUpRight size={14} /></Link>
        </div>
      </div>
      {requiresHub && <label className="mt-5 block max-w-sm text-xs font-bold text-slate-500">{t("osCreditHub")}<select aria-label={t("osCreditHub")} value={hubId} onChange={(event) => setHubId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-[#121416]"><option value="">{t("selectHub")}</option>{hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>}
      {accounts.isError ? <p role="alert" className="mt-5 text-sm text-rose-600">{t("loadError")}</p> : <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {cards.map(({ key, value, label, hint }) => <div key={key} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5"><div className="flex items-start gap-3"><BadgeDollarSign className="mt-0.5 shrink-0 text-[#1598ef]" size={18} /><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-display text-2xl font-bold">{accounts.isLoading ? "…" : `${value.toLocaleString()} MMK`}</p><p className="mt-2 text-xs text-slate-500">{hint}</p></div></div></div>)}
      </div>}
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead><tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400 dark:border-white/10"><th className="pb-2">{t("account")}</th><th className="pb-2 text-right">{t("balance")}</th></tr></thead><tbody>
        <tr className="border-b border-slate-50 dark:border-white/5"><td className="py-2.5 font-medium">{t("osCreditsRecorded")}</td><td className="py-2.5 text-right font-semibold">{creditsRecorded.toLocaleString()} MMK</td></tr>
        <tr className="border-b border-slate-50 dark:border-white/5"><td className="py-2.5 font-medium">{t("osCreditAvailable")}</td><td className="py-2.5 text-right font-semibold">{creditAvailable.toLocaleString()} MMK</td></tr>
        <tr className="border-b border-slate-50 dark:border-white/5"><td className="py-2.5 font-medium">OS COD PAYABLE</td><td className="py-2.5 text-right font-semibold">{codPayable.toLocaleString()} MMK</td></tr>
      </tbody></table></div>
    </section>
  );
}
