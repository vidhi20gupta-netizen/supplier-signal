// Calendar-date helpers. Dates are "YYYY-MM-DD" strings in the server's local time zone.

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toDateString(new Date());
}

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
