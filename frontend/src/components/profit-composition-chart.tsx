import { useTranslation } from "react-i18next";

type ProfitCompositionChartProps = {
  deliveryFeeRevenue: number;
  riderCompensationCost: number;
  expenseCost: number;
  adjustmentContribution: number;
};

const money = (value: number) => `${value.toLocaleString()} MMK`;

export function ProfitCompositionChart(props: ProfitCompositionChartProps) {
  const { t } = useTranslation();
  const rows = [
    { label: t("deliveryFeeRevenue"), value: props.deliveryFeeRevenue, color: "bg-sky-500" },
    { label: t("riderCompensationCost"), value: props.riderCompensationCost, color: "bg-amber-500" },
    { label: t("expenseCost"), value: props.expenseCost, color: "bg-rose-500" },
    { label: t("adjustmentContribution"), value: props.adjustmentContribution, color: props.adjustmentContribution < 0 ? "bg-rose-400" : "bg-emerald-500" },
  ];
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  return (
    <figure aria-labelledby="profit-composition-title" className="mt-4 rounded-xl border border-slate-100 p-4 dark:border-white/10">
      <figcaption id="profit-composition-title" className="font-display font-bold">{t("profitCompositionChart")}</figcaption>
      <p className="mt-1 text-xs text-slate-500">{t("profitCompositionChartDescription")}</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex justify-between gap-3 text-xs"><span>{row.label}</span><strong>{money(row.value)}</strong></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${Math.max(row.value === 0 ? 0 : 3, Math.abs(row.value) / maximum * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
