/**
 * Business dates (order received, delivery, payment) are calendar dates with no
 * time. They are stored as PostgreSQL DATE and handled as "YYYY-MM-DD" strings;
 * "today" is Cairo's today. Safe for client and server.
 */
export const BUSINESS_TIME_ZONE = "Africa/Cairo";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function todayDateString(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidDateString(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  return date.toISOString().slice(0, 10) === value;
}

/** "2026-11-20" → Date at UTC midnight (what Prisma sends for a DATE column). */
export function dateFromString(value: string): Date {
  if (!isValidDateString(value)) throw new Error(`Invalid date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

/** DATE column value → "YYYY-MM-DD". */
export function dateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-11-20" → "20 نوفمبر 2026" (Western digits). */
export function formatDateAr(value: string | Date): string {
  const date = typeof value === "string" ? dateFromString(value) : value;
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Timestamp → "15 نوفمبر 2026، 2:30 م" in Cairo time. */
export function formatDateTimeAr(date: Date): string {
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(date);
}

/** Whole days from today (Cairo) until the date; negative when it has passed. */
export function daysUntil(value: string, now: Date = new Date()): number {
  const today = dateFromString(todayDateString(now)).getTime();
  return Math.round((dateFromString(value).getTime() - today) / 86_400_000);
}
