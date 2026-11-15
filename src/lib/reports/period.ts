import { isValidDateString, monthRange, previousMonthRange, todayDateString } from "@/lib/dates";

/**
 * Reporting periods. Every business date in the system (payment date, cost
 * date, expense date, work date) is a calendar DATE in Cairo time, so a period
 * is simply an inclusive range of those dates: from ≤ date ≤ to. "Today" is
 * Cairo's today (see todayDateString). No timestamps are compared.
 */
export type Period = { kind: "this" | "last" | "custom"; from: string; to: string };

export function parsePeriod(sp: Record<string, string | string[] | undefined>, today = todayDateString()): Period {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const kind = str(sp.period);
  if (kind === "last") return { kind: "last", ...previousMonthRange(today) };
  if (kind === "custom") {
    const from = str(sp.from);
    const to = str(sp.to);
    if (isValidDateString(from) && isValidDateString(to) && from <= to) return { kind: "custom", from, to };
  }
  return { kind: "this", ...monthRange(today) };
}

/** Query-string pairs that reproduce a period (omits the default). */
export function periodParams(p: Period): Record<string, string> {
  if (p.kind === "this") return {};
  if (p.kind === "last") return { period: "last" };
  return { period: "custom", from: p.from, to: p.to };
}

/** ["2026-06", …] — the `count` months ending with the month containing `day`. */
export function trailingMonths(day: string, count: number): string[] {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Percentage with one decimal, from exact piasters; null when the base is zero. */
export function sharePercent(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null;
  // Round the magnitude half-up, then apply the sign (BigInt division truncates toward zero).
  const neg = part < 0n !== whole < 0n && part !== 0n;
  const p = part < 0n ? -part : part;
  const w = whole < 0n ? -whole : whole;
  const abs = (p * 1000n + w / 2n) / w;
  return `${neg ? "-" : ""}${abs / 10n}${abs % 10n === 0n ? "" : `.${abs % 10n}`}`;
}
