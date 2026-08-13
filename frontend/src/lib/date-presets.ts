export type DatePreset = "today" | "thisWeek" | "thisMonth";

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function datePresetRange(preset: DatePreset, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (preset === "today") {
    const today = new Date(year, month, day);
    return { dateFrom: isoDate(today), dateTo: isoDate(today) };
  }
  if (preset === "thisWeek") {
    const weekday = now.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = new Date(year, month, day + mondayOffset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { dateFrom: isoDate(start), dateTo: isoDate(end) };
  }
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { dateFrom: isoDate(start), dateTo: isoDate(end) };
}
