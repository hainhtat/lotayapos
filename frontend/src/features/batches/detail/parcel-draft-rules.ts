import type { Location, Township, ParcelRow, ManifestPreviewRow } from "./batch-detail-types";

export const blank = (): ParcelRow => ({
  orderId: "",
  customerName: "",
  address: "",
  regionStateId: "",
  districtId: "",
  townshipId: "",
  zoneId: "",
  customerPhone: "",
  codAmount: "",
});

export function isParcelRowBlank(row: ParcelRow) {
  return !Object.values(row).some(Boolean);
}

const MYANMAR_DIGITS: Record<string, string> = {
  "\u1040": "0", "\u1041": "1", "\u1042": "2", "\u1043": "3", "\u1044": "4",
  "\u1045": "5", "\u1046": "6", "\u1047": "7", "\u1048": "8", "\u1049": "9",
};

export function normalizeCodAmount(value: string) {
  const normalized = value
    .trim()
    .replace(/[\u1040-\u1049]/g, (digit) => MYANMAR_DIGITS[digit] ?? digit)
    .replace(/(?:MMK|Ks|ကျပ်)\.?$/i, "")
    .replace(/[\s,]/g, "");
  return /^\d+$/.test(normalized) ? normalized : value.trim();
}

export function isParcelRowComplete(row: ParcelRow) {
  return Boolean(row.customerName.trim() && row.address.trim() && row.townshipId && /^\d+$/.test(normalizeCodAmount(row.codAmount)));
}

export function parcelRowErrorKeys(row: ParcelRow, townships: Township[]) {
  if (isParcelRowBlank(row)) return [];
  const errors: string[] = [];
  if (!row.customerName.trim()) errors.push("rowNeedsCustomer");
  if (!row.address.trim()) errors.push("rowNeedsAddress");
  if (!row.townshipId || !isParcelRowLocationConsistent(row, townships)) errors.push("rowNeedsTownship");
  if (!/^\d+$/.test(normalizeCodAmount(row.codAmount))) errors.push("rowNeedsCod");
  return errors;
}

export function appendParcelDraft(rows: ParcelRow[], draft: ParcelRow): ParcelRow[] {
  const blankIndex = rows.findIndex(isParcelRowBlank);
  if (blankIndex >= 0) return rows.map((row, index) => (index === blankIndex ? { ...draft } : row));
  return [...rows, { ...draft }];
}

export function prependParcelDrafts(current: ParcelRow[], incoming: ParcelRow[]): ParcelRow[] {
  return [...incoming, ...current.filter((row) => !isParcelRowBlank(row))];
}

/** Normalize extracted/API preview values before placing them in string inputs. */
export function normalizeManifestRow(row: Partial<Omit<ParcelRow, "codAmount">> & { codAmount?: unknown }): ParcelRow {
  const normalized = {
    orderId: String(row.orderId ?? ""),
    customerName: String(row.customerName ?? ""),
    address: String(row.address ?? ""),
    regionStateId: String(row.regionStateId ?? ""),
    districtId: String(row.districtId ?? ""),
    townshipId: String(row.townshipId ?? ""),
    zoneId: String(row.zoneId ?? ""),
    customerPhone: String(row.customerPhone ?? ""),
    codAmount: String(row.codAmount ?? ""),
  };
  // JSON objects/arrays must never become plausible-looking input values.
  for (const key of Object.keys(normalized) as Array<keyof ParcelRow>) {
    const value = row[key];
    if (value != null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) normalized[key] = "";
  }
  return normalized;
}

export function restoreParcelDraft(saved: string | null): ParcelRow[] {
  try {
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map(normalizeManifestRow).filter((row) => !isParcelRowBlank(row));
  } catch { return []; }
}

export function manifestReviewSummary(rows: ManifestPreviewRow[]) {
  let totalCod = 0;
  let needsReview = 0;
  for (const row of rows) {
    const normalized = normalizeManifestRow(row);
    const amount = normalizeCodAmount(normalized.codAmount);
    const valid = /^\d+$/.test(amount) && Number.isSafeInteger(Number(amount));
    if (valid) totalCod += Number(amount);
    if (!valid || !normalized.customerName.trim() || !normalized.address.trim() || !normalized.townshipId || row.confidence < 0.8 || row.warnings.length) needsReview++;
  }
  return { totalCod, needsReview };
}

export function formatTrackingNumber(sequence: number) {
  return `LTY-${String(sequence).padStart(3, "0")}`;
}

