// Calendar-date helpers. Dates are "YYYY-MM-DD" strings in the server's local time zone.

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The calendar date everything is measured from: seed dates, days remaining, message timestamps.
 * EVAL_TODAY (YYYY-MM-DD) pins it so an eval run is reproducible; otherwise it is the current date.
 * Read once at startup, like the in-memory seed it has to agree with.
 */
export const TODAY: string = (() => {
  const pinned = process.env.EVAL_TODAY?.trim();
  if (!pinned) return toDateString(new Date());
  const [y, m, d] = pinned.split("-").map(Number);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pinned) || toDateString(new Date(y, m - 1, d)) !== pinned) {
    throw new Error(`EVAL_TODAY must be a real date as YYYY-MM-DD, got "${pinned}"`);
  }
  return pinned;
})();

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export function formatDate(date: string): string {
  return parse(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
