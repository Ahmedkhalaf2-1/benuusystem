import { describe, expect, it } from "vitest";
import { allocateAmount, attributeItem, orderBasis, shareStatus, UNALLOCATED } from "@/lib/finance/allocation";

const b = (key: string, weight: bigint) => ({ key, weight });
const obj = (m: Map<string, bigint>) => Object.fromEntries(m);

describe("allocateAmount (largest remainder, exact piasters)", () => {
  it("splits proportionally and exactly", () => {
    expect(obj(allocateAmount(10_000n, [b("E", 1_000_000n), b("P", 1_200_000n)]))).toEqual({ E: 4545n, P: 5455n });
    expect(obj(allocateAmount(100n, [b("A", 1n), b("B", 1n), b("C", 1n)]))).toEqual({ A: 34n, B: 33n, C: 33n });
  });

  it("is deterministic: ties go to the earlier bucket", () => {
    expect(obj(allocateAmount(1n, [b("A", 5n), b("B", 5n)]))).toEqual({ A: 1n, B: 0n });
    expect(obj(allocateAmount(1n, [b("B", 5n), b("A", 5n)]))).toEqual({ B: 1n, A: 0n });
  });

  it("sends everything to UNALLOCATED when there is no positive basis", () => {
    expect(obj(allocateAmount(500n, []))).toEqual({ [UNALLOCATED]: 500n });
    expect(obj(allocateAmount(500n, [b("A", 0n)]))).toEqual({ [UNALLOCATED]: 500n });
  });

  it("always reconciles: Σ shares = payment, no share negative or above the payment (random)", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let t = 0; t < 2000; t++) {
      const buckets = Array.from({ length: 1 + rnd(5) }, (_, i) => b(`d${i}`, BigInt(rnd(5_000_000))));
      const amount = BigInt(rnd(10_000_000));
      const out = allocateAmount(amount, buckets);
      const sum = [...out.values()].reduce((s, v) => s + v, 0n);
      expect(sum).toBe(amount);
      for (const v of out.values()) {
        expect(v >= 0n && v <= amount).toBe(true);
      }
    }
  });

  it("a full payment of the order total gives each department exactly its value", () => {
    const out = allocateAmount(3_025_000n, [b("E", 1_000_000n), b("C", 225_000n), b("P", 1_800_000n)]);
    expect(obj(out)).toEqual({ E: 1_000_000n, C: 225_000n, P: 1_800_000n });
  });
});

describe("item attribution and order basis", () => {
  const order = (n: string) => ({ E: 1, C: 2, P: 3 })[n] ?? 99;

  it("each item's value goes to exactly one place", () => {
    expect(attributeItem({ id: "1", lineValue: 100n, departmentId: "E", shares: [] })).toEqual({ kind: "department", departmentId: "E", value: 100n });
    expect(attributeItem({ id: "1", lineValue: 100n, departmentId: null, shares: [] })).toMatchObject({ kind: "unallocated", reason: "NO_DEPARTMENT", value: 100n });
    expect(attributeItem({ id: "1", lineValue: null, departmentId: "E", shares: [] })).toMatchObject({ kind: "unallocated", reason: "NO_ITEM_PRICE" });
    expect(attributeItem({ id: "1", lineValue: 100n, departmentId: "P", shares: [{ departmentId: "P", amount: 60n }, { departmentId: "E", amount: 40n }] })).toEqual({
      kind: "split",
      parts: [{ departmentId: "P", value: 60n }, { departmentId: "E", value: 40n }],
    });
    // A split that no longer matches the line value is not trusted.
    expect(attributeItem({ id: "1", lineValue: 120n, departmentId: "P", shares: [{ departmentId: "P", amount: 60n }, { departmentId: "E", amount: 40n }] })).toMatchObject({ kind: "unallocated", reason: "STALE_SPLIT", value: 120n });
  });

  it("builds ordered buckets whose weights add up to the order total", () => {
    const basis = orderBasis(
      {
        pricing: "PER_ITEM",
        total: 600n,
        items: [
          { id: "1", lineValue: 200n, departmentId: "P", shares: [] },
          { id: "2", lineValue: 300n, departmentId: "P", shares: [{ departmentId: "P", amount: 100n }, { departmentId: "E", amount: 200n }] },
          { id: "3", lineValue: 100n, departmentId: null, shares: [] },
        ],
      },
      order,
    );
    expect(basis).toEqual([b("E", 200n), b("P", 300n), b(UNALLOCATED, 100n)]);
    expect(basis.reduce((s, x) => s + x.weight, 0n)).toBe(600n);
    expect(orderBasis({ pricing: "ORDER_TOTAL", total: 900n, items: [] }, order)).toEqual([b(UNALLOCATED, 900n)]);
  });

  it("paid / partial / unpaid", () => {
    expect(shareStatus(100n, 100n)).toBe("PAID");
    expect(shareStatus(100n, 40n)).toBe("PARTIAL");
    expect(shareStatus(100n, 0n)).toBe("UNPAID");
    expect(shareStatus(0n, 0n)).toBe("UNPAID");
  });
});
