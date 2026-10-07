import { useTranslation } from "react-i18next";

const queues = [
  ["", "all"],
  ["to-assign", "queueToAssign"],
  ["with-riders", "queueWithRiders"],
  ["rescheduled", "queueRescheduled"],
  ["return-to-os", "queueReturnToOs"],
  ["overdue", "queueOverdue"],
] as const;

export function DispatchQueueTabs({ activeQueue, onChange }: { activeQueue: string; onChange: (queue: string) => void }) {
  const { t } = useTranslation();
  return <nav aria-label={t("dispatchWorkQueues")} className="mt-5 flex flex-wrap gap-2">
    {queues.map(([value, label]) => <button
      key={value}
      type="button"
      aria-pressed={activeQueue === value}
      onClick={() => onChange(value)}
      className={`rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${activeQueue === value ? "bg-sky-600 text-white" : "bg-white text-slate-600 dark:bg-white/5 dark:text-slate-200"}`}
    >{t(label)}</button>)}
  </nav>;
}
