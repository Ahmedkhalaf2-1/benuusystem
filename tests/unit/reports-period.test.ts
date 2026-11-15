import { describe, expect, it } from "vitest";
import { parsePeriod, periodParams, sharePercent, trailingMonths } from "@/lib/reports/period";

describe("reporting periods", () => {
  it("defaults to this calendar month (inclusive dates)", () => {
    expect(parsePeriod({}, "2026-11-15")).toEqual({ kind: "this", from: "2026-11-01", to: "2026-11-30" });
  });
  it("last month across a year boundary and in February", () => {
    expect(parsePeriod({ period: "last" }, "2026-01-10")).toEqual({ kind: "last", from: "2025-12-01", to: "2025-12-31" });
    expect(parsePeriod({ period: "last" }, "2028-03-01")).toEqual({ kind: "last", from: "2028-02-01", to: "2028-02-29" });
  });
  it("custom range must be valid and ordered, else falls back to this month", () => {
    expect(parsePeriod({ period: "custom", from: "2026-10-28", to: "2026-11-03" }, "2026-11-15")).toMatchObject({ kind: "custom", from: "2026-10-28", to: "2026-11-03" });
    expect(parsePeriod({ period: "custom", from: "2026-11-03", to: "2026-10-28" }, "2026-11-15").kind).toBe("this");
    expect(parsePeriod({ period: "custom", from: "2026-02-30", to: "2026-03-01" }, "2026-11-15").kind).toBe("this");
  });
  it("round-trips through query params", () => {
    const p = parsePeriod({ period: "custom", from: "2026-01-01", to: "2026-01-31" });
    expect(parsePeriod(periodParams(p))).toEqual(p);
    expect(periodParams(parsePeriod({}))).toEqual({});
  });
  it("six trailing months across the year end", () => {
    expect(trailingMonths("2026-02-10", 6)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("percentages from exact piasters, half-up to one decimal; none for a zero base", () => {
    expect(sharePercent(300000n, 400000n)).toBe("75");
    expect(sharePercent(1n, 3n)).toBe("33.3");
    expect(sharePercent(2n, 3n)).toBe("66.7");
    expect(sharePercent(3080000n, 4000000n)).toBe("77");
    expect(sharePercent(-100n, 400n)).toBe("-25");
    expect(sharePercent(5n, 0n)).toBeNull();
  });
});
