import { ModalPortal } from "@/components/modal-portal";
import { X } from "lucide-react";
import type { useDispatchController } from "./use-dispatch-controller";
const control = "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#1598ef] focus:ring-2 focus:ring-[#1598ef]/20 dark:border-white/10 dark:bg-[#121416] dark:text-slate-100";
function money(value: number | null | undefined) { if (value == null) return "—"; return value.toLocaleString(); }
export function HandoverLinkDialogs({ model }: { model: ReturnType<typeof useDispatchController> }) {
  const { t, canPaidToOsHandover, selected, linkRiderId, setLinkRiderId, linkOpen, setLinkOpen, linkReason, setLinkReason, unlinkingGroupId, setUnlinkingGroupId, unlinkReason, setUnlinkReason, returnListOpen, setReturnListOpen, includePaidToOsHandover, setIncludePaidToOsHandover, paidToOsDateFrom, setPaidToOsDateFrom, paidToOsDateTo, setPaidToOsDateTo, paidToOsShopId, setPaidToOsShopId, paidToOsRiderId, setPaidToOsRiderId, masters, returnListEligible, returnListPreview, downloadReturnList, paidToOsListPreview, downloadPaidToOsList, link, unlink, riders } = model;
  return <>
      {returnListOpen && (
        <ModalPortal>
          <div role="dialog" aria-modal="true" aria-labelledby="return-list-title" className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4">
            <section className="my-6 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="return-list-title" className="font-display text-xl font-bold">{t("osReturnList")}</h2>
                  <p className="mt-1 text-sm text-slate-500">{t("osReturnListHelp")}</p>
                </div>
                <button type="button" aria-label={t("close")} onClick={() => setReturnListOpen(false)} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10">
                  <X size={18} />
                </button>
              </div>

              {canPaidToOsHandover && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-white/10">
                  <input
                    aria-label={t("includePaidToOsHandover")}
                    type="checkbox"
                    checked={includePaidToOsHandover}
                    onChange={(event) => setIncludePaidToOsHandover(event.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="block font-bold">{t("includePaidToOsHandover")}</span>
                    <span className="mt-1 block text-slate-500">{t("includePaidToOsHandoverHelp")}</span>
                  </span>
                </label>
              )}

              {!returnListEligible ? (
                <p className="mt-4 text-sm text-slate-500">{t("returnListNeedsSelection")}</p>
              ) : returnListPreview.isLoading ? (
                <p className="py-8 text-center">{t("loading")}</p>
              ) : returnListPreview.isError ? (
                <div className="py-8 text-center">
                  <p role="alert" className="text-rose-600">{t("returnListPreviewError")}</p>
                  <button type="button" onClick={() => void returnListPreview.refetch()} className="mt-3 text-sm font-bold text-sky-700">{t("retry")}</button>
                </div>
              ) : (
                <>
                  <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-950/50">
                    {t("returnListSummary", { count: returnListPreview.data?.parcelCount ?? 0, amount: money(returnListPreview.data?.totalCod ?? 0) })}
                  </p>
                  <div className="mt-4 max-h-64 overflow-auto rounded-xl border dark:border-white/10">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase text-slate-500">
                          <th className="p-3">{t("tracking")}</th>
                          <th className="p-3">{t("merchant")}</th>
                          <th className="p-3">{t("customer")}</th>
                          <th className="p-3">{t("status")}</th>
                          <th className="p-3">{t("reasonCode")}</th>
                          <th className="p-3 text-right">{t("cod")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnListPreview.data?.parcels.map((parcel) => (
                          <tr key={parcel.id ?? parcel.trackingNumber} className="border-b dark:border-white/10">
                            <td className="p-3 font-mono">{parcel.trackingNumber}</td>
                            <td className="p-3">{parcel.batch?.shop?.name ?? "—"}</td>
                            <td className="p-3">{parcel.customerName}</td>
                            <td className="p-3">{parcel.status?.replaceAll("_", " ") ?? "—"}</td>
                            <td className="p-3">{parcel.reasonCode ?? "—"}</td>
                            <td className="p-3 text-right">{money(parcel.codAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{t("returnListNoPostingHelp")}</p>
                </>
              )}

              {includePaidToOsHandover && canPaidToOsHandover && (
                <div className="mt-6 border-t border-slate-200 pt-5 dark:border-white/10">
                  <h3 className="font-display text-base font-bold">{t("paidToOsHandover")}</h3>
                  <p className="mt-1 text-sm text-slate-500">{t("paidToOsHandoverHelp")}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs font-bold text-slate-500">
                      {t("dateFrom")}
                      <input aria-label={t("dateFrom")} type="date" value={paidToOsDateFrom} onChange={(event) => setPaidToOsDateFrom(event.target.value)} className={`${control} mt-1 w-full`} />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      {t("dateTo")}
                      <input aria-label={t("dateTo")} type="date" value={paidToOsDateTo} onChange={(event) => setPaidToOsDateTo(event.target.value)} className={`${control} mt-1 w-full`} />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      {t("onlineShop")}
                      <select aria-label={t("onlineShop")} value={paidToOsShopId} onChange={(event) => setPaidToOsShopId(event.target.value)} className={`${control} mt-1 w-full`}>
                        <option value="">{t("all")}</option>
                        {masters.data?.shops?.map((shop) => (
                          <option key={shop.id} value={shop.id}>{shop.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      {t("rider")}
                      <select aria-label={t("rider")} value={paidToOsRiderId} onChange={(event) => setPaidToOsRiderId(event.target.value)} className={`${control} mt-1 w-full`}>
                        <option value="">{t("all")}</option>
                        {riders.map((rider) => (
                          <option key={rider.id} value={rider.id}>{rider.user.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {paidToOsListPreview.isLoading ? (
                    <p className="py-8 text-center">{t("loading")}</p>
                  ) : paidToOsListPreview.isError ? (
                    <div className="py-8 text-center">
                      <p role="alert" className="text-rose-600">{t("paidToOsHandoverPreviewError")}</p>
                      <button type="button" onClick={() => void paidToOsListPreview.refetch()} className="mt-3 text-sm font-bold text-sky-700">{t("retry")}</button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-950/50">
                        {t("paidToOsHandoverSummary", {
                          count: paidToOsListPreview.data?.parcelCount ?? 0,
                          cod: money(paidToOsListPreview.data?.totalCod ?? 0),
                          fees: money(paidToOsListPreview.data?.totalFees ?? 0),
                        })}
                      </p>
                      {(paidToOsListPreview.data?.parcelCount ?? 0) === 0 ? (
                        <p className="mt-4 py-6 text-center text-sm text-slate-500">{t("paidToOsHandoverEmpty")}</p>
                      ) : (
                        <div className="mt-4 max-h-64 space-y-3 overflow-auto">
                          {(paidToOsListPreview.data?.sections ?? []).map((section) => (
                            <div key={`${section.riderName}-${section.parcels[0]?.trackingNumber ?? "empty"}`} className="rounded-xl border dark:border-white/10">
                              <p className="border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-white/10">
                                {t("paidToOsHandoverSection", { rider: section.riderName, count: section.parcels.length })}
                              </p>
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b text-xs uppercase text-slate-500 dark:border-white/10">
                                    <th className="p-3">{t("tracking")}</th>
                                    <th className="p-3">{t("merchant")}</th>
                                    <th className="p-3">{t("customer")}</th>
                                    <th className="p-3 text-right">{t("cod")}</th>
                                    <th className="p-3 text-right">{t("fee")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.parcels.map((parcel) => (
                                    <tr key={parcel.id ?? parcel.trackingNumber} className="border-b dark:border-white/10">
                                      <td className="p-3 font-mono">{parcel.trackingNumber}</td>
                                      <td className="p-3">{parcel.shopName ?? "—"}</td>
                                      <td className="p-3">{parcel.customerName}</td>
                                      <td className="p-3 text-right">{money(parcel.codAmount)}</td>
                                      <td className="p-3 text-right">{money(parcel.paidToOsFeeIncluded ? parcel.deliveryFee ?? 0 : 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-3 text-xs text-slate-500">{t("paidToOsHandoverNoPostingHelp")}</p>
                    </>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setReturnListOpen(false)} className={control}>{t("close")}</button>
                {returnListEligible && (
                  <button
                    type="button"
                    disabled={downloadReturnList.isPending || !returnListPreview.data?.parcelCount}
                    onClick={() => downloadReturnList.mutate()}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {t(downloadReturnList.isPending ? "loading" : "downloadReturnPdf")}
                  </button>
                )}
                {includePaidToOsHandover && canPaidToOsHandover && (
                  <button
                    type="button"
                    disabled={downloadPaidToOsList.isPending || !paidToOsListPreview.data?.parcelCount}
                    onClick={() => downloadPaidToOsList.mutate()}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {t(downloadPaidToOsList.isPending ? "loading" : "downloadPaidToOsPdf")}
                  </button>
                )}
              </div>
            </section>
          </div>
        </ModalPortal>
      )}
      {linkOpen && <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"><form aria-label={t("linkParcels")} onSubmit={e=>{e.preventDefault();link.mutate()}} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"><button type="button" aria-label={t("close")} onClick={()=>setLinkOpen(false)} className="absolute right-4 top-4 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18}/></button><h2 className="text-xl font-bold">{t("linkParcels")}</h2><p className="mt-2 text-sm text-slate-500">{t("linkParcelsExplanation",{count:selected.length})}</p><label className="mt-4 block text-xs font-bold">{t("responsibleRider")}<select aria-label={t("responsibleRider")} value={linkRiderId} onChange={e=>setLinkRiderId(e.target.value)} className={`${control} mt-1 w-full`}><option value="">{t("selectRider")}</option>{riders.map(r=><option key={r.id} value={r.id}>{r.user.name}</option>)}</select></label><label className="mt-4 block text-xs font-bold">{t("reason")}<textarea aria-label={t("linkReason")} required minLength={3} value={linkReason} onChange={e=>setLinkReason(e.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setLinkOpen(false)} className={control}>{t("cancel")}</button><button disabled={link.isPending||!linkRiderId||linkReason.trim().length<3} className="rounded-xl bg-[#1598ef] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t("confirmLink")}</button></div></form></div></ModalPortal>}
      {unlinkingGroupId && <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"><form aria-label={t("unlinkParcels")} onSubmit={e=>{e.preventDefault();unlink.mutate()}} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-[#181a1d]"><h2 className="text-xl font-bold">{t("unlinkParcels")}</h2><p className="mt-2 text-sm text-slate-500">{t("unlinkParcelsExplanation")}</p><label className="mt-4 block text-xs font-bold">{t("reason")}<textarea aria-label={t("unlinkReason")} required minLength={3} value={unlinkReason} onChange={e=>setUnlinkReason(e.target.value)} className={`${control} mt-1 w-full`}/></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setUnlinkingGroupId(null)} className={control}>{t("cancel")}</button><button disabled={unlink.isPending||unlinkReason.trim().length<3} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{t("confirmUnlink")}</button></div></form></div></ModalPortal>}

  </>;
}
