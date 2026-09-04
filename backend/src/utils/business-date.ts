import { ApiError } from "./api-error.js";

function dateParts(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ApiError(400, "INVALID_DATE", "Business dates must use YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new ApiError(400, "INVALID_DATE", "Invalid business date");
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() };
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Exact UTC instant at which a hub-local calendar date begins. */
export function businessDateUtcBoundary(value: string, timeZone: string) {
  const desired = dateParts(value);
  const desiredEpoch = Date.UTC(desired.year, desired.month - 1, desired.day);
  let guess = desiredEpoch;
  // Iteration also handles zones whose offset changes near the requested date.
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desiredEpoch - represented;
  }
  const result = new Date(guess);
  const actual = zonedParts(result, timeZone);
  if (actual.year !== desired.year || actual.month !== desired.month || actual.day !== desired.day || actual.hour !== 0 || actual.minute !== 0)
    throw new ApiError(400, "INVALID_DATE", "Business date does not have a valid start in the configured hub timezone");
  return result;
}

export function nextCalendarDate(value: string) {
  const parts = dateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1)).toISOString().slice(0, 10);
}
