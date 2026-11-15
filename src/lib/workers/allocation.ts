import type { WorkUnit } from "@/generated/prisma/enums";
import type { Cents } from "@/lib/money";

/**
 * Splits ONE worked day's wage across that day's work logs — exactly once.
 *
 *  - all logs in one unit  → split by quantity (200 + 100 prints of 300 EGP → 200 / 100);
 *  - mixed units           → split by recorded hours (never adds meters to pieces);
 *  - nothing usable        → the whole wage is "unallocated" (still a real cost).
 *
 * Shares are whole piasters and ALWAYS add up to the wage: each log gets the
 * floor of its exact share, and the leftover piasters go to the logs with the
 * largest remainders (ties → earlier log). Logs without an order count as
 * unallocated too. Pure function: recomputed from valid records whenever needed.
 */
export type AllocationLog = {
  id: string;
  orderId: string | null;
  unit: WorkUnit;
  quantity: number;
  /** Hours × 100 (e.g. 2.5 h → 250), or null when not recorded. */
  hundredthsOfHours: number | null;
};

export type AllocationBasis = "QUANTITY" | "HOURS" | "NONE";
export type UnallocatedReason = "NO_WORK" | "MIXED_UNITS_NO_HOURS" | null;

export type DayAllocation = {
  basis: AllocationBasis;
  reason: UnallocatedReason;
  shares: { logId: string; orderId: string | null; cents: Cents }[];
  /** Wage not attributed to any order (no work, mixed units without hours, or work without an order). */
  unallocated: Cents;
};

export function allocateDayWage(wage: Cents, logs: readonly AllocationLog[]): DayAllocation {
  if (wage <= 0n || logs.length === 0) {
    return { basis: "NONE", reason: logs.length === 0 && wage > 0n ? "NO_WORK" : null, shares: [], unallocated: wage > 0n ? wage : 0n };
  }

  const units = new Set(logs.map((l) => l.unit));
  let basis: AllocationBasis;
  let weights: bigint[];
  if (units.size === 1) {
    basis = "QUANTITY";
    weights = logs.map((l) => BigInt(l.quantity));
  } else if (logs.every((l) => l.hundredthsOfHours !== null && l.hundredthsOfHours > 0)) {
    basis = "HOURS";
    weights = logs.map((l) => BigInt(l.hundredthsOfHours!));
  } else {
    return { basis: "NONE", reason: "MIXED_UNITS_NO_HOURS", shares: [], unallocated: wage };
  }

  const total = weights.reduce((a, b) => a + b, 0n);
  const floors = weights.map((w) => (wage * w) / total);
  const remainders = weights.map((w, i) => ({ i, r: (wage * w) % total }));
  let leftover = wage - floors.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    floors[i]! += 1n;
    leftover -= 1n;
  }

  const shares = logs.map((l, i) => ({ logId: l.id, orderId: l.orderId, cents: floors[i]! }));
  const unallocated = shares.filter((s) => !s.orderId).reduce((a, s) => a + s.cents, 0n);
  return { basis, reason: null, shares, unallocated };
}

/** Exact percentage with 2 decimals, half-up: 250 of 300 → "83.33". */
export function percentOf(done: number, target: number): string {
  if (target <= 0) return "0.00";
  const scaled = (BigInt(done) * 10000n * 2n + BigInt(target)) / (BigInt(target) * 2n); // hundredths of a percent, half-up
  return `${scaled / 100n}.${String(scaled % 100n).padStart(2, "0")}`;
}

/** Cost of one unit in piasters, half-up: 300 EGP / 250 → 120 (1.20 EGP). */
export function costPerUnit(wage: Cents, quantity: number): Cents | null {
  if (quantity <= 0) return null;
  const q = BigInt(quantity);
  return (wage * 2n + q) / (2n * q);
}
