import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocationZones } from "./use-location-zones";
import type { Location, ParcelRow, Township } from "./batch-detail-types";
import { match, townshipsForRegion, isParcelRowLocationConsistent } from "./parcel-draft-rules";
import { locationLabel, townshipOptionLabel } from "./parcel-entry-locations";
export const cell =
  "min-w-[130px] border-0 bg-transparent px-2 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-inset focus:ring-[#1598ef] dark:text-slate-100";
function useRowLocationData(row: ParcelRow, townships: Township[], hubId?: string) {
  const resolvedTownship = match(townships, row.townshipId);
  const township = townships.find((item) => item.id === resolvedTownship);
  const zones = useLocationZones(hubId, resolvedTownship, townships.some((item) => item.id === resolvedTownship));
  return { zones, deliveryFee: township?.deliveryFee, resolvedTownship, township };
}

export function LocationCells({
  row,
  index,
  regions,
  townships,
  hubId,
  onChangeRegion,
  onApplyTownship,
  onChangeZone,
  onMove,
}: {
  row: ParcelRow;
  index: number;
  regions: Location[];
  townships: Township[];
  hubId?: string;
  onChangeRegion: (regionStateId: string) => void;
  onApplyTownship: (townshipId: string) => void;
  onChangeZone: (zoneId: string) => void;
  onMove: (event: React.KeyboardEvent<HTMLElement>, column: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const preferMyanmar = i18n.resolvedLanguage === "my";
  const resolvedRegion = match(regions, row.regionStateId);
  const regionTownships = useMemo(
    () => townshipsForRegion(townships, resolvedRegion && regions.some((item) => item.id === resolvedRegion) ? resolvedRegion : ""),
    [townships, resolvedRegion, regions],
  );
  const { zones, resolvedTownship, township } = useRowLocationData(row, regionTownships, hubId);
  const districtLabel = locationLabel(township?.district, preferMyanmar);

  return (
    <>
      <td>
        <select
          data-cell={`${index}-4`}
          aria-label={`${t("region")} ${index + 1}`}
          value={resolvedRegion && regions.some((item) => item.id === resolvedRegion) ? resolvedRegion : ""}
          onChange={(event) => onChangeRegion(event.target.value)}
          onKeyDown={(event) => onMove(event, 4)}
          className={cell}
        >
          <option value="">—</option>
          {regions.map((item) => (
            <option key={item.id} value={item.id}>
              {locationLabel(item, preferMyanmar)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 text-sm text-slate-500" aria-label={`${t("district")} ${index + 1}`}>
        {districtLabel || "—"}
      </td>
      <td>
        <select
          data-cell={`${index}-6`}
          aria-label={`${t("township")} ${index + 1}`}
          value={resolvedTownship && regionTownships.some((item) => item.id === resolvedTownship) ? resolvedTownship : ""}
          onChange={(event) => onApplyTownship(event.target.value)}
          onKeyDown={(event) => onMove(event, 6)}
          className={cell}
          disabled={!resolvedRegion || !regions.some((item) => item.id === resolvedRegion)}
        >
          <option value="">—</option>
          {regionTownships.map((item) => (
            <option key={item.id} value={item.id}>
              {townshipOptionLabel(item, preferMyanmar)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          data-cell={`${index}-7`}
          aria-label={`${t("zone")} ${index + 1}`}
          value={match(
            (zones.data ?? []).map((zone) => ({ id: zone.id, nameEn: zone.name })),
            row.zoneId,
          )}
          onChange={(event) => onChangeZone(event.target.value)}
          onKeyDown={(event) => onMove(event, 7)}
          className={cell}
          disabled={!resolvedTownship || !regionTownships.some((item) => item.id === resolvedTownship)}
        >
          <option value="">—</option>
          {(zones.data ?? []).map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </td>
    </>
  );
}

export function DeliveryFeeCell({ row, townships, hubId }: { row: ParcelRow; townships: Township[]; hubId?: string }) {
  const scoped = row.regionStateId ? townshipsForRegion(townships, row.regionStateId) : townships;
  const { deliveryFee } = useRowLocationData(row, scoped, hubId);
  return (
    <td className="px-2 text-sm font-bold">
      {deliveryFee != null && isParcelRowLocationConsistent(row, townships) ? `${deliveryFee.toLocaleString()} MMK` : "—"}
    </td>
  );
}
