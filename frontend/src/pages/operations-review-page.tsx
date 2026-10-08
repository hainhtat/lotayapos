import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { api, type ApiPagination } from "@/lib/api";
import { ParcelDetailsButton } from "@/components/parcel-details";
import { OperationsReturnQueue } from "./operations-return-queue";
import { AlertItem } from "@/features/operations-review/alert-item";
import { useOperationsAlerts } from "@/features/operations-review/alerts";
import { useWalletAlerts, WalletAlertItem } from "@/features/operations-review/wallet-alerts";

type OverdueParcel = { id: string; trackingNumber: string; orderId?: string | null; status: string; createdAt: string; batch: { id: string; label: string; shop: { name: string } } };

export function OperationsReviewPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canReviewParcels = user?.role === "SUPERADMIN" || user?.role === "OPERATIONS_MANAGER";
  const allowed = canReviewParcels || user?.role === "FINANCE";
  const [page, setPage] = useState(1);
  const alerts = useOperationsAlerts(canReviewParcels);
  const walletAlerts = useWalletAlerts(allowed);
  const overdue = useQuery({
    queryKey: ["overdue-unsent", 3, "review", page], enabled: canReviewParcels,
    queryFn: () => api<OverdueParcel[]>(`/operations/parcels/overdue-unsent?days=3&page=${page}&pageSize=25`).then((response) => ({ items: response.data, pagination: response.pagination as ApiPagination | undefined })),
  });
  if (!allowed) return null;
  const date = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage === "my" ? "my-MM" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <div className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="font-display text-3xl font-bold">{t("operationsReview")}</h1><p className="mt-1 text-sm text-slate-500">{t(canReviewParcels ? "operationsReviewDescription" : "walletAlertsReviewDescription")}</p></header>
    <section aria-labelledby="review-wallet-alerts" className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#181a1d] sm:p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 id="review-wallet-alerts" className="font-display text-lg font-bold">{t("walletAlertsTitle")}</h2><p className="text-sm text-slate-500">{t("walletAlertsDescription")}</p></div><button type="button" onClick={() => void walletAlerts.refetch()} className="rounded-lg border px-3 py-1.5 text-sm font-semibold dark:border-white/20">{t("refresh")}</button></div>
      {walletAlerts.isLoading ? <p role="status" className="py-8 text-sm text-slate-500">{t("loading")}</p> : walletAlerts.isError ? <div className="py-8"><p role="alert" className="text-sm text-rose-600">{t("loadError")}</p><button type="button" onClick={() => void walletAlerts.refetch()} className="mt-2 text-sm font-bold text-sky-600">{t("retry")}</button></div> : !walletAlerts.data?.length ? <p className="py-8 text-sm text-slate-500">{t("allClear")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{walletAlerts.data.map((alert) => <WalletAlertItem key={alert.id} alert={alert}/>)}</div>}
    </section>
    {canReviewParcels && <>
    <section aria-labelledby="review-alerts" className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#181a1d] sm:p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 id="review-alerts" className="font-display text-lg font-bold">{t("alerts")}</h2><p className="text-sm text-slate-500">{t("reviewAlertsDescription")}</p></div><button type="button" onClick={() => void alerts.refetch()} className="rounded-lg border px-3 py-1.5 text-sm font-semibold dark:border-white/20">{t("refresh")}</button></div>
      {alerts.isLoading ? <p role="status" className="py-8 text-sm text-slate-500">{t("loading")}</p> : alerts.isError ? <div className="py-8"><p role="alert" className="text-sm text-rose-600">{t("loadError")}</p><button type="button" onClick={() => void alerts.refetch()} className="mt-2 text-sm font-bold text-sky-600">{t("retry")}</button></div> : !alerts.data?.length ? <p className="py-8 text-sm text-slate-500">{t("allClear")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{alerts.data.map((alert) => <AlertItem key={alert.id} alert={alert}/>)}</div>}
    </section>
    <OperationsReturnQueue reviewMode />
    <section aria-labelledby="review-overdue" className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-[#181a1d] sm:p-5">
      <div><h2 id="review-overdue" className="font-display text-lg font-bold">{t("queueOverdue")}</h2><p className="text-sm text-slate-500">{t("reviewOverdueDescription")}</p></div>
      {overdue.isLoading ? <p role="status" className="py-8 text-sm text-slate-500">{t("loading")}</p> : overdue.isError ? <div className="py-8"><p role="alert" className="text-sm text-rose-600">{t("loadError")}</p><button type="button" onClick={() => void overdue.refetch()} className="mt-2 text-sm font-bold text-sky-600">{t("retry")}</button></div> : !overdue.data?.items.length ? <p className="py-8 text-sm text-slate-500">{t("allClear")}</p> : <div className="mt-4 space-y-3">{overdue.data.items.map((parcel) => <article key={parcel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10"><div className="min-w-0"><p className="font-semibold"><ParcelDetailsButton id={parcel.id} trackingNumber={parcel.trackingNumber}/>{parcel.orderId && <span className="ml-2 text-xs text-slate-500">{t("orderId")}: {parcel.orderId}</span>}</p><p className="mt-1 text-xs text-slate-500">{parcel.batch.shop.name} · {parcel.batch.label} · {t(`parcelStatus_${parcel.status}`, { defaultValue: parcel.status.replaceAll("_", " ") })}</p><p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">{t("reviewInHandSince", { date: date(parcel.createdAt) })}</p></div><Link to={`/operations/dispatch?batchId=${encodeURIComponent(parcel.batch.id)}&queue=overdue`} className="rounded-lg border border-sky-500 px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-300">{t("openInDispatch")}</Link></article>)}</div>}
      {overdue.data?.pagination && overdue.data.pagination.totalPages > 1 && <nav aria-label={t("reviewOverduePagination")} className="mt-4 flex items-center justify-between text-sm"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="font-bold text-sky-700 disabled:opacity-40">{t("previous")}</button><span>{t("pageOf", { page, total: overdue.data.pagination.totalPages })}</span><button type="button" disabled={page >= overdue.data.pagination.totalPages} onClick={() => setPage(page + 1)} className="font-bold text-sky-700 disabled:opacity-40">{t("next")}</button></nav>}
    </section>
    </>}
  </div>;
}
