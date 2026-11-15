import { normalizeDigits } from "./numbers";

/**
 * Money is handled as a whole number of piasters in a BigInt — never as a
 * JavaScript float. The database stores NUMERIC(12,2); conversion goes through
 * strings in both directions. Safe for client and server.
 */
export type Cents = bigint;

/** Largest amount the NUMERIC(12,2) columns can hold: 9,999,999,999.99. */
export const MAX_CENTS: Cents = 999_999_999_999n;

/**
 * "40000", "40,000", "٤٠٬٠٠٠", "1500.5", "1500.50" → piasters.
 * Returns null for empty/invalid input or more than 2 decimals.
 */
export function parseMoney(input: string | null | undefined): Cents | null {
  if (input == null) return null;
  const text = normalizeDigits(String(input)).trim().replace(/[,\s]/g, "");
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  return whole * 100n + fraction;
}

/** Piasters → "40000.00", the format the database expects. */
export function centsToDecimalString(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** "40000.00" / Prisma Decimal / number-like → piasters. */
export function toCents(value: { toString(): string } | string | null | undefined): Cents {
  if (value == null) return 0n;
  const text = value.toString().trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Invalid decimal value: ${text}`);
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = BigInt(match[2]!) * 100n + BigInt(fraction);
  return match[1] ? -cents : cents;
}

/** Piasters → "40,000" or "1,500.50" (Western digits, thousands separators). */
export function formatAmount(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = new Intl.NumberFormat("en-US").format(abs / 100n);
  const fraction = abs % 100n;
  const text = fraction === 0n ? whole : `${whole}.${String(fraction).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** "40,000 ج.م" */
export function formatMoney(cents: Cents): string {
  return `${formatAmount(cents)} ج.م`;
}

/** Same as formatMoney, from a decimal string sent by the server. */
export function formatMoneyString(value: string): string {
  return formatMoney(toCents(value));
}
