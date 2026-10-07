import { Download, Link2, Search, UserPlus } from "lucide-react";
import { emptyDispatchFilters as emptyFilters, type DispatchFilters as Filters } from "@/lib/dispatch-filters";
import { DispatchTable } from "./dispatch-table";
import type { useDispatchController } from "./use-dispatch-controller";

const ALL_STATUSES = ["CREATED", "PICKED_UP", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "PARTIAL", "FAILED", "REJECTED", "PENDING_RETURN", "RETURNED"] as const;
const control = "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
const controlSm = `${control} py-1`;
function statusLabel(t: (key: string) => string, status: string) {
  if (status === "ASSIGNED") return t("assignedAwaitingHandover");
  if (status === "OUT_FOR_DELIVERY") return t("outForDeliveryWithRider");
  return status.replaceAll("_", " ");
}
export function DispatchQueuePanel({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { t, user, searchParams, setSearchParams, canDispatchEdit, filters, setFilters, page, setPage, selected, riderId, setRiderId, setUnlinkingGroupId, bulkRiderId, setBulkRiderId, bulkStatus, setBulkStatus, bulkReasonCode, setBulkReasonCode, bulkOverrideNote, setBulkOverrideNote, setPaidToOs, setBulkDeliveryChoice, setIncludeDeliveryFee, setEditing, setVoiding, setHistoryParcel, setCorrectingRider, setCorrectRiderId, setCorrectReason, message, setRescheduleOpen, parcels, masters, batches, visible, pagination, reasonLabel, bulkReasons, reschedule, assign, reassignOne, correctRider, updateStatus, savePaidToOs, selectedParcels, linkValidation, unlinkGroupId, link, openLinkModal, unlink, applyRiderBulk, applyStatusBulk, setFilter, selectedAssignmentEligible, allSelected, toggleAll, toggleOne, openManifestModal, handleRiderChange, handleStatusChange, riders } = model;
  const sort = (key: string) => {
    const direction = filters.sortBy === key && filters.sortDirection !== "desc" ? "desc" : "asc";
    const next = { ...filters, sortBy: key, sortDirection: direction };
    setPage(1);
    setFilters(next);
    const params = new URLSearchParams(searchParams);
    params.set("sortBy", key);
    params.set("sortDirection", direction);
    setSearchParams(params, { replace: true });
  };
  return (
      <section className="mt-5 rounded-xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold">{t("dispatchQueue")}</h2>
            <p className="text-xs text-slate-500">{t("dispatchQueueDescription")}</p>
          </div>
          <span className="rounded-full bg-[#eaf6ff] px-2.5 py-0.5 text-[11px] font-bold text-[#0787df] dark:bg-[#1598ef]/15">
            {pagination
              ? t("showingOfTotal", { shown: visible.length, total: pagination.total })
              : `${visible.length} ${t("records")}`}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-10">
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("batch")}
            <select
              aria-label={t("batch")}
              value={filters.batchId}
              onChange={(e) => setFilter("batchId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {(batches.data ?? []).map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.label} · {batch.shop.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("tracking")}
            <input
              value={filters.trackingNumber}
              onChange={(e) => setFilter("trackingNumber", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("tracking")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("orderId")}
            <input
              value={filters.orderId}
              onChange={(e) => setFilter("orderId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("orderId")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("customer")}
            <input
              value={filters.customerName}
              onChange={(e) => setFilter("customerName", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("customer")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("shopName")}
            <select
              aria-label={t("shopName")}
              value={filters.shopId}
              onChange={(e) => setFilter("shopId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {masters.data?.shops?.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("rider")}
            <select
              aria-label={t("rider")}
              value={filters.riderId}
              onChange={(e) => setFilter("riderId", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("status")}
            <select
              aria-label={t("status")}
              value={filters.status}
              onChange={(e) => setFilter("status", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("township")}
            <input
              value={filters.township}
              onChange={(e) => setFilter("township", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
              placeholder={t("township")}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("assignmentStatus")}
            <select
              aria-label={t("assignmentStatus")}
              value={filters.assignmentStatus}
              onChange={(e) => setFilter("assignmentStatus", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("all")}</option>
              <option value="UNASSIGNED">{t("unassigned")}</option>
              <option value="ASSIGNED">{t("assigned")}</option>
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("dateFrom")}
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("dateTo")}
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            />
          </label>
        </div>
        {batches.isError && (
          <div className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            <p role="alert">{t("loadError")}</p>
            <button type="button" onClick={() => void batches.refetch()} className="mt-1 font-bold underline">
              {t("retry")}
            </button>
          </div>
        )}
        {masters.isError && (
          <div className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            <p role="alert">{t("loadError")}</p>
            <button type="button" onClick={() => void masters.refetch()} className="mt-1 font-bold underline">
              {t("retry")}
            </button>
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setPage(1);
              setFilters(emptyFilters);
              const next = new URLSearchParams(searchParams);
              (Object.keys(emptyFilters) as Array<keyof Filters>).forEach((key) => next.delete(key));
              setSearchParams(next, { replace: true });
            }}
            className={`${controlSm} font-bold`}
          >
            <Search size={12} className="mr-1 inline" />
            {t("clearFilters")}
          </button>
        </div>

        {canDispatchEdit && (
          <>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 dark:bg-white/5">
          <button type="button" disabled={!selected.length || selected.length > 50} onClick={() => { reschedule.reset(); setRescheduleOpen(true); }} className={`${control} font-bold disabled:opacity-40`}>{t("rescheduleParcels")}</button>
          <label className="min-w-[200px] flex-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {t("targetRiderId")}
            <select
              aria-label={t("targetRiderId")}
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              className={`${controlSm} mt-1 w-full`}
            >
              <option value="">{t("selectRider")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                  {rider.hub?.name ? ` · ${rider.hub.name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedAssignmentEligible || !riderId || assign.isPending}
            onClick={() => assign.mutate({ parcelIds: selected, riderId, dispatch: true })}
            className="rounded-md bg-[#1598ef] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <UserPlus size={14} className="mr-1 inline" />
            {assign.isPending ? t("loading") : `${t("assignAndDispatch")} (${selected.length})`}
          </button>
          <button
            type="button"
            onClick={openManifestModal}
            className="rounded-md border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df]"
          >
            <Download size={14} className="mr-1 inline" />
            {t("downloadManifest")}
          </button>
          <button
            type="button"
            disabled={Boolean(linkValidation) || selected.length !== selectedParcels.length || link.isPending}
            onClick={openLinkModal}
            className="rounded-md border border-[#1598ef] px-3 py-1.5 text-xs font-bold text-[#0787df] disabled:opacity-50"
          >
            <Link2 size={14} className="mr-1 inline" />
            {link.isPending ? t("loading") : `${t("linkParcels")} (${selectedParcels.length})`}
          </button>
          <button
            type="button"
            disabled={!unlinkGroupId || unlink.isPending}
            onClick={() => setUnlinkingGroupId(unlinkGroupId)}
            className="rounded-md border border-amber-500 px-3 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-50 dark:text-amber-300"
          >
            {t("unlinkParcels")}
          </button>
        </div>

        {selected.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#1598ef]/25 bg-[#eaf6ff]/40 px-2 py-1.5 dark:border-[#1598ef]/30 dark:bg-[#1598ef]/10">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#0787df]">
              {t("multiEdit")} · {selected.length}
            </span>
            <select
              aria-label={t("applyRider")}
              value={bulkRiderId}
              onChange={(e) => setBulkRiderId(e.target.value)}
              className={`${controlSm} min-w-[120px]`}
            >
              <option value="">{t("selectRider")}</option>
              {riders.map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.user.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkRiderId || applyRiderBulk.isPending}
              onClick={() => applyRiderBulk.mutate()}
              className="rounded-md bg-[#1598ef] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {applyRiderBulk.isPending ? t("loading") : t("applyRider")}
            </button>
            <span className="hidden h-4 w-px bg-slate-300 sm:block dark:bg-white/20" />
            <select
              aria-label={t("applyStatus")}
              value={bulkStatus}
              onChange={(e) => {
                setBulkStatus(e.target.value);
                setBulkReasonCode("");
              }}
              className={`${controlSm} min-w-[120px]`}
            >
              <option value="">{t("selectStatus")}</option>
              {ALL_STATUSES.filter((status) => status !== "PARTIAL").map((status) => (
                <option key={status} value={status}>
                  {statusLabel(t, status)}
                </option>
              ))}
            </select>
            {(bulkStatus === "FAILED" || bulkStatus === "REJECTED") && (
              <select
                aria-label={t("reasonCode")}
                value={bulkReasonCode}
                onChange={(e) => setBulkReasonCode(e.target.value)}
                className={`${controlSm} min-w-[120px]`}
              >
                <option value="">{t("selectReasonCode")}</option>
                {bulkReasons.map((reason) => (
                  <option key={reason.id} value={reason.code}>
                    {reasonLabel(reason)}
                  </option>
                ))}
              </select>
            )}
            {bulkStatus && (
              <input
                aria-label={t("overrideNote")}
                value={bulkOverrideNote}
                onChange={(e) => setBulkOverrideNote(e.target.value)}
                placeholder={t("overrideNotePlaceholder")}
                className={`${controlSm} min-w-[160px] flex-1`}
              />
            )}
            <button
              type="button"
              disabled={
                !bulkStatus ||
                bulkStatus === "PARTIAL" ||
                applyStatusBulk.isPending ||
                ((bulkStatus === "FAILED" || bulkStatus === "REJECTED") && !bulkReasonCode)
              }
              onClick={() => bulkStatus === "DELIVERED" ? setBulkDeliveryChoice(true) : applyStatusBulk.mutate(undefined)}
              className="rounded-md border border-[#1598ef] px-2.5 py-1 text-[11px] font-bold text-[#0787df] disabled:opacity-50"
            >
              {applyStatusBulk.isPending ? t("loading") : t("applyStatus")}
            </button>
          </div>
        )}
          </>
        )}

        {selected.length > 0 && linkValidation && (
          <p role="alert" className="mt-2 text-xs text-rose-500">
            {linkValidation}
          </p>
        )}
        {selected.length > 0 && !selectedAssignmentEligible && (
          <p className="mt-2 text-xs text-slate-500">{t("assignmentSelectionHint")}</p>
        )}
        {message && (
          <p role="status" className="mt-2 text-xs font-semibold text-[#0787df]">
            {message}
          </p>
        )}

        {parcels.isLoading ? (
          <p className="py-10 text-center text-sm text-slate-400">{t("loading")}</p>
        ) : parcels.isError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-rose-500">{t("loadError")}</p>
            <button type="button" onClick={() => void parcels.refetch()} className="mt-2 text-sm font-bold text-[#0787df]">
              {t("retry")}
            </button>
          </div>
        ) : !visible.length ? (
          <p className="py-10 text-center text-sm text-slate-400">{t("empty")}</p>
        ) : (
          <DispatchTable
            visible={visible} selected={selected} allSelected={allSelected} canDispatchEdit={canDispatchEdit}
            sortBy={filters.sortBy} sortDirection={filters.sortDirection} onSort={sort}
            canVoid={["SUPERADMIN", "OPERATIONS_MANAGER"].includes(user?.role ?? "")} onVoid={setVoiding}
            riders={riders} riderPending={assign.isPending || reassignOne.isPending || correctRider.isPending}
            statusPending={updateStatus.isPending} correctRiderPending={correctRider.isPending}
            paidToOsPending={savePaidToOs.isPending}
            onToggleAll={toggleAll} onToggleOne={toggleOne} onRiderChange={(p, id) => void handleRiderChange(p, id)}
            onStatusChange={handleStatusChange} onHistory={(p) => setHistoryParcel({ id: p.id, trackingNumber: p.trackingNumber })}
            onCorrectRider={(p) => { setCorrectingRider(p); setCorrectRiderId(""); setCorrectReason(""); }}
            onPaidToOs={(p) => { savePaidToOs.reset(); setIncludeDeliveryFee(false); setPaidToOs(p); }}
            onEdit={setEditing}
          />
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {t("pageOf", { page: pagination.page, total: pagination.totalPages })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || parcels.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`${controlSm} font-bold disabled:opacity-50`}
              >
                {t("previous")}
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages || parcels.isFetching}
                onClick={() => setPage((p) => p + 1)}
                className={`${controlSm} font-bold disabled:opacity-50`}
              >
                {t("next")}
              </button>
            </div>
          </div>
        )}
      </section>

  );
}
