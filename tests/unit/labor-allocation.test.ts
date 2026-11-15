import { describe, expect, it } from "vitest";
import { allocateDayWage, costPerUnit, percentOf, type AllocationLog } from "@/lib/workers/allocation";

const log = (id: string, orderId: string | null, quantity: number, unit: AllocationLog["unit"] = "PRINT", hours: number | null = null): AllocationLog => ({
  id,
  orderId,
  unit,
  quantity,
  hundredthsOfHours: hours,
});

describe("allocating one day's wage", () => {
  it("splits 300 EGP by prints: Mahmoud 200 → 200 EGP, Ahmed 100 → 100 EGP", () => {
    const a = allocateDayWage(30_000n, [log("l1", "mahmoud", 200), log("l2", "ahmed", 100)]);
    expect(a.basis).toBe("QUANTITY");
    expect(a.shares.map((s) => [s.orderId, s.cents])).toEqual([["mahmoud", 20_000n], ["ahmed", 10_000n]]);
    expect(a.unallocated).toBe(0n);
  });

  it("always sums to the wage exactly (deterministic rounding)", () => {
    const a = allocateDayWage(10_000n, [log("a", "o1", 1), log("b", "o2", 1), log("c", "o3", 1)]);
    expect(a.shares.map((s) => s.cents)).toEqual([3334n, 3333n, 3333n]);
    expect(a.shares.reduce((x, s) => x + s.cents, 0n)).toBe(10_000n);
    for (const wage of [1n, 99n, 30_001n, 123_457n]) {
      const b = allocateDayWage(wage, [log("a", "o1", 7), log("b", "o2", 11), log("c", "o3", 13)]);
      expect(b.shares.reduce((x, s) => x + s.cents, 0n)).toBe(wage);
    }
  });

  it("keeps a worked day with no output fully unallocated (no division by zero)", () => {
    expect(allocateDayWage(30_000n, [])).toEqual({ basis: "NONE", reason: "NO_WORK", shares: [], unallocated: 30_000n });
  });

  it("never adds different units; uses hours when given for all", () => {
    expect(allocateDayWage(30_000n, [log("a", "o1", 50, "METER"), log("b", "o2", 100, "PIECE")])).toMatchObject({
      basis: "NONE",
      reason: "MIXED_UNITS_NO_HOURS",
      unallocated: 30_000n,
    });
    const h = allocateDayWage(30_000n, [log("a", "o1", 50, "METER", 600), log("b", "o2", 100, "PIECE", 200)]);
    expect(h.basis).toBe("HOURS");
    expect(h.shares.map((s) => s.cents)).toEqual([22_500n, 7_500n]);
  });

  it("counts work not tied to an order as unallocated", () => {
    const a = allocateDayWage(30_000n, [log("a", "o1", 200), log("b", null, 100)]);
    expect(a.unallocated).toBe(10_000n);
  });
});

describe("productivity numbers", () => {
  it("target achievement with 2 decimals", () => {
    expect(percentOf(300, 300)).toBe("100.00");
    expect(percentOf(250, 300)).toBe("83.33");
    expect(percentOf(1, 3)).toBe("33.33");
    expect(percentOf(2, 3)).toBe("66.67");
  });
  it("actual cost per unit", () => {
    expect(costPerUnit(30_000n, 300)).toBe(100n);
    expect(costPerUnit(30_000n, 250)).toBe(120n);
    expect(costPerUnit(30_000n, 0)).toBeNull();
  });
});
