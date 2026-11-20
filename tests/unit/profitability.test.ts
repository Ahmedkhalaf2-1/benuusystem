import { describe, expect, it } from "vitest";
import { computeProfitability, isValidMonth, marginPercent, monthBounds, shiftMonth } from "@/lib/finance/profitability";

const base = { price: 10_000_00n, cancelled: false, delivered: true, costStatus: "CLOSED", labor: 0n, collected: 0n };

describe("order profitability (pure)", () => {
  it("groups booked costs, adds labour, excludes drafts, computes profit and margin exactly", () => {
    const p = computeProfitability({
      ...base,
      labor: 500_00n,
      collected: 4_000_00n,
      costs: [
        { category: "MATERIALS", amount: 2_000_00n, isDraft: false },
        { category: "PACKAGING", amount: 100_00n, isDraft: false },
        { category: "PRINTING", amount: 1_500_00n, isDraft: false },
        { category: "OUTSOURCED_LABOR", amount: 300_00n, isDraft: false },
        { category: "TRANSPORT", amount: 50_00n, isDraft: false },
        { category: "MATERIALS", amount: 999_00n, isDraft: true },
      ],
    });
    expect(p).toMatchObject({ revenue: 10_000_00n, materials: 2_100_00n, production: 1_800_00n, labor: 500_00n, otherDirect: 50_00n, directCosts: 4_450_00n, draftCosts: 999_00n, grossProfit: 5_550_00n, margin: "55.5", expectedProfit: 4_551_00n, outstanding: 6_000_00n, provisional: true });
    expect(p.reasons).toEqual(["drafts"]);
  });

  it("negative profit, zero revenue and cancelled orders are safe", () => {
    expect(computeProfitability({ ...base, price: 1_000_00n, costs: [{ category: "OTHER", amount: 1_800_00n, isDraft: false }] })).toMatchObject({ grossProfit: -800_00n, margin: "-80.0", provisional: false });
    const zero = computeProfitability({ ...base, price: 0n, costs: [{ category: "OTHER", amount: 100n, isDraft: false }] });
    expect(zero).toMatchObject({ revenue: 0n, grossProfit: -100n, margin: null });
    expect(zero.reasons).toContain("zero-revenue");
    const cancelled = computeProfitability({ ...base, cancelled: true, delivered: false, collected: 200_00n, costs: [{ category: "MATERIALS", amount: 300_00n, isDraft: false }] });
    expect(cancelled).toMatchObject({ revenue: 0n, grossProfit: -300_00n, outstanding: 0n, overpaid: 200_00n, margin: null });
    expect(cancelled.reasons).toEqual(expect.arrayContaining(["cancelled", "zero-revenue"]));
  });

  it("is provisional until costs are closed and the order is delivered; legacy (null) review counts as open", () => {
    expect(computeProfitability({ ...base, costs: [] }).provisional).toBe(false);
    expect(computeProfitability({ ...base, costStatus: null, costs: [] }).reasons).toEqual(["cost-review-open"]);
    expect(computeProfitability({ ...base, delivered: false, costs: [] }).reasons).toEqual(["not-delivered"]);
  });

  it("over-payment is reported apart, never as negative outstanding", () => {
    expect(computeProfitability({ ...base, collected: 10_500_00n, costs: [] })).toMatchObject({ outstanding: 0n, overpaid: 500_00n });
  });

  it("margin rounds half up to one decimal from exact piasters", () => {
    expect(marginPercent(1n, 3n)).toBe("33.3");
    expect(marginPercent(2n, 3n)).toBe("66.7");
    expect(marginPercent(-1n, 3n)).toBe("-33.3");
    expect(marginPercent(0n, 5n)).toBe("0.0");
    expect(marginPercent(-1n, 100_000n)).toBe("0.0");
    expect(marginPercent(5n, 0n)).toBeNull();
  });

  it("months: validation, bounds (leap years) and shifting across years", () => {
    expect(isValidMonth("2026-11")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
