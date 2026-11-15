import { describe, expect, it } from "vitest";
import { monthRange, previousMonthRange } from "@/lib/dates";
import { settlementStatus } from "@/lib/finance/labels";
import { recordExpenseSchema } from "@/lib/validations/finance";

describe("month ranges", () => {
  it("handles month lengths, leap years and January", () => {
    expect(monthRange("2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(previousMonthRange("2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousMonthRange("2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("pay status → initial payment", () => {
  const base = { idempotencyKey: "0195f3a0-0000-7000-8000-000000000000", category: "RENT", amount: "5000", expenseDate: "2026-01-01" };

  it("FULL pays everything, CREDIT pays nothing, PARTIAL pays what was typed", () => {
    expect(recordExpenseSchema.parse({ ...base, payStatus: "FULL" }).initialPayment).toBe(500_000n);
    expect(recordExpenseSchema.parse({ ...base, payStatus: "CREDIT", paidNow: "999" }).initialPayment).toBe(0n);
    expect(recordExpenseSchema.parse({ ...base, payStatus: "PARTIAL", paidNow: "٣٠٠٠" }).initialPayment).toBe(300_000n);
  });

  it("requires a choice and a sensible partial amount", () => {
    expect(recordExpenseSchema.safeParse({ ...base }).success).toBe(false);
    expect(recordExpenseSchema.safeParse({ ...base, payStatus: "PARTIAL", paidNow: "5000" }).success).toBe(false);
    expect(recordExpenseSchema.safeParse({ ...base, payStatus: "PARTIAL", paidNow: "0" }).success).toBe(false);
  });

  it("derives paid / partly paid / unpaid", () => {
    expect(settlementStatus(1000n, 0n)).toBe("UNPAID");
    expect(settlementStatus(1000n, 400n)).toBe("PARTIAL");
    expect(settlementStatus(1000n, 1000n)).toBe("PAID");
  });
});
