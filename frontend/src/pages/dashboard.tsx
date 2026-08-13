import { useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Clock3,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CreateBatchDialog } from "./create-batch-dialog";

type MasterData = { hubs: Array<{ id: string; name: string }>; shops: Array<{ id: string; name: string }> };
type Batch = { id: string; label: string; pickupDate: string; shop: { name: string }; parcels: Array<{ status: string }> };
type Overview = {
  totalParcels: number;
  delivered: number;
  pendingReturn: number;
  cashCollected?: number;
  grossProfit?: number;
  batches: Batch[];
  riderOutstanding?: number;
  unsettledRiderCount?: number;
  unsettledOnlineShopBatches?: number;
  codCollectedToday?: number;
  deliveryFeesToday?: number;
  walletBalances?: { cash: number; kbzPay: number; wavePay: number };
  returnsDue?: number;
  returnsOverdue?: number;
  failedPartialAlerts?: number;
  expenseTotalToday?: number;
  profitComponents?: { deliveryFeeRevenue: number; riderCommissionExpense: number; expenses: number };
  deepLinks?: { riderOutstanding:string;onlineShopSettlements:string;returnsDue:string;failedPartialAlerts:string;expenses:string };
};

type Metric = {
  key: string;
  value: string | number;
  detail?: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  to?: string;
  tone?: "default" | "warning" | "danger";
};

function normalizeOverview(value: Overview | { data: Overview }): Overview {
  const candidate = "data" in value ? value.data : value;
  return { ...candidate, batches: Array.isArray(candidate.batches) ? candidate.batches : [] };
}

