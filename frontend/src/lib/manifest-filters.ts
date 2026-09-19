import { datePresetRange, type DatePreset } from "@/lib/date-presets";

export const TO_DELIVER_STATUSES = ["ASSIGNED", "OUT_FOR_DELIVERY", "PICKED_UP"] as const;
export const ALL_MANIFEST_STATUSES = [
  "CREATED",
  "PICKED_UP",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "REJECTED",
  "PENDING_RETURN",
  "RETURNED",
] as const;

export type ManifestStatus = (typeof ALL_MANIFEST_STATUSES)[number];
export type ManifestStatusKey = "toDeliver" | "all" | ManifestStatus;
export type ManifestDatePreset = "all" | DatePreset | "custom";

export const MANIFEST_STATUS_FILTERS: ManifestStatusKey[] = [
  "toDeliver",
  "all",
  "DELIVERED",
  "PARTIAL",
  "FAILED",
  "REJECTED",
  "PENDING_RETURN",
  "RETURNED",
];

export const MANIFEST_DATE_PRESETS: ManifestDatePreset[] = ["all", "today", "thisWeek", "thisMonth", "custom"];

export function manifestStatusList(key: ManifestStatusKey): string[] {
  if (key === "toDeliver") return [...TO_DELIVER_STATUSES];
  if (key === "all") return [...ALL_MANIFEST_STATUSES];
  return [key];
}

export function manifestStatusLabelKey(key: ManifestStatusKey) {
  if (key === "toDeliver" || key === "all") return key;
  if (key === "PENDING_RETURN") return "pendingReturn";
  return key.toLowerCase();
}

export function manifestDateRange(preset: ManifestDatePreset, from: string, to: string, now?: Date) {
  if (preset === "all") return {};
  if (preset === "custom") {
    return {
      ...(from ? { dateFrom: from } : {}),
      ...(to ? { dateTo: to } : {}),
    };
  }
  return datePresetRange(preset, now);
}

export function buildManifestBody(input: {
  riderIds: string[];
  statuses?: readonly ManifestStatus[];
  status?: ManifestStatusKey;
  datePreset: ManifestDatePreset;
  dateFrom: string;
  dateTo: string;
  now?: Date;
}) {
  return {
    ...(input.riderIds.length ? { riderIds: input.riderIds } : {}),
    statuses: input.statuses?.length ? [...new Set(input.statuses)] : manifestStatusList(input.status ?? "toDeliver"),
    ...manifestDateRange(input.datePreset, input.dateFrom, input.dateTo, input.now),
  };
}
