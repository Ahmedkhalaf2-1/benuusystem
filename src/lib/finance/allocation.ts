/**
 * Customer-payment allocation to departments (pure, exact, deterministic).
 *
 * Customer payments belong to the WHOLE order. To show "collected" per
 * department, each valid payment is split in proportion to the order's
 * explicitly priced department work. This is a derived VIEW — nothing is
 * stored, no treasury transaction exists for it, and it is never a payment to
 * a partner.
 *
 * Rules
 * - Basis (weights) per order:
 *     PER_ITEM order → each item's line value (quantity × unit price) goes to
 *       its department; an item with a valid owner split goes to those
 *       departments by the split amounts.
 *     Anything that can't be attributed reliably goes to UNALLOCATED:
 *       an item with no department, an item whose split no longer adds up to
 *       its line value (stale), and the whole value of single-total
 *       (ORDER_TOTAL) orders.
 * - Each payment is split by the largest-remainder method in whole piasters:
 *     share_k = floor(P × w_k / W); the leftover piasters (< number of
 *     buckets) go one each to the largest remainders, ties broken by the
 *     bucket order (departments by sort order, UNALLOCATED last).
 *   So Σ shares = P exactly, every share ≤ P, and the result is the same on
 *   every run.
 * - A payment with no positive basis (W = 0) is entirely UNALLOCATED.
 */

export const UNALLOCATED = "UNALLOCATED" as const;
export type BucketKey = string; // department id or UNALLOCATED

export type Bucket = { key: BucketKey; weight: bigint };

/** Splits `amount` (piasters) across buckets in proportion to their weights. Σ result = amount. */
export function allocateAmount(amount: bigint, buckets: readonly Bucket[]): Map<BucketKey, bigint> {
  if (amount < 0n) throw new Error("negative amount");
  const out = new Map<BucketKey, bigint>();
  const positive = buckets.filter((b) => b.weight > 0n);
  const total = positive.reduce((s, b) => s + b.weight, 0n);
  if (total === 0n) {
    out.set(UNALLOCATED, amount);
    return out;
  }
  let given = 0n;
  const rems: { key: BucketKey; rem: bigint; index: number }[] = [];
  positive.forEach((b, index) => {
    const product = amount * b.weight;
    const share = product / total;
    out.set(b.key, (out.get(b.key) ?? 0n) + share);
    given += share;
    rems.push({ key: b.key, rem: product % total, index });
  });
  let left = amount - given;
  rems.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (let i = 0; left > 0n; i = (i + 1) % rems.length) {
    out.set(rems[i]!.key, out.get(rems[i]!.key)! + 1n);
    left -= 1n;
  }
  return out;
}

/** One item as the allocation basis sees it. */
export type BasisItem = {
  id: string;
  /** Line value in piasters (quantity × unit price); null when the order has no item prices. */
  lineValue: bigint | null;
  departmentId: string | null;
  /** Owner split (piasters); empty = none. */
  shares: readonly { departmentId: string; amount: bigint }[];
};

export type ItemAttribution =
  | { kind: "department"; departmentId: string; value: bigint }
  | { kind: "split"; parts: { departmentId: string; value: bigint }[] }
  | { kind: "unallocated"; value: bigint; reason: "NO_DEPARTMENT" | "STALE_SPLIT" | "NO_ITEM_PRICE" };

/** Where one item's value goes (exactly once). */
export function attributeItem(item: BasisItem): ItemAttribution {
  if (item.lineValue === null) return { kind: "unallocated", value: 0n, reason: "NO_ITEM_PRICE" };
  if (item.shares.length > 0) {
    const sum = item.shares.reduce((s, x) => s + x.amount, 0n);
    if (sum !== item.lineValue) return { kind: "unallocated", value: item.lineValue, reason: "STALE_SPLIT" };
    return { kind: "split", parts: item.shares.map((x) => ({ departmentId: x.departmentId, value: x.amount })) };
  }
  if (!item.departmentId) return { kind: "unallocated", value: item.lineValue, reason: "NO_DEPARTMENT" };
  return { kind: "department", departmentId: item.departmentId, value: item.lineValue };
}

/**
 * The order's allocation buckets, in a deterministic order: departments by
 * `departmentOrder` (then id), UNALLOCATED last. `orderTotal` covers
 * single-total orders, whose whole value is UNALLOCATED.
 */
export function orderBasis(
  order: { pricing: "PER_ITEM" | "ORDER_TOTAL"; total: bigint; items: readonly BasisItem[] },
  departmentOrder: (departmentId: string) => number,
): Bucket[] {
  if (order.pricing !== "PER_ITEM") return [{ key: UNALLOCATED, weight: order.total }];
  const weights = new Map<BucketKey, bigint>();
  const add = (key: BucketKey, v: bigint) => weights.set(key, (weights.get(key) ?? 0n) + v);
  for (const item of order.items) {
    const a = attributeItem(item);
    if (a.kind === "department") add(a.departmentId, a.value);
    else if (a.kind === "split") a.parts.forEach((p) => add(p.departmentId, p.value));
    else add(UNALLOCATED, a.value);
  }
  const keys = [...weights.keys()].sort((x, y) => {
    if (x === UNALLOCATED) return 1;
    if (y === UNALLOCATED) return -1;
    const d = departmentOrder(x) - departmentOrder(y);
    return d !== 0 ? d : x < y ? -1 : x > y ? 1 : 0;
  });
  return keys.map((key) => ({ key, weight: weights.get(key)! }));
}

/** Paid status of one department's share of one order. */
export type ShareStatus = "PAID" | "PARTIAL" | "UNPAID";
export function shareStatus(value: bigint, collected: bigint): ShareStatus {
  if (value > 0n && collected >= value) return "PAID";
  return collected > 0n ? "PARTIAL" : "UNPAID";
}