export function parseParcelGrid(text: string): ParcelRow[] {
  const parseCsvLine = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    return cells;
  };
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells = (line.includes("\t") ? line.split("\t") : parseCsvLine(line)).map((value) => value.trim());
      return {
        orderId: cells[0] ?? "",
        customerName: cells[1] ?? "",
        address: cells[2] ?? "",
        regionStateId: cells[3] ?? "",
        districtId: cells[4] ?? "",
        townshipId: cells[5] ?? "",
        zoneId: cells[6] ?? "",
        customerPhone: cells[7] ?? "",
        // COD is the final column, so tolerate an unquoted thousands separator
        // from CSV exports (for example `25,000 MMK`).
        codAmount: normalizeCodAmount(cells.slice(8).join(",")),
      };
    });
}

/** Single-cell text belongs to the focused input; only structured rows enter the grid import. */
export function isStructuredParcelPaste(text: string) {
  if (/\r?\n|\t/.test(text)) return true;
  let quoted = false;
  let separators = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (text[index] === "," && !quoted) separators += 1;
  }
  return separators >= 8;
}

export const match = (items: Location[], token: string) =>
  items.find((item) => [item.id, item.code, item.nameEn, item.nameMy].some((value) => value?.toLocaleLowerCase() === token.toLocaleLowerCase()))?.id ?? token;

const locationTokens = (item: Location) => [item.id, item.code, item.nameEn, item.nameMy];

function matchesLocationToken(item: Location, token: string) {
  const normalized = token.toLocaleLowerCase();
  return locationTokens(item).some((value) => value?.toLocaleLowerCase() === normalized);
}

export function applyTownshipToParcelRow(
  row: ParcelRow,
  townshipId: string,
  townships: Township[],
  options?: { syncRegion?: boolean },
): ParcelRow {
  if (!townshipId) {
    return {
      ...row,
      townshipId: "",
      districtId: "",
      zoneId: "",
      ...(options?.syncRegion ? { regionStateId: "" } : {}),
    };
  }
  const township = townships.find((item) => item.id === townshipId);
  return {
    ...row,
    townshipId,
    zoneId: "",
    districtId: township?.district?.id ?? "",
    ...(options?.syncRegion
      ? { regionStateId: township?.district?.regionState?.id ?? township?.district?.regionStateId ?? "" }
      : {}),
  };
}

export function townshipsForRegion(townships: Township[], regionStateId: string) {
  if (!regionStateId) return [];
  return townships.filter(
    (township) => (township.district?.regionState?.id ?? township.district?.regionStateId) === regionStateId,
  );
}

export function isResolvedTownshipId(townshipId: string, townships: Township[]) {
  return Boolean(townshipId && townships.some((item) => item.id === townshipId));
}

export function isParcelRowLocationConsistent(row: ParcelRow, townships: Township[]) {
  if (!row.townshipId) return true;
  if (!isResolvedTownshipId(row.townshipId, townships)) return false;
  if (!row.regionStateId) return true;
  return townshipsForRegion(townships, row.regionStateId).some((item) => item.id === row.townshipId);
}

export function hydrateParcelRowLocations(row: ParcelRow, townships: Township[], regions: Location[] = []): ParcelRow {
  const matchedRegion = row.regionStateId.trim() ? match(regions, row.regionStateId) : "";
  const regionStateId = matchedRegion && regions.some((item) => item.id === matchedRegion) ? matchedRegion : "";

  if (!row.townshipId.trim()) {
    return { ...row, regionStateId };
  }

  if (!townships.length) {
    return { ...row, ...(regionStateId ? { regionStateId } : {}) };
  }

  const hits = townships.filter((item) => matchesLocationToken(item, row.townshipId));
  const scopedHits = regionStateId
    ? hits.filter((item) => (item.district?.regionState?.id ?? item.district?.regionStateId) === regionStateId)
    : hits;
  const candidates = scopedHits.length === 1 ? scopedHits : hits.length === 1 ? hits : [];

  if (candidates.length !== 1) {
    return {
      ...row,
      regionStateId,
      townshipId: row.townshipId,
      districtId: "",
      zoneId: row.zoneId,
    };
  }

  const township = candidates[0]!;
  const townshipRegion = township.district?.regionState?.id ?? township.district?.regionStateId ?? "";
  const applied = applyTownshipToParcelRow({ ...row, regionStateId: townshipRegion }, township.id, townships);
  return { ...applied, regionStateId: townshipRegion, zoneId: row.zoneId };
}
