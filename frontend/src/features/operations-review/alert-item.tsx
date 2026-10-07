import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ParcelDetailsButton } from "@/components/parcel-details";
import { useAcknowledgeAlert, type OperationsAlert } from "./alerts";

export function AlertItem({ alert, compact = false }: { alert: OperationsAlert; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const acknowledge = useAcknowledgeAlert();
  const type = t(`reviewAlertType_${alert.type}`, { defaultValue: alert.type.replaceAll("_", " ") });
  const status = alert.parcel?.status ? t(`parcelStatus_${alert.parcel.status}`, { defaultValue: alert.parcel.status.replaceAll("_", " ") }) : null;
  return <article className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-700/40 dark:bg-amber-950/20">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      <span className="font-bold text-amber-800 dark:text-amber-300">{type}</span>
      <time dateTime={alert.createdAt}>{new Intl.DateTimeFormat(i18n.resolvedLanguage === "my" ? "my-MM" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(alert.createdAt))}</time>
    </div>
    <p className="mt-1 break-words text-sm font-semibold">{alert.message}</p>
    {alert.parcel && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{alert.parcel.trackingNumber}{alert.parcel.orderId ? ` · ${t("orderId")}: ${alert.parcel.orderId}` : ""}{status ? ` · ${status}` : ""}{alert.parcel.reasonCode ? ` · ${t("reason")}: ${alert.parcel.reasonCode}` : ""}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {alert.parcel && <ParcelDetailsButton id={alert.parcel.id} trackingNumber={alert.parcel.trackingNumber}>{t("viewParcelDetails")}</ParcelDetailsButton>}
      {alert.parcel && <Link to={`/operations/dispatch?trackingNumber=${encodeURIComponent(alert.parcel.trackingNumber)}`} className="text-xs font-bold text-sky-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-300">{t("openInDispatch")}</Link>}
      <button type="button" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(alert.id)} className="rounded-lg border border-amber-600 px-2.5 py-1 text-xs font-bold text-amber-800 disabled:opacity-50 dark:text-amber-300">{t("acknowledge")}</button>
      {acknowledge.isError && <span role="alert" className="text-xs text-rose-600">{t("reviewAcknowledgeError")}</span>}
    </div>
    {!compact && !alert.parcel && <p className="mt-2 text-xs text-slate-500">{t("reviewNoParcelLink")}</p>}
  </article>;
}
