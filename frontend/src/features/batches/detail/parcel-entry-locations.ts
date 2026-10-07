import type { Township } from "./batch-detail-types";

export function locationLabel(value: { nameEn: string; nameMy?: string } | null | undefined, preferMyanmar: boolean) {
  if (!value) return "";
  return preferMyanmar && value.nameMy ? value.nameMy : value.nameEn;
}

export function townshipOptionLabel(
  township: Township,
  preferMyanmar: boolean,
  options?: { includeRegion?: boolean; includeDistrict?: boolean },
) {
  const parts = [
    options?.includeRegion ? locationLabel(township.district?.regionState, preferMyanmar) : "",
    options?.includeDistrict ? locationLabel(township.district, preferMyanmar) : "",
    locationLabel(township, preferMyanmar) || township.nameEn,
  ].filter(Boolean);
  return parts.join(" · ");
}
