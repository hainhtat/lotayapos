import { useTranslation } from "react-i18next";
import {
  ALL_MANIFEST_STATUSES,
  TO_DELIVER_STATUSES,
  manifestStatusLabelKey,
  type ManifestStatus,
} from "@/lib/manifest-filters";

const actionClass = "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold hover:border-[#1598ef] hover:text-[#0787df] dark:border-white/10";

export function ManifestStatusSelect({
  value,
  onChange,
  id,
}: {
  value: readonly ManifestStatus[];
  onChange: (statuses: ManifestStatus[]) => void;
  id: string;
}) {
  const { t } = useTranslation();
  const selected = new Set(value);
  const toggle = (status: ManifestStatus) => {
    if (selected.has(status)) {
      if (value.length > 1) onChange(value.filter((item) => item !== status));
      return;
    }
    onChange([...value, status]);
  };

  return (
    <fieldset id={id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <legend className="px-1 text-xs font-bold text-slate-500">{t("status")}</legend>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className={actionClass} onClick={() => onChange([...ALL_MANIFEST_STATUSES])}>{t("all")}</button>
        <button type="button" className={actionClass} onClick={() => onChange([...TO_DELIVER_STATUSES])}>{t("toDeliver")}</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {ALL_MANIFEST_STATUSES.map((status) => {
          const checked = selected.has(status);
          return (
            <label key={status} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold ${checked ? "bg-[#eaf6ff] text-[#0787df] dark:bg-[#1598ef]/15" : "hover:bg-slate-50 dark:hover:bg-white/5"}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(status)} className="accent-[#1598ef]" />
              {t(manifestStatusLabelKey(status))}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">{t("statusesSelected", { count: value.length })}</p>
    </fieldset>
  );
}
