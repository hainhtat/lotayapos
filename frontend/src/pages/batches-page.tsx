import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CreateBatchDialog } from "./create-batch-dialog";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuth } from "@/app/auth";
import { OsAccountsPanel } from "@/components/os-accounts-panel";
import { HistoricalSettlementPanel } from "@/components/historical-settlement-panel";

type BatchSummary = {
  id: string;
  label: string;
  pickupDate: string;
  hubId?: string;
  outstanding?: number;
  balanceError?: string | null;
  historicallySettled?: boolean;
  overdueCount?: number;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};

const control =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

function batchStats(parcels: Array<{ status: string }>) {
  const total = parcels.filter((parcel) => parcel.status !== "VOIDED").length;
  const delivered = parcels.filter((parcel) => parcel.status === "DELIVERED").length;
  const pendingReturn = parcels.filter((parcel) => parcel.status === "PENDING_RETURN").length;
  const remaining = parcels.filter((parcel) => !["DELIVERED", "RETURNED", "VOIDED"].includes(parcel.status)).length;
  return { total, delivered, pendingReturn, remaining };
}

export function BatchesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState("active");
  const [settling, setSettling] = useState<BatchSummary | null>(null);
  const [filters, setFilters] = useState({ search: "", dateFrom: "", dateTo: "", shopId: "", hubId: "" });
  const debouncedSearch = useDebouncedValue(filters.search,350);
  const queryFilters = { ...filters, search: debouncedSearch, view };
  const masters = useQuery({ queryKey: ["master-data"], queryFn: () => api<{shops:Array<{id:string;name:string}>;hubs:Array<{id:string;name:string}>}>("/master-data").then((r) => r.data) });

  const batches = useQuery({
    queryKey: ["operations-batches", page, queryFilters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      Object.entries(queryFilters).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
      return api<BatchSummary[]>(`/operations/batches?${params}`).then((response) => ({
        items: response.data,
        pagination: response.pagination ?? { page, pageSize: 25, total: response.data.length, totalPages: 1 },
      }));
    },
    placeholderData: (previous) => previous,
  });

  const activeBatchId = new URLSearchParams(window.location.search).get("batchId") ?? "";

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("allBatches")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("allBatchesDescription")}</p>
        </div>
        <div className="flex gap-2"><button type="button" onClick={() => void batches.refetch()} className={`${control} flex items-center gap-2 font-bold`}><RefreshCw size={14}/>{t("refresh")}</button><button type="button" onClick={()=>setShowCreate(true)} className="flex items-center gap-2 rounded-md bg-[#1598ef] px-3 py-2 text-xs font-bold text-white"><Plus size={14}/>{t("createNewBatch")}</button></div>
      </div>

      <section className="mt-5 rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label={t("batchViews")} className="flex gap-2">{["active", "history", "all"].map(value => <button type="button" key={value} aria-pressed={view === value} onClick={() => { setView(value); setPage(1); }} className={`rounded-lg px-3 py-2 text-sm font-bold ${view === value ? "bg-sky-600 text-white" : "text-slate-500 dark:text-slate-300"}`}>{t(value === "active" ? "activeBatches" : value === "history" ? "history" : "all")}</button>)}</nav>
          <span className="rounded-full bg-[#eaf6ff] px-2.5 py-0.5 text-[11px] font-bold text-[#0787df] dark:bg-[#1598ef]/15">
            {(batches.data?.pagination.total ?? 0)} {t("batches")}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-slate-500">{t("searchBatches")}<input aria-label={t("searchBatches")} type="search" value={filters.search} onChange={(event) => { setFilters((value) => ({ ...value, search: event.target.value })); setPage(1); }} className={`${control} mt-1 w-full`} /></label>
          <label className="text-xs font-bold text-slate-500">{t("dateFrom")}<input aria-label={`${t("allBatches")} ${t("dateFrom")}`} type="date" value={filters.dateFrom} onChange={(event) => { setFilters((value) => ({ ...value, dateFrom: event.target.value })); setPage(1); }} className={`${control} mt-1 w-full`} /></label>
          <label className="text-xs font-bold text-slate-500">{t("dateTo")}<input aria-label={`${t("allBatches")} ${t("dateTo")}`} type="date" value={filters.dateTo} onChange={(event) => { setFilters((value) => ({ ...value, dateTo: event.target.value })); setPage(1); }} className={`${control} mt-1 w-full`} /></label>
          {(masters.data?.shops?.length ?? 0) > 1 && <label className="text-xs font-bold text-slate-500">{t("onlineShop")}<select aria-label={`${t("allBatches")} ${t("onlineShop")}`} value={filters.shopId} onChange={(event) => { setFilters((value) => ({ ...value, shopId: event.target.value })); setPage(1); }} className={`${control} mt-1 w-full`}><option value="">{t("all")}</option>{(masters.data?.shops ?? []).map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>}
          {(masters.data?.hubs?.length ?? 0) > 1 && <label className="text-xs font-bold text-slate-500">{t("hub")}<select aria-label={`${t("allBatches")} ${t("hub")}`} value={filters.hubId} onChange={(event) => { setFilters((value) => ({ ...value, hubId: event.target.value })); setPage(1); }} className={`${control} mt-1 w-full`}><option value="">{t("all")}</option>{(masters.data?.hubs ?? []).map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>}
        </div>
        {batches.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("loading")}</p>
        ) : batches.isError ? (
          <div className="py-6 text-center">
            <p className="text-sm text-rose-500">{t("loadError")}</p>
            <button type="button" onClick={() => void batches.refetch()} className="mt-2 text-sm font-bold text-[#0787df]">
              {t("retry")}
            </button>
          </div>
        ) : !batches.data?.items.length ? (
          <p className="py-6 text-center text-sm text-slate-400">{t("empty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400 dark:border-white/10">
                  <th className="py-2 pr-2">{t("batch")}</th>
                  <th className="py-2 pr-2">{t("shopName")}</th>
                  <th className="py-2 pr-2">{t("pickupDate")}</th>
                  <th className="py-2 pr-2 text-right">{t("total")}</th>
                  <th className="py-2 pr-2 text-right">{t("remaining")}</th>
                  <th className="py-2 pr-2 text-right">{t("delivered")}</th>
                  <th className="py-2 pr-2 text-right">{t("pendingReturn")}</th>
                  <th className="py-2 pr-2 text-right">{t("remainingToOs")}</th>
                  <th className="py-2 text-right">{t("open")}</th>
                </tr>
              </thead>
              <tbody>
                {(batches.data?.items ?? []).map((batch) => {
                  const stats = batchStats(batch.parcels);
                  const active = activeBatchId === batch.id;
                  return (
                    <tr
                      key={batch.id}
                      className={`border-b border-slate-100 dark:border-white/5 ${active ? "bg-[#eaf6ff]/70 dark:bg-[#1598ef]/10" : "hover:bg-slate-50/80 dark:hover:bg-white/[0.03]"}`}
                    >
                      <td className="py-2 pr-2 font-bold">{batch.label}{batch.historicallySettled && <span className="mt-1 block text-xs font-normal text-slate-500">{t("settledHistorically")}</span>}{Boolean(batch.overdueCount) && <button type="button" className="mt-1 block text-xs text-amber-700 dark:text-amber-300" onClick={() => navigate(`/operations/dispatch?batchId=${batch.id}&queue=overdue`)}>{t("batchOverdueCount", { count: batch.overdueCount })}</button>}</td>
                      <td className="py-2 pr-2">{batch.shop.name}</td>
                      <td className="py-2 pr-2 whitespace-nowrap text-slate-500">{new Date(batch.pickupDate).toLocaleDateString()}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{stats.total}</td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums text-[#0787df]">{stats.remaining}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[#12a66a]">{stats.delivered}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-amber-600">{stats.pendingReturn}</td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums">{batch.outstanding == null ? "—" : batch.outstanding.toLocaleString()}{batch.balanceError && <p className="max-w-xs text-xs font-normal text-amber-700">{batch.balanceError}</p>}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {["SUPERADMIN", "FINANCE"].includes(user?.role ?? "") && (batch.outstanding ?? 0) > 0 && <button type="button" onClick={() => setSettling(batch)} className="rounded-md border border-sky-500 px-2 py-1 text-xs font-bold text-sky-600">{t("settle")}</button>}
                          <button
                            type="button"
                            className="rounded-md border border-[#1598ef] px-2 py-1 text-[11px] font-bold text-[#0787df]"
                            onClick={() =>
                              navigate(active ? "/operations/dispatch" : `/operations/dispatch?batchId=${batch.id}`)
                            }
                          >
                            {t("viewParcels")}
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-[#1598ef] px-2 py-1 text-[11px] font-bold text-white"
                            onClick={() => navigate(`/batches/${batch.id}`)}
                          >
                            {t("openBatch")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {batches.data && batches.data.pagination.totalPages > 1 && (
          <nav aria-label={t("batchPagination")} className="mt-4 flex items-center justify-between text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="font-bold text-[#0787df] disabled:opacity-40">{t("previous")}</button>
            <span>{t("pageOf", { page: batches.data.pagination.page, total: batches.data.pagination.totalPages })}</span>
            <button type="button" disabled={page >= batches.data.pagination.totalPages} onClick={() => setPage((value) => value + 1)} className="font-bold text-[#0787df] disabled:opacity-40">{t("next")}</button>
          </nav>
        )}
      </section>

      {view === "history" && user?.role === "SUPERADMIN" && <HistoricalSettlementPanel />}
      {settling && <OsAccountsPanel initialBatchId={settling.id} initialHubId={settling.hubId} onPaymentClose={() => setSettling(null)} />}

      {showCreate&&<CreateBatchDialog shops={masters.data?.shops??[]} hubs={masters.data?.hubs??[]} onClose={()=>setShowCreate(false)}/>} 
    </div>
  );
}
