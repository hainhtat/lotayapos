import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Package, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CreateBatchDialog } from "./create-batch-dialog";

type BatchSummary = {
  id: string;
  label: string;
  pickupDate: string;
  shop: { name: string };
  parcels: Array<{ status: string }>;
};
type Alert = { id: string; type: string; message: string; createdAt: string };

const control =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";

function batchStats(parcels: Array<{ status: string }>) {
  const total = parcels.length;
  const delivered = parcels.filter((parcel) => parcel.status === "DELIVERED").length;
  const pendingReturn = parcels.filter((parcel) => parcel.status === "PENDING_RETURN").length;
  const remaining = parcels.filter((parcel) => !["DELIVERED", "RETURNED"].includes(parcel.status)).length;
  return { total, delivered, pendingReturn, remaining };
}

export function BatchesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const masters = useQuery({ queryKey: ["master-data"], queryFn: () => api<{shops:Array<{id:string;name:string}>;hubs:Array<{id:string;name:string}>}>("/master-data").then((r) => r.data) });

  const batches = useQuery({
    queryKey: ["operations-batches"],
    queryFn: () => api<BatchSummary[]>("/operations/batches").then((r) => r.data),
  });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api<Alert[]>("/operations/alerts").then((r) => r.data),
  });

  useEffect(() => {
    if (location.hash !== "#alerts") return;
    const node = document.getElementById("alerts");
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, alerts.isFetched]);

  const acknowledge = useMutation({
    mutationFn: (alertId: string) => api(`/operations/alerts/${alertId}/acknowledge`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const activeBatchId = new URLSearchParams(window.location.search).get("batchId") ?? "";

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t("allBatches")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("allBatchesDescription")}</p>
        </div>
        <div className="flex gap-2"><button type="button" onClick={() => { void batches.refetch(); void alerts.refetch(); }} className={`${control} flex items-center gap-2 font-bold`}><RefreshCw size={14}/>{t("refresh")}</button><button type="button" onClick={()=>setShowCreate(true)} className="flex items-center gap-2 rounded-md bg-[#1598ef] px-3 py-2 text-xs font-bold text-white"><Plus size={14}/>{t("createNewBatch")}</button></div>
      </div>

      <section className="mt-5 rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">{t("allBatches")}</h2>
            <p className="text-xs text-slate-500">{t("allBatchesDescription")}</p>
          </div>
          <span className="rounded-full bg-[#eaf6ff] px-2.5 py-0.5 text-[11px] font-bold text-[#0787df] dark:bg-[#1598ef]/15">
            {(batches.data ?? []).length} {t("batches")}
          </span>
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
        ) : !(batches.data ?? []).length ? (
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
                  <th className="py-2 text-right">{t("open")}</th>
                </tr>
              </thead>
              <tbody>
                {(batches.data ?? []).map((batch) => {
                  const stats = batchStats(batch.parcels);
                  const active = activeBatchId === batch.id;
                  return (
                    <tr
                      key={batch.id}
                      className={`border-b border-slate-100 dark:border-white/5 ${active ? "bg-[#eaf6ff]/70 dark:bg-[#1598ef]/10" : "hover:bg-slate-50/80 dark:hover:bg-white/[0.03]"}`}
                    >
                      <td className="py-2 pr-2 font-bold">{batch.label}</td>
                      <td className="py-2 pr-2">{batch.shop.name}</td>
                      <td className="py-2 pr-2 whitespace-nowrap text-slate-500">{new Date(batch.pickupDate).toLocaleDateString()}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{stats.total}</td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums text-[#0787df]">{stats.remaining}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-[#12a66a]">{stats.delivered}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-amber-600">{stats.pendingReturn}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-[#1598ef] px-2 py-1 text-[11px] font-bold text-[#0787df]"
                            onClick={() =>
                              navigate(active ? "/operations/dispatch" : `/operations/dispatch?batchId=${batch.id}`)
                            }
                          >
                            {active ? t("clearFilters") : t("filterBatch")}
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
      </section>

      <section
        id="alerts"
        className="mt-5 rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#181a1d]"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff6e5] text-[#db8d00]">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className="font-display text-base font-bold">{t("alerts")}</h2>
            <p className="text-xs text-slate-500">{t("alertsDescription")}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {alerts.isLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">{t("loading")}</p>
          ) : alerts.isError ? (
            <p className="py-6 text-center text-sm text-rose-500">{t("loadError")}</p>
          ) : (
            (alerts.data ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-[#ffe8b5] bg-[#fffaf0] p-3 dark:border-[#654d20] dark:bg-[#2b2416]"
              >
                <div>
                  <p className="text-sm font-semibold">{a.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate(a.id)}
                  className="rounded-lg border border-[#db8d00] px-3 py-1.5 text-xs font-bold text-[#a96c00] disabled:opacity-50"
                >
                  {t("acknowledge")}
                </button>
              </div>
            ))
          )}
          {!alerts.isLoading && !alerts.isError && !alerts.data?.length && (
            <div className="grid place-items-center py-6 text-center">
              <Package size={24} className="text-[#12a66a]" />
              <p className="mt-3 text-sm text-slate-500">{t("allClear")}</p>
            </div>
          )}
        </div>
      </section>
      {showCreate&&<CreateBatchDialog shops={masters.data?.shops??[]} hubs={masters.data?.hubs??[]} onClose={()=>setShowCreate(false)}/>} 
    </div>
  );
}
