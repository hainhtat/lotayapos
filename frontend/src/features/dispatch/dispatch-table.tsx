import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, UserRoundPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ParcelDetailsButton } from "@/components/parcel-details";
import { isDateChangeReason } from "@/lib/exception-reasons";
import type { Parcel, MasterData } from "./dispatch-types";

const ALL_STATUSES = [
  "CREATED",
  "PICKED_UP",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "REJECTED",
  "PENDING_RETURN",
  "RETURNED",
] as const;
const fieldEditableStatuses = new Set(["CREATED", "PICKED_UP", "ASSIGNED"]);

const control =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
const controlSm = `${control} py-1`;

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return value.toLocaleString();
}

function statusLabel(t: (key: string) => string, status: string) {
  if (status === "ASSIGNED") return t("assignedAwaitingHandover");
  if (status === "OUT_FOR_DELIVERY") return t("outForDeliveryWithRider");
  return status.replaceAll("_", " ");
}

function formatPickupDate(parcel: Parcel) {
  if (parcel.batch.pickupDate) {
    const date = new Date(parcel.batch.pickupDate);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
  }
  return parcel.batch.label;
}

type Props = {
  visible: Parcel[]; selected: string[]; allSelected: boolean; canDispatchEdit: boolean;
  riders: MasterData["riders"]; riderPending: boolean; statusPending: boolean;
  correctRiderPending: boolean; paidToOsPending: boolean;
  sortBy: string; sortDirection: string; onSort: (key: string) => void;
  canVoid: boolean; onVoid: (parcel: Parcel) => void;
  onToggleAll: () => void; onToggleOne: (id: string) => void;
  onRiderChange: (parcel: Parcel, riderId: string) => void;
  onStatusChange: (parcel: Parcel, status: string) => void;
  onHistory: (parcel: Parcel) => void; onCorrectRider: (parcel: Parcel) => void;
  onPaidToOs: (parcel: Parcel) => void; onEdit: (parcel: Parcel) => void;
};
export function DispatchTable({ visible, selected, allSelected, canDispatchEdit, riders, riderPending, statusPending, correctRiderPending, paidToOsPending, sortBy, sortDirection, onSort, canVoid, onVoid, onToggleAll, onToggleOne, onRiderChange, onStatusChange, onHistory, onCorrectRider, onPaidToOs, onEdit }: Props) {
  const { t } = useTranslation();
  // Keep the API's page and filter boundary, but put members already visible on
  // this page next to the first member. Never imply the entire group is loaded.
  const shownGroupIds = new Set<string>();
  const displayed = visible.flatMap((parcel) => {
    const groupId = parcel.linkGroup?.id;
    if (!groupId) return [parcel];
    if (shownGroupIds.has(groupId)) return [];
    shownGroupIds.add(groupId);
    return visible.filter((member) => member.linkGroup?.id === groupId);
  });
  const visibleGroupCounts = new Map<string, number>();
  for (const parcel of visible) if (parcel.linkGroup) visibleGroupCounts.set(parcel.linkGroup.id, (visibleGroupCounts.get(parcel.linkGroup.id) ?? 0) + 1);
  const grouped = visibleGroupCounts.size > 0;
  const sortable = (key: string, label: string, right = false) => (
    <th scope="col" aria-sort={!grouped && sortBy === key ? (sortDirection === "desc" ? "descending" : "ascending") : "none"} className={`py-2 pr-2 ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => onSort(key)} className={`inline-flex items-center gap-1 rounded-sm hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:text-slate-100 ${right ? "ml-auto" : ""}`}>
        {label}{sortBy === key ? (sortDirection === "desc" ? <ArrowDown aria-hidden="true" size={12} /> : <ArrowUp aria-hidden="true" size={12} />) : <ArrowUpDown aria-hidden="true" size={12} />}
      </button>
    </th>
  );
  return (
          <div className="mt-3 overflow-x-auto">
            {visibleGroupCounts.size > 0 && <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">{t("linkedGroupPageOnly")} {t("linkedGroupConfiguredFeeHelp")}</p>}
            <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400 dark:border-white/10">
                  <th className="py-2 pl-5 pr-2">
                    <input aria-label={t("selectAll")} type="checkbox" checked={allSelected} onChange={onToggleAll} />
                  </th>
                  <th className="py-2 pr-2">#</th>
                  {sortable("orderId", t("orderId"))}
                  {sortable("trackingNumber", t("tracking"))}
                  {sortable("pickupDate", t("pickupDate"))}
                  {sortable("shopName", t("merchant"))}
                  {sortable("customerName", t("customer"))}
                  {sortable("township", t("township"))}
                  {sortable("deliveryFee", t("fee"), true)}
                  {sortable("codAmount", t("cod"), true)}
                  <th className="py-2 pr-2 text-right">{t("total")}</th>
                  {sortable("riderName", t("rider"))}
                  {sortable("status", t("status"))}
                  <th className="py-2 text-right">{t("edit")}</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((p, index) => {
                  const fee = p.deliveryFee ?? 0;
                  const total = p.codAmount + fee;
                  const canEditFields = fieldEditableStatuses.has(p.status) && !p.linkGroup;
                  const canCorrectRider = p.status === "DELIVERED" && Boolean(p.rider?.id) && !p.linkGroup;
                  const groupId = p.linkGroup?.id;
                  const previousInGroup = Boolean(groupId && index > 0 && displayed[index - 1]?.linkGroup?.id === groupId);
                  const nextInGroup = Boolean(groupId && index + 1 < displayed.length && displayed[index + 1]?.linkGroup?.id === groupId);
                  const showBracket = Boolean(groupId && (previousInGroup || nextInGroup));
  return (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/80 dark:border-white/5 dark:hover:bg-white/[0.03]">
                      <td className="relative py-1.5 pl-5 pr-2">
                        {showBracket && (
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute inset-y-0 left-0 w-3 border-l-[3px] border-slate-900 dark:border-slate-100 ${!previousInGroup ? "rounded-tl-md border-t-[3px]" : ""} ${!nextInGroup ? "rounded-bl-md border-b-[3px]" : ""}`}
                          />
                        )}
                        <input
                          aria-label={`${t("select")} ${p.trackingNumber}`}
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => onToggleOne(p.id)}
                        />
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-400">{index + 1}</td>
                      <td className="py-1.5 pr-2">
                        <p className="font-bold text-[#0787df] dark:text-[#5eb8ff]"><ParcelDetailsButton id={p.id} trackingNumber={p.trackingNumber}>{p.orderId?.trim() || p.trackingNumber}</ParcelDetailsButton></p>
                        {groupId && !previousInGroup && <p className="mt-0.5 text-[10px] font-semibold leading-tight text-sky-700 dark:text-sky-300" title={t("linkedGroupPageOnly")}>{t("linkedGroupVisibleCount", { count: visibleGroupCounts.get(groupId) ?? 1 })} · {t("linkedGroupTotalFee", { amount: money(p.linkGroup?.totalDeliveryFee) })}</p>}
                      </td>
                      <td className="py-1.5 pr-2">
                        {p.orderId?.trim() && <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{p.trackingNumber}</p>}
                        {isDateChangeReason(p.reasonCode) ? (
                          <p role="alert" className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {t("dateChangeAlert")}
                            {p.plannedDeliveryDate && <span className="block">{t("plannedDeliveryDate")}: {p.plannedDeliveryDate.slice(0, 10)}</span>}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatPickupDate(p)}</td>
                      <td className="py-1.5 pr-2 font-semibold">{p.batch.shop.name}</td>
                      <td className="py-1.5 pr-2">{p.customerName}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{p.township || "—"}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{p.linkGroup ? <span title={`${t("linkedGroupConfiguredFee")}: ${money(p.deliveryFee)} MMK`}>—</span> : money(p.deliveryFee)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{money(p.codAmount)}</td>
                      <td className="py-1.5 pr-2 text-right font-bold tabular-nums text-[#0787df]">{p.linkGroup ? "—" : money(total)}</td>
                      <td className="py-1.5 pr-2">
                        <select
                          aria-label={`${t("rider")} ${p.trackingNumber}`}
                          value={p.rider?.id ?? ""}
                          disabled={!canDispatchEdit || riderPending}
                          title={p.status === "DELIVERED" ? t("correctRider") : undefined}
                          onChange={(e) => void onRiderChange(p, e.target.value)}
                          className={`${controlSm} max-w-[140px]`}
                        >
                          <option value="">{t("unassigned")}</option>
                          {riders.map((rider) => (
                            <option key={rider.id} value={rider.id}>
                              {rider.user.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select
                          aria-label={`${t("status")} ${p.trackingNumber}`}
                          value={p.status}
                          disabled={!canDispatchEdit || statusPending}
                          onChange={(e) => onStatusChange(p, e.target.value)}
                          className={`${controlSm} max-w-[150px]`}
                        >
                          {ALL_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(t, status)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" aria-label={`${t("viewFieldHistory")} ${p.trackingNumber}`} onClick={()=>onHistory(p)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-white/15 dark:text-slate-300">{t("history")}</button>
                          {canVoid && p.status === "CREATED" && !p.rider?.id && !p.linkGroup && p.batch.id && <button type="button" aria-label={t("parcelVoidActionName", { tracking: p.trackingNumber })} onClick={() => onVoid(p)} className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-bold text-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 dark:border-rose-800 dark:text-rose-300">{t("parcelVoidAction")}</button>}
                          {canCorrectRider ? (
                            <button
                              type="button"
                              aria-label={`${t("correctRider")} ${p.trackingNumber}`}
                              disabled={!canDispatchEdit || correctRiderPending}
                              title={t("correctRider")}
                              onClick={() => {
                                onCorrectRider(p);
                              }}
                              className="rounded-md border border-amber-500 px-2 py-1 text-[11px] font-bold text-amber-700 disabled:opacity-40 dark:text-amber-300"
                            >
                              <UserRoundPen size={12} className="mr-1 inline" />
                              {t("correctRider")}
                            </button>
                          ) : null}
                          {p.status === "DELIVERED" && p.linkGroup && p.collectionMode !== "PAID_BY_OS" ? (
                            <button
                              type="button"
                              aria-label={`${t("deliveredPaidToOs")} ${p.trackingNumber}`}
                              disabled={!canDispatchEdit || paidToOsPending}
                              onClick={() => { onPaidToOs(p); }}
                              className="rounded-md border border-sky-500 px-2 py-1 text-[11px] font-bold text-sky-700 disabled:opacity-40 dark:text-sky-300"
                            >
                              {t("deliveredPaidToOs")}
                            </button>
                          ) : null}
                          <button
                          type="button"
                          aria-label={`${t("editParcel")} ${p.trackingNumber}`}
                          disabled={!canDispatchEdit}
                          title={
                            !canDispatchEdit
                              ? t("parcelEditForbidden")
                              : !canEditFields
                                ? p.linkGroup
                                ? t("selectedParcelsNotLinkable")
                                : t("parcelEditDisabled")
                              : t("editParcel")
                          }
                          onClick={() => {
                            if (!canDispatchEdit) return;
                            onEdit(p);
                          }}
                          className="rounded-md border border-[#1598ef] px-2 py-1 text-[11px] font-bold text-[#0787df] disabled:opacity-40"
                        >
                          <Pencil size={12} className="mr-1 inline" />
                          {t("edit")}
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
  );
}
