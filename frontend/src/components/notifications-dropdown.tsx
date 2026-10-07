import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertItem } from "@/features/operations-review/alert-item";
import { useOperationsAlerts } from "@/features/operations-review/alerts";

export function NotificationsDropdown() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const alerts = useOperationsAlerts();
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="relative"><button ref={trigger} type="button" aria-label={t("notifications")} aria-expanded={open} aria-controls="notifications-panel" onClick={() => setOpen((value) => !value)} className="relative grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-500 dark:bg-white/10 dark:text-white"><Bell size={18}/>{Boolean(alerts.data?.length) && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500"/>}</button>
    {open && <section id="notifications-panel" aria-label={t("notificationsTitle")} className="absolute right-0 z-50 mt-2 w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#181a1d]"><div className="flex items-center justify-between gap-2"><h2 className="font-display text-base font-bold">{t("notificationsTitle")}</h2><Link to="/operations/review" onClick={() => setOpen(false)} className="text-xs font-bold text-sky-700 dark:text-sky-300">{t("reviewViewAll")}</Link></div><div className="mt-3 max-h-[min(28rem,65vh)] space-y-2 overflow-y-auto">{alerts.isLoading ? <p role="status" className="py-4 text-sm text-slate-500">{t("loading")}</p> : alerts.isError ? <div><p role="alert" className="text-sm text-rose-600">{t("loadError")}</p><button type="button" onClick={() => void alerts.refetch()} className="mt-2 text-sm font-bold text-sky-700">{t("retry")}</button></div> : !alerts.data?.length ? <p className="py-4 text-sm text-slate-500">{t("allClear")}</p> : alerts.data.slice(0, 5).map((alert) => <AlertItem key={alert.id} alert={alert} compact/>)}</div></section>}
  </div>;
}
