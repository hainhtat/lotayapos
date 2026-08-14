export const DATE_CHANGE_REASON_CODES = ["DATE_CHANGE", "DELIVERY_DATE_CHANGE", "RESCHEDULE"] as const;

export function isDateChangeReason(code?: string | null) {
  if (!code) return false;
  const normalized = code.trim().toUpperCase();
  return (DATE_CHANGE_REASON_CODES as readonly string[]).includes(normalized);
}
