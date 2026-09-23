import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "@/components/modal-portal";
import { useAuth } from "@/app/auth";
import { ApiError, api, apiRaw } from "@/lib/api";
import { hubBusinessDate } from "@/lib/business-date";
import { resolveManifestPdfFilename } from "@/lib/content-disposition";

type ReturnParcel = {
  id: string;
  trackingNumber: string;
  orderId?: string | null;
  customerName: string;
  status: string;
  codAmount: number;
  batch: { label: string; shop: { name: string } };
};

type PaidToOsPreview = {
  parcelCount: number;
  totalCod: number;
  totalFees: number;
  sections: Array<{
    riderName: string;
    parcels: Array<{
      id?: string;
      trackingNumber: string;
      customerName: string;
      shopName?: string | null;
      codAmount: number;
      deliveryFee?: number | null;
      paidToOsFeeIncluded?: boolean;
    }>;
  }>;
};

type MasterData = {
  shops?: Array<{ id: string; name: string }>;
  riders?: Array<{ id: string; user: { name: string } }>;
};

const control = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/10 dark:bg-[#121416]";
const money = (value: number) => `${value.toLocaleString()} MMK`;

export function ReturnToOsWorkspace() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(hubBusinessDate());
  const [dateTo, setDateTo] = useState(hubBusinessDate());
  const [shopId, setShopId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(hubBusinessDate());
  const [message, setMessage] = useState<string | null>(null);
  const returnRequest = useRef<string | null>(null);

  const returns = useQuery({
    queryKey: ["operations-return-queue"],
    queryFn: async () => {
      const response = await apiRaw("/parcels?queue=return-to-os&page=1&pageSize=100");
      const body = await response.json() as { data?: ReturnParcel[] | { items?: ReturnParcel[] } };
      if (Array.isArray(body.data)) return body.data;
      if (body.data && Array.isArray(body.data.items)) return body.data.items;
      throw new Error("INVALID_RETURN_QUEUE_RESPONSE");
    },
  });
  const masters = useQuery({
    queryKey: ["master-data"],
    queryFn: () => api<MasterData>("/master-data").then((result) => result.data),
  });
  const paidBody = useMemo(() => ({
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(shopId ? { shopId } : {}),
    ...(riderId ? { riderId } : {}),
  }), [dateFrom, dateTo, riderId, shopId]);
  const paidToOs = useQuery({
    queryKey: ["paid-to-os-handover-preview", paidBody],
    queryFn: () => api<PaidToOsPreview>("/operations/parcels/paid-to-os/preview", {
      method: "POST",
      body: JSON.stringify(paidBody),
    }).then((result) => result.data),
  });

  const download = useMutation({
    mutationFn: () => apiRaw("/operations/parcels/os-handover/pdf", {
      method: "POST",
      body: JSON.stringify({ parcelIds: selected, ...paidBody }),
    }),
    onSuccess: async (response) => {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = resolveManifestPdfFilename(response.headers.get("Content-Disposition"));
      link.click();
      URL.revokeObjectURL(url);
      setMessage(t("combinedOsHandoverDownloaded"));
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : t("loadError")),
  });

  const confirmReturns = useMutation({
    mutationFn: () => {
      returnRequest.current ??= JSON.stringify({ parcelIds: selected, businessDate: returnDate, idempotencyKey: `bulk-return-${crypto.randomUUID()}` });
      return api("/finance/os-returns/receive-bulk", { method: "POST", body: returnRequest.current });
    },
    onSuccess: async () => {
      returnRequest.current = null;
      setReturnOpen(false);
      setSelected([]);
      setMessage(t("osReturnReceived"));
      await Promise.all(["operations-return-queue", "os-accounts", "ledger", "dashboard"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) returnRequest.current = null;
    },
  });

  const physical = returns.data ?? [];
  const paidCount = paidToOs.data?.parcelCount ?? 0;
  const canConfirm = ["SUPERADMIN", "OPERATIONS_MANAGER", "FINANCE", "DISPATCHER"].includes(user?.role ?? "");
  const allPhysicalSelected = physical.length > 0 && physical.every((parcel) => selected.includes(parcel.id));

  return <div className="mx-auto max-w-[1500px]">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("returnToOsWorkspace")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("returnToOsFocusedDescription")}</p>
      </div>
      <button type="button" onClick={() => { void returns.refetch(); void paidToOs.refetch(); }} className={`${control} flex items-center gap-2 font-bold`}>
        <RefreshCw size={15}/>{t("refresh")}
      </button>
    </div>

    {message && <p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">{message}</p>}

    <section className="mt-5 rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{t("physicalReturnsToReport")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("physicalReturnsToReportHelp")}</p>
        </div>
        {canConfirm && <button type="button" disabled={!selected.length} onClick={() => { confirmReturns.reset(); setReturnOpen(true); }} className={`${control} font-bold disabled:opacity-40`}>{t("confirmReturnedToOs")}</button>}
      </div>
      {returns.isLoading ? <p className="py-8 text-center">{t("loading")}</p> : returns.isError ? <div role="alert" className="py-8 text-center text-sm text-rose-600">{returns.error instanceof ApiError ? returns.error.message : t("loadError")} <button type="button" onClick={() => void returns.refetch()} className="ml-2 underline">{t("retry")}</button></div> : physical.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("empty")}</p> :
        <div className="mt-4 overflow-x-auto rounded-xl border dark:border-white/10">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b bg-slate-50 text-xs uppercase text-slate-500 dark:border-white/10 dark:bg-white/5">
              <th className="p-3"><input type="checkbox" aria-label={t("selectAllPhysicalReturns")} checked={allPhysicalSelected} onChange={(event) => setSelected(event.target.checked ? physical.map((parcel) => parcel.id) : [])}/></th>
              <th className="p-3">{t("tracking")}</th><th className="p-3">{t("merchant")}</th><th className="p-3">{t("customer")}</th><th className="p-3">{t("status")}</th><th className="p-3 text-right">{t("cod")}</th>
            </tr></thead>
            <tbody>{physical.map((parcel) => <tr key={parcel.id} className="border-b dark:border-white/10">
              <td className="p-3"><input type="checkbox" aria-label={parcel.trackingNumber} checked={selected.includes(parcel.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, parcel.id] : current.filter((id) => id !== parcel.id))}/></td>
              <td className="p-3 font-mono font-bold">{parcel.trackingNumber}</td><td className="p-3">{parcel.batch.shop.name}</td><td className="p-3">{parcel.customerName}</td><td className="p-3">{parcel.status.replaceAll("_", " ")}</td><td className="p-3 text-right">{money(parcel.codAmount)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>

    <section className="mt-5 rounded-2xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1d]">
      <div><h2 className="font-display text-lg font-bold">{t("paidToOsToReport")}</h2><p className="mt-1 text-sm text-slate-500">{t("paidToOsToReportHelp")}</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-slate-500">{t("dateFrom")}<input aria-label={t("dateFrom")} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`${control} mt-1 w-full`}/></label>
        <label className="text-xs font-bold text-slate-500">{t("dateTo")}<input aria-label={t("dateTo")} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`${control} mt-1 w-full`}/></label>
        <label className="text-xs font-bold text-slate-500">{t("onlineShop")}<select aria-label={t("onlineShop")} value={shopId} onChange={(event) => setShopId(event.target.value)} className={`${control} mt-1 w-full`}><option value="">{t("all")}</option>{(Array.isArray(masters.data?.shops) ? masters.data.shops : []).map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-500">{t("rider")}<select aria-label={t("rider")} value={riderId} onChange={(event) => setRiderId(event.target.value)} className={`${control} mt-1 w-full`}><option value="">{t("all")}</option>{(Array.isArray(masters.data?.riders) ? masters.data.riders : []).map((rider) => <option key={rider.id} value={rider.id}>{rider.user.name}</option>)}</select></label>
      </div>
      <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-950/40">{t("paidToOsHandoverSummary", { count: paidCount, cod: (paidToOs.data?.totalCod ?? 0).toLocaleString(), fees: (paidToOs.data?.totalFees ?? 0).toLocaleString() })}</p>
      {paidToOs.isLoading ? <p className="py-8 text-center">{t("loading")}</p> : paidCount === 0 ? <p className="py-8 text-center text-sm text-slate-500">{t("paidToOsHandoverEmpty")}</p> :
        <div className="mt-4 max-h-96 overflow-auto rounded-xl border dark:border-white/10">
          <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs uppercase text-slate-500 dark:border-white/10 dark:bg-white/5"><th className="p-3">{t("rider")}</th><th className="p-3">{t("tracking")}</th><th className="p-3">{t("merchant")}</th><th className="p-3">{t("customer")}</th><th className="p-3 text-right">{t("cod")}</th><th className="p-3 text-right">{t("fee")}</th></tr></thead>
          <tbody>{paidToOs.data?.sections.flatMap((section) => section.parcels.map((parcel) => <tr key={parcel.id ?? parcel.trackingNumber} className="border-b dark:border-white/10"><td className="p-3">{section.riderName}</td><td className="p-3 font-mono font-bold">{parcel.trackingNumber}</td><td className="p-3">{parcel.shopName ?? "—"}</td><td className="p-3">{parcel.customerName}</td><td className="p-3 text-right">{money(parcel.codAmount)}</td><td className="p-3 text-right">{money(parcel.paidToOsFeeIncluded ? parcel.deliveryFee ?? 0 : 0)}</td></tr>))}</tbody></table>
        </div>}
    </section>

    <div className="sticky bottom-4 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-sky-900 dark:bg-[#181a1d]/95">
      <p className="text-sm"><strong>{selected.length}</strong> {t("physicalReturnsSelected")} · <strong>{paidCount}</strong> {t("paidToOsIncluded")}</p>
      <button type="button" disabled={download.isPending || (!selected.length && !paidCount)} onClick={() => download.mutate()} className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"><Download size={16}/>{t(download.isPending ? "loading" : "downloadCombinedOsHandover")}</button>
    </div>

    {returnOpen && <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"><form role="dialog" aria-modal="true" aria-labelledby="return-bulk-title" onSubmit={(event) => { event.preventDefault(); if (!confirmReturns.isPending) confirmReturns.mutate(); }} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-[#181a1d]"><button type="button" aria-label={t("close")} onClick={() => setReturnOpen(false)} className="absolute right-4 top-4 p-2"><X size={18}/></button><h2 id="return-bulk-title" className="text-xl font-bold">{t("confirmReturnedToOs")}</h2><p className="mt-3 text-sm text-slate-500">{t("confirmReturnedToOsHelp", { count: selected.length })}</p><label className="mt-4 block text-sm font-bold">{t("businessDate")}<input required type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} className={`${control} mt-1 w-full`}/></label>{confirmReturns.isError && <p role="alert" className="mt-3 text-sm text-rose-600">{confirmReturns.error instanceof Error ? confirmReturns.error.message : t("loadError")}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setReturnOpen(false)} className={control}>{t("cancel")}</button><button disabled={confirmReturns.isPending} className="rounded-lg bg-sky-600 px-4 py-2 font-bold text-white disabled:opacity-40">{t(confirmReturns.isPending ? "loading" : "confirmReturnedToOs")}</button></div></form></div></ModalPortal>}
  </div>;
}
