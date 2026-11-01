// Single client-side source of truth for the café's business day.
// Mirrors server/lib/shifts.js (businessDayLabelForTs_) exactly.
//
// A business day runs 8:00 AM -> 7:59 AM next day, Africa/Cairo, with a
// 30-minute grace window (so it starts at 07:30 Cairo). Everything here
// is pinned to Cairo and never uses the browser's own time zone, the
// browser's local midnight, or "+24h" arithmetic -- Egypt's DST days are
// 23h / 25h long, and the date label is always a YYYY-MM-DD string.
export const BUSINESS_DAY_GRACE_MS = 8 * 3600000 - 30 * 60000;

const CAIRO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
});
const CAIRO_HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo", hour: "2-digit", hour12: false,
});

export function cairoDateLabel(ts: number): string {
  return CAIRO_DATE_FMT.format(new Date(ts));
}
// Cairo wall-clock hour 0-23 (not the browser's).
export function cairoHour(ts: number): number {
  return Number(CAIRO_HOUR_FMT.format(new Date(ts))) % 24;
}
// The business-day label (YYYY-MM-DD) a timestamp belongs to.
export function businessDayLabelForTs(ts: number): string {
  return cairoDateLabel(ts - BUSINESS_DAY_GRACE_MS);
}

// "YYYY-MM-DD" + n days, pure calendar arithmetic (no time zone, no DST).
export function addDaysToLabel(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// Number of days in a "YYYY-MM" month (28-31), calendar arithmetic only.
export function daysInMonthLabel(monthStr: string): number {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// First instant (ms) whose business-day label is `dateStr`. Found by
// asking the label function itself, so it can never disagree with the
// server: start from UTC midnight of the date, then walk by whole hours
// (Egypt's DST shifts are whole hours) until the label flips to dateStr.
export function businessDayStart(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Cairo is UTC+2/+3, so Cairo midnight + grace is within +-3h of this.
  let t = Date.UTC(y, m - 1, d) + BUSINESS_DAY_GRACE_MS;
  for (let i = 0; i < 6 && businessDayLabelForTs(t) < dateStr; i++) t += 3600000;
  for (let i = 0; i < 6 && businessDayLabelForTs(t - 3600000) >= dateStr; i++) t -= 3600000;
  return t;
}
export function businessDayBounds(dateStr: string): { from: number; to: number } {
  return { from: businessDayStart(dateStr), to: businessDayStart(addDaysToLabel(dateStr, 1)) - 1 };
}
