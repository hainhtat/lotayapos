/**
 * Normalize Myanmar mobile numbers so local `09` and international `+959`
 * spellings resolve to one unique database identity. Only spaces and dashes
 * are accepted as formatting characters; other punctuation is rejected.
 */
export function normalizeMyanmarPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\+?[0-9 -]+$/.test(trimmed)) return null;
  const compact = trimmed.replace(/[ -]/g, "");
  const canonical = compact.startsWith("+95")
    ? compact
    : compact.startsWith("09")
      ? `+95${compact.slice(1)}`
      : null;
  return canonical && /^\+959\d{7,9}$/.test(canonical) ? canonical : null;
}