async function loadOverview() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await api<Overview | { data: Overview }>("/master-data/dashboard", { signal: controller.signal });
    return normalizeOverview(response.data);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const overview = useQuery({ queryKey: ["dashboard"], queryFn: loadOverview, retry: false });
  const masters = useQuery({ queryKey: ["master-data"], queryFn: () => api<MasterData>("/master-data").then((r) => r.data) });
  const locale = i18n.resolvedLanguage === "my" ? "my-MM" : "en-US";
  const money = (value: number) => `${value.toLocaleString(locale)} MMK`;
  const data = overview.data;
  const metrics: Metric[] = [
    { key: "totalParcels", value: data?.totalParcels ?? 0, icon: PackageCheck, to: "/operations/dispatch" },
    { key: "delivered", value: data?.delivered ?? 0, icon: TrendingUp, to: "/operations/dispatch?status=DELIVERED" },
    {
      key: "riderOutstandingTotal",
      value: money(data?.riderOutstanding ?? 0),
      detail: t("unsettledRidersCount", { count: data?.unsettledRiderCount ?? 0 }),
      icon: Users,
      to: data?.deepLinks?.riderOutstanding ?? "/finance#rider-outstanding",
      tone: (data?.riderOutstanding ?? 0) > 0 ? "warning" : "default",
    },
    { key: "unsettledOsBatches", value: data?.unsettledOnlineShopBatches ?? 0, icon: Store, to: data?.deepLinks?.onlineShopSettlements ?? "/finance#os-settlements" },
    {
      key: "codCollectedToday",
      value: money(data?.codCollectedToday ?? data?.cashCollected ?? 0),
      detail: t("deliveryFeesTodayDetail", { amount: money(data?.deliveryFeesToday ?? 0) }),
      icon: Banknote,
      to: "/finance",
    },
    {
      key: "returnsDue",
      value: data?.returnsDue ?? data?.pendingReturn ?? 0,
      detail: t("returnsOverdueDetail", { count: data?.returnsOverdue ?? 0 }),
      icon: RotateCcw,
      to: data?.deepLinks?.returnsDue ?? "/operations/dispatch?status=PENDING_RETURN",
      tone: (data?.returnsOverdue ?? 0) > 0 ? "danger" : "default",
    },
    {
      key: "deliveryAlerts",
      value: data?.failedPartialAlerts ?? 0,
      detail: t("deliveryAlertsDescription"),
      icon: AlertTriangle,
      to: data?.deepLinks?.failedPartialAlerts ?? "/operations/batches#alerts",
      tone: (data?.failedPartialAlerts ?? 0) > 0 ? "danger" : "default",
    },
    {
      key: "walletBalances",
      value: money((data?.walletBalances?.cash ?? 0) + (data?.walletBalances?.kbzPay ?? 0) + (data?.walletBalances?.wavePay ?? 0)),
      detail: t("walletBalancesDetail", {
        cash: money(data?.walletBalances?.cash ?? 0),
        kbz: money(data?.walletBalances?.kbzPay ?? 0),
        wave: money(data?.walletBalances?.wavePay ?? 0),
      }),
      icon: Wallet,
      to: "/finance",
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-9 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><h1 className="font-display text-3xl font-bold lg:text-4xl">{t("welcome")}</h1><p className="mt-2 text-slate-500 dark:text-slate-400">{t("overview")}</p></div>
        <button onClick={() => setShowCreate(true)} className="rounded-xl bg-[#1598ef] px-4 py-3 text-sm font-bold text-white">+ {t("createBatch")}</button>
      </div>
      {overview.isLoading ? <p role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm dark:bg-[#181a1d]">{t("loadingOverview")}</p> : overview.isError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8 text-center dark:border-rose-900/60 dark:bg-[#181a1d]"><p className="font-semibold text-rose-700 dark:text-rose-300">{t("overviewLoadError")}</p><button className="mt-4 rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white" onClick={() => void overview.refetch()}>{t("retry")}</button></div> : <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ key, value, detail, icon: Icon, to, tone }) => <button
            key={key}
            onClick={() => to && navigate(to)}
            className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1598ef] dark:bg-[#181a1d] ${tone === "danger" ? "border-rose-200 dark:border-rose-900/60" : tone === "warning" ? "border-amber-200 dark:border-amber-900/60" : "border-black/5 dark:border-white/10"}`}
          >
            <Icon size={21} className={tone === "danger" ? "text-rose-500" : tone === "warning" ? "text-amber-500" : "text-[#1598ef]"} />
            <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">{t(key)}</p>
            <p className="mt-1 text-2xl font-bold sm:text-3xl">{value}</p>
            {detail && <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
          </button>)}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
            <div className="flex justify-between gap-3"><div><h2 className="text-lg font-bold">{t("activeBatches")}</h2><p className="text-sm text-slate-500 dark:text-slate-400">{t("activeBatchesDescription")}</p></div><button onClick={() => navigate("/operations/batches")} className="text-sm font-bold text-[#0787df]">{t("viewAll")}</button></div>
            <div className="mt-6 space-y-3">{data?.batches.map((batch) => <button onClick={() => navigate(`/operations/dispatch?batchId=${batch.id}`)} key={batch.id} className="flex w-full justify-between gap-3 rounded-xl border border-slate-100 p-4 text-left hover:border-sky-300 dark:border-white/10 dark:hover:border-sky-700"><span><b>{batch.label}</b><span className="mt-1 block text-xs text-slate-500">{batch.shop.name} · {new Date(batch.pickupDate).toLocaleDateString(locale)}</span></span><span className="shrink-0 text-sm font-bold text-[#0787df]">{batch.parcels.length} {t("records")}</span></button>)}{!data?.batches.length && <p className="py-8 text-center text-sm text-slate-400">{t("empty")}</p>}</div>
          </section>

          <section className="rounded-2xl bg-[#101318] p-6 text-white">
            <div className="flex items-start justify-between"><div><p className="text-sm text-slate-400">{t("netProfitToday")}</p><p className="mt-2 text-3xl font-bold">{money(data?.grossProfit ?? 0)}</p></div><ReceiptText className="text-[#4db7ff]" /></div>
            <dl className="mt-7 space-y-3 border-t border-white/10 pt-5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-400">{t("deliveryFeeRevenue")}</dt><dd>{money(data?.profitComponents?.deliveryFeeRevenue ?? data?.deliveryFeesToday ?? 0)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">{t("riderCost")}</dt><dd>-{money(data?.profitComponents?.riderCommissionExpense ?? 0)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-400">{t("expenseTotal")}</dt><dd>-{money(data?.profitComponents?.expenses ?? data?.expenseTotalToday ?? 0)}</dd></div>
            </dl>
            <button onClick={() => navigate("/finance")} className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#4db7ff]">{t("viewFinanceDetails")} <Clock3 size={15} /></button>
          </section>
        </div>
      </>}
      {showCreate && <CreateBatchDialog shops={masters.data?.shops ?? []} hubs={masters.data?.hubs ?? []} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
