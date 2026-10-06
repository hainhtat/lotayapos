import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { ModalPortal } from "@/components/modal-portal";

type ParcelDetail = {
  id: string;
  trackingNumber: string;
  orderId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string;
  township: string | null;
  status: string;
  reasonCode: string | null;
  codAmount: number;
  deliveryFee: number | null;
  collectionMode: string;
  paidToOsFeeIncluded: boolean;
  actualCodCollected: number | null;
  batch: { label: string; shop: { name: string } };
  rider: { user: { name: string } } | null;
  statusHistory: Array<{ id: string; fromStatus: string | null; toStatus: string; reasonCode: string | null; note: string | null; createdAt: string }>;
};

function isParcelDetail(value: unknown): value is ParcelDetail {
  if (!value || typeof value !== "object") return false;
  const parcel = value as Partial<ParcelDetail>;
  return typeof parcel.id === "string" && typeof parcel.trackingNumber === "string" && typeof parcel.status === "string"
    && typeof parcel.collectionMode === "string" && typeof parcel.codAmount === "number"
    && typeof parcel.customerName === "string" && typeof parcel.address === "string"
    && typeof parcel.batch?.label === "string" && typeof parcel.batch?.shop?.name === "string"
    && Array.isArray(parcel.statusHistory)
    && parcel.statusHistory.every((row) => row && typeof row.id === "string" && typeof row.toStatus === "string" && typeof row.createdAt === "string");
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value === null || value === undefined || value === "" ? "—" : value}</dd></div>;
}

function ParcelDetailsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const detail = useQuery({ queryKey: ["parcel-detail", id], queryFn: async () => {
    const result = await api<unknown>(`/parcels/${encodeURIComponent(id)}`);
    if (!isParcelDetail(result.data)) throw new Error("Invalid parcel detail response");
    return result.data;
  } });
  useEffect(() => {
    closeRef.current?.focus();
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert;
    if (appRoot) appRoot.inert = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); if (appRoot) appRoot.inert = wasInert ?? false; };
  }, [onClose]);
  const parcel = detail.data;
  const formatDate = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage === "my" ? "my-MM" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const money = (value: number | null | undefined) => `${(value ?? 0).toLocaleString()} MMK`;
  const statusText = (status: string) => status === "VOIDED" ? t("parcelVoidedStatus") : t(`parcelStatus_${status}`, { defaultValue: status.replaceAll("_", " ") });

  return <ModalPortal><div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="parcel-details-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-950 shadow-2xl dark:bg-[#181a1d] dark:text-white sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><h2 id="parcel-details-title" className="font-display text-xl font-bold">{t("parcelDetails")}</h2><p className="mt-1 font-mono text-sm text-slate-500">{parcel?.trackingNumber ?? t("loading")}</p></div><button ref={closeRef} type="button" aria-label={t("close")} onClick={onClose} className="rounded-lg border border-slate-200 p-2 dark:border-white/10"><X size={18}/></button></div>
      {detail.isLoading ? <p className="py-10 text-center text-sm">{t("loading")}</p> : detail.isError || !parcel ? <div className="py-10 text-center"><p role="alert" className="text-sm text-rose-600">{t("loadError")}</p><button type="button" onClick={() => void detail.refetch()} className="mt-2 text-sm font-bold text-sky-600">{t("retry")}</button></div> : <>
        <dl className="mt-6 grid gap-4 rounded-xl bg-slate-50 p-4 dark:bg-white/5 sm:grid-cols-2"><Detail label={t("orderId")} value={parcel.orderId}/><Detail label={t("status")} value={statusText(parcel.status)}/><Detail label={t("customer")} value={parcel.customerName}/><Detail label={t("customerPhone")} value={parcel.customerPhone}/><Detail label={t("address")} value={parcel.address}/><Detail label={t("township")} value={parcel.township}/><Detail label={t("batch")} value={parcel.batch.label}/><Detail label={t("onlineShop")} value={parcel.batch.shop.name}/><Detail label={t("rider")} value={parcel.rider?.user.name}/></dl>
        <dl className="mt-4 grid gap-4 rounded-xl border border-slate-200 p-4 dark:border-white/10 sm:grid-cols-3"><Detail label={t("cod")} value={money(parcel.codAmount)}/><Detail label={t("deliveryFee")} value={money(parcel.deliveryFee)}/><Detail label={t("total")} value={money(parcel.codAmount + (parcel.deliveryFee ?? 0))}/><Detail label={t("collectionMode")} value={t(`collectionMode_${parcel.collectionMode}`, { defaultValue: parcel.collectionMode.replaceAll("_", " ") })}/><Detail label={t("actualCodCollected")} value={parcel.actualCodCollected == null ? null : money(parcel.actualCodCollected)}/>{parcel.collectionMode === "PAID_BY_OS" && <Detail label={t("feeIncludedInOsCredit")} value={parcel.paidToOsFeeIncluded ? t("yes") : t("no")}/>}<Detail label={t("reason")} value={parcel.reasonCode === "ENTERED_IN_ERROR" ? t("parcelEnteredInErrorReason") : parcel.reasonCode}/></dl>
        <h3 className="mt-6 font-display text-base font-bold">{t("statusHistory")}</h3>
        {!parcel.statusHistory.length ? <p className="mt-2 text-sm text-slate-500">{t("empty")}</p> : <ol className="mt-3 space-y-2">{parcel.statusHistory.map((row) => <li key={row.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-white/10"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{row.fromStatus ? `${statusText(row.fromStatus)} → ` : ""}{statusText(row.toStatus)}</span><time className="text-xs text-slate-500" dateTime={row.createdAt}>{formatDate(row.createdAt)}</time></div>{row.reasonCode && <p className="mt-1 text-slate-600 dark:text-slate-300">{t("reason")}: {row.reasonCode}</p>}{row.note && <p className="mt-1 break-words text-slate-600 dark:text-slate-300">{row.note}</p>}</li>)}</ol>}
      </>}
    </section>
  </div></ModalPortal>;
}

export function ParcelDetailsButton({ id, trackingNumber, children }: { id: string; trackingNumber: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); };
  return <><button ref={triggerRef} type="button" aria-label={`${t("viewParcelDetails")} ${trackingNumber}`} onClick={() => setOpen(true)} className="rounded-sm text-left font-semibold text-sky-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-300">{children ?? trackingNumber}</button>{open && <ParcelDetailsModal id={id} onClose={close}/>}</>;
}
