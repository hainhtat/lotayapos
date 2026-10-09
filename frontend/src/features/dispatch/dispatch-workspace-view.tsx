import { RefreshCw } from "lucide-react";
import { dispatchFiltersToSearch, emptyDispatchFilters } from "@/lib/dispatch-filters";
import { DispatchQueueTabs } from "./dispatch-queue-tabs";
import { DispatchQueuePanel } from "./dispatch-queue-panel";
import { DispatchDialogs } from "./dispatch-dialogs";
const emptyFilters=emptyDispatchFilters;
const control =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
import type { useDispatchController } from "./use-dispatch-controller";

export function DispatchWorkspaceView({ model, workspace = "dispatch" }: { model: ReturnType<typeof useDispatchController>; workspace?: "dispatch" | "returns" }) {
  const { t, user, setSearchParams, filters, setFilters, setPage, selected, setSelected, setReturnOpen, parcels, overdueUnsent, batches, masters, reasons, confirmReturns } = model;
  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">{t(workspace === "returns" ? "returnToOsWorkspace" : "dispatchQueue")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t(workspace === "returns" ? "returnToOsWorkspaceDescription" : "dispatchQueueDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void parcels.refetch();
            void batches.refetch();
            void overdueUnsent.refetch();
            void masters.refetch();
            void reasons.refetch();
          }}
          className={`${control} flex items-center gap-2 font-bold`}
        >
          <RefreshCw size={14} />
          {t("refresh")}
        </button>
      </div>

      {workspace === "dispatch" && <DispatchQueueTabs activeQueue={filters.queue} onChange={(value) => { setPage(1); setSelected([]); const next = { ...emptyFilters, batchId: filters.batchId, showCompleted: filters.showCompleted, queue: value }; setFilters(next); setSearchParams(dispatchFiltersToSearch(next), { replace: true }); }} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER"].includes(user?.role ?? "") && (
          <button
            type="button"
            disabled={!selected.length || selected.length > 50}
            onClick={() => {
              confirmReturns.reset();
              setReturnOpen(true);
            }}
            className={`${control} font-bold disabled:opacity-40`}
          >
            {t("confirmReturnedToOs")}
          </button>
        )}
      </div>


      {(overdueUnsent.data?.total ?? 0) > 0 && (
        <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-amber-900 dark:text-amber-100">{t("overdueUnsentTitle")}</h2>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t("overdueUnsentDescription", { count: overdueUnsent.data?.total ?? 0 })}</p>
            </div>
            <button type="button" onClick={() => { setPage(1); setSelected([]); setFilters({ ...emptyFilters, queue: "overdue" }); setSearchParams({ queue: "overdue" }, { replace: true }); }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white">
              {t("showOverdueUnsent")}
            </button>
          </div>
        </section>
      )}

      <DispatchQueuePanel model={model} />
      <DispatchDialogs model={model} />
    </div>
  );
}
