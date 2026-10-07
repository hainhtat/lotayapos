import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SavedParcel } from "./batch-detail-types";

const SAVED_PARCELS_PAGE_SIZE = 50;
export function ParcelTable({ parcels, finalized, canVoidParcel, onHistory, onEdit, onVoid }: { parcels: SavedParcel[]; finalized: boolean; canVoidParcel: boolean; onHistory: (parcel: SavedParcel) => void; onEdit: (parcel: SavedParcel) => void; onVoid: (parcel: SavedParcel) => void }) {
  const { t } = useTranslation();
  const [savedPage, setSavedPage] = useState(1);
  const savedPageCount = Math.max(1, Math.ceil(parcels.length / SAVED_PARCELS_PAGE_SIZE));
  const pagedSavedParcels = parcels.slice((savedPage - 1) * SAVED_PARCELS_PAGE_SIZE, savedPage * SAVED_PARCELS_PAGE_SIZE);
  useEffect(() => { setSavedPage(1); }, [parcels.length]);
  useEffect(() => { if (savedPage > savedPageCount) setSavedPage(savedPageCount); }, [savedPage, savedPageCount]);
  if (!parcels.length) return null;
  return (
        <section className="mt-8 rounded-2xl border bg-white p-6 dark:border-white/10 dark:bg-[#181a1d]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">{t("savedParcelList")}</h2>
            {parcels.length > SAVED_PARCELS_PAGE_SIZE && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">{t("savedParcelsPage", { page: savedPage, total: savedPageCount })}</span>
                <button
                  type="button"
                  disabled={savedPage <= 1}
                  onClick={() => setSavedPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border px-3 py-1 font-bold disabled:opacity-40"
                >
                  {t("previous")}
                </button>
                <button
                  type="button"
                  disabled={savedPage >= savedPageCount}
                  onClick={() => setSavedPage((page) => Math.min(savedPageCount, page + 1))}
                  className="rounded-lg border px-3 py-1 font-bold disabled:opacity-40"
                >
                  {t("next")}
                </button>
              </div>
            )}
          </div>
          {canVoidParcel && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t("parcelVoidEligibilityNote")}</p>}
          <div className="mt-4 overflow-x-auto rounded-xl border dark:border-white/10">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-white/10 dark:bg-white/5">
                  <th scope="col" className="px-3 py-3 whitespace-nowrap">{t("tracking")}</th>
                  <th scope="col" className="px-3 py-3 whitespace-nowrap">{t("orderId")}</th>
                  <th scope="col" className="min-w-40 px-3 py-3">{t("customer")}</th>
                  <th scope="col" className="min-w-32 px-3 py-3">{t("township")}</th>
                  <th scope="col" className="px-3 py-3 text-right whitespace-nowrap">{t("cod")}</th>
                  <th scope="col" className="px-3 py-3 text-right whitespace-nowrap">{t("deliveryFee")}</th>
                  <th scope="col" className="px-3 py-3 whitespace-nowrap">{t("status")}</th>
                  <th scope="col" className="px-3 py-3 text-right">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedSavedParcels.map((parcel) => (
                  <tr key={parcel.id} className="border-b last:border-b-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5">
                    <td className="px-3 py-3 font-bold whitespace-nowrap">{parcel.trackingNumber}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{parcel.orderId || "—"}</td>
                    <td className="max-w-48 truncate px-3 py-3" title={parcel.customerName}>{parcel.customerName}</td>
                    <td className="max-w-40 truncate px-3 py-3" title={parcel.townshipRelation?.nameEn || ""}>{parcel.townshipRelation?.nameEn || "—"}</td>
                    <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{parcel.codAmount.toLocaleString()} MMK</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{(parcel.deliveryFee ?? 0).toLocaleString()} MMK</td>
                    <td className="px-3 py-3 whitespace-nowrap"><span className={parcel.status === "VOIDED" ? "rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300" : "rounded-full bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 dark:bg-sky-950/40 dark:text-sky-200"}>{parcel.status === "VOIDED" ? t("parcelVoidedStatus") : parcel.status}</span></td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button aria-label={`${t("viewFieldHistory")} ${parcel.trackingNumber}`} onClick={()=>onHistory(parcel)} className="mr-1 rounded-lg border px-2 py-1 text-xs font-bold text-slate-600 dark:text-slate-300">{t("history")}</button>
                      {!finalized && ["CREATED", "PICKED_UP", "ASSIGNED"].includes(parcel.status) && (
                        <button aria-label={`${t("editParcel")} ${parcel.trackingNumber}`} onClick={() => onEdit(parcel)} className="rounded-lg border px-2 py-1 text-xs font-bold text-[#0787df]">
                          <Pencil size={14} className="mr-1 inline" />
                          {t("editParcel")}
                        </button>
                      )}
                      {canVoidParcel && parcel.status === "CREATED" && !parcel.linkGroupId && !parcel.linkGroup && <button type="button" aria-label={t("parcelVoidActionName", { tracking: parcel.trackingNumber })} onClick={() => onVoid(parcel)} className="ml-1 rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30">{t("parcelVoidAction")}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
  );
}
