import { useTranslation } from "react-i18next";
import { manifestStatusLabelKey, type ManifestStatusKey } from "@/lib/manifest-filters";

export type ManifestPreviewParcel = {
  trackingNumber: string;
  orderId?: string | null;
  status: string;
  customerName: string;
  customerPhone?: string | null;
  address: string;
  township?: string | null;
  zone?: string | null;
  codAmount: number;
  deliveryFee?: number | null;
  batchLabel?: string;
  shopName?: string;
  pickupDate?: string;
};

export type ManifestPreviewSection = {
  riderId?: string;
  riderName: string;
  hubName?: string;
  parcels: ManifestPreviewParcel[];
};

export type ManifestPreviewSummary = {
  parcelCount: number;
  delivered: number;
  partial: number;
  failed: number;
  rejected: number;
  pendingReturn: number;
  toDeliver: number;
  totalCod: number;
  totalFees: number;
};

export type ManifestPreviewData = {
  sections: ManifestPreviewSection[];
  summary: ManifestPreviewSummary;
  riderCount: number;
  parcelCount: number;
};

const chip = "rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#121416]";

export function DeliveryStatusPanel({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview?: ManifestPreviewData | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (loading) return <p className="py-6 text-sm text-slate-500">{t("loading")}</p>;
  if (error) {
    return (
      <button type="button" onClick={onRetry} className="rounded-xl border px-4 py-2 text-sm font-bold">
        {t("retry")}
      </button>
    );
  }
  if (!preview || preview.parcelCount === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{t("empty")}</p>;
  }
  const stats = [
    { key: "totalParcels", value: preview.summary.parcelCount },
    { key: "toDeliver", value: preview.summary.toDeliver },
    { key: "delivered", value: preview.summary.delivered },
    { key: "partial", value: preview.summary.partial },
    { key: "failed", value: preview.summary.failed },
    { key: "rejected", value: preview.summary.rejected },
    { key: "pendingReturn", value: preview.summary.pendingReturn },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {stats.map((stat) => (
          <div key={stat.key} className={chip}>
            <p className="text-xs font-bold uppercase text-slate-500">{t(stat.key)}</p>
            <p className="mt-1 text-xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        {t("cod")}: {preview.summary.totalCod.toLocaleString()} MMK · {t("fee")}: {preview.summary.totalFees.toLocaleString()} MMK
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500 dark:bg-[#222529]">
            <tr>
              <th className="px-3 py-2">{t("rider")}</th>
              <th className="px-3 py-2">{t("tracking")}</th>
              <th className="px-3 py-2">{t("orderId")}</th>
              <th className="px-3 py-2">{t("customer")}</th>
              <th className="px-3 py-2">{t("township")}</th>
              <th className="px-3 py-2">{t("status")}</th>
              <th className="px-3 py-2 text-right">{t("cod")}</th>
              <th className="px-3 py-2 text-right">{t("fee")}</th>
            </tr>
          </thead>
          <tbody>
            {preview.sections.flatMap((section) =>
              section.parcels.map((parcel) => (
                <tr key={`${section.riderName}-${parcel.trackingNumber}`} className="border-t dark:border-white/10">
                  <td className="px-3 py-2 font-semibold">{section.riderName}</td>
                  <td className="px-3 py-2 font-bold">{parcel.trackingNumber}</td>
                  <td className="px-3 py-2">{parcel.orderId || "—"}</td>
                  <td className="px-3 py-2">{parcel.customerName}</td>
                  <td className="px-3 py-2">{parcel.township || "—"}</td>
                  <td className="px-3 py-2">{t(manifestStatusLabelKey(parcel.status as ManifestStatusKey))}</td>
                  <td className="px-3 py-2 text-right">{parcel.codAmount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{(parcel.deliveryFee ?? 0).toLocaleString()}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
