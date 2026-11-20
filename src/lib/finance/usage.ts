/**
 * Material usage arithmetic (client + server): quantities are exact
 * thousandths (up to 3 decimals), money is whole piasters.
 *   total = round_half_up(quantity × unit cost)
 */

/** Quantity typed with up to 3 decimals → thousandths (exact); null when invalid. */
export function parseQuantity(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".");
  const m = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return null;
  return BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"));
}

export function formatQuantity(milli: bigint): string {
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Total of a usage line: quantity (thousandths) × unit cost (piasters), half-up to the piaster. */
export function usageTotalCents(quantityMilli: bigint, unitCostCents: bigint): bigint {
  return (quantityMilli * unitCostCents * 2n + 1000n) / 2000n;
}
