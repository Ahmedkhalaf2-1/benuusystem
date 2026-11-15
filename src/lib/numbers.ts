/**
 * Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to 0-9 and Arabic
 * separators to ASCII, so "٤٠٬٠٠٠٫٥" typed on an Arabic keyboard is understood.
 * Safe for client and server.
 */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, ",");
}

/** Parses a positive whole number ("200", "٢٠٠", "1,000"); null when invalid. */
export function parseWholeNumber(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isSafeInteger(input) ? input : null;
  if (input == null) return null;
  const text = normalizeDigits(String(input)).replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
