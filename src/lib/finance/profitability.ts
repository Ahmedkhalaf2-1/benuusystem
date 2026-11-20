import type { CostCategory } from "@/generated/prisma/enums";
import type { Cents } from "@/lib/money";

/**
 * Order profitability — pure, exact (whole piasters). Shared by the order's
 * «التكاليف» page and the monthly closing so both always agree.
 *
 *   Net order revenue   = the order's agreed selling value (total_price, after
 *                         any price change); 0 for a cancelled order. Refunds
 *                         are not modelled (see docs/financial-model.md).
 *   Recognized costs    = BOOKED (non-draft, not voided) order costs
 *                         + labour allocated to the order (existing rule).
 *   Draft costs         = entered but not booked yet: shown, never in profit.
 *   Gross profit        = revenue − recognized costs.
 *   Margin %            = gross profit ÷ revenue × 100 (none when revenue ≤ 0).
 *
 * A supplier PAYMENT never appears here: the cost was recognized when booked,
 * and paying it only moves cash and the payable.
 */

/** Cost groups shown on the order (same split as «تكاليف وهامش الأوردرات»). */
export type CostGroup = "materials" | "production" | "other";
export const COST_GROUP_OF: Record<CostCategory, CostGroup> = {
  MATERIALS: "materials",
  PACKAGING: "materials",
  PRINTING: "production",
  EMBROIDERY: "production",
  OUTSOURCED_LABOR: "production",
  TRANSPORT: "other",
  OTHER: "other",
};

export type ProfitCost = { category: CostCategory; amount: Cents; isDraft: boolean };

export type ProvisionalReason = "cost-review-open" | "drafts" | "not-delivered" | "cancelled" | "zero-revenue";

export type Profitability = {
  revenue: Cents;
  materials: Cents;
  production: Cents;
  /** Allocated labour of the order's workers. */
  labor: Cents;
  /** Transport and other direct costs. */
  otherDirect: Cents;
  /** materials + production + labor + otherDirect (booked only). */
  directCosts: Cents;
  draftCosts: Cents;
  grossProfit: Cents;
  /** "12.5" (one decimal, half-up), or null when revenue ≤ 0. */
  margin: string | null;
  /** Gross profit if every draft is booked as entered. */
  expectedProfit: Cents;
  collected: Cents;
  /** revenue − collected, never below 0 (over-payments are reported apart). */
  outstanding: Cents;
  overpaid: Cents;
  provisional: boolean;
  reasons: ProvisionalReason[];
};

/** Percentage with one decimal, half-up, from exact piasters. Null when the base is ≤ 0. */
export function marginPercent(part: Cents, whole: Cents): string | null {
  if (whole <= 0n) return null;
  const neg = part < 0n;
  const abs = neg ? -part : part;
  const tenths = (abs * 1000n + whole / 2n) / whole;
  const text = `${tenths / 10n}.${tenths % 10n}`;
  return neg && tenths !== 0n ? `-${text}` : text;
}

export function computeProfitability(input: {
  price: Cents;
  cancelled: boolean;
  delivered: boolean;
  /** Cost review status; null = legacy order never reviewed. */
  costStatus: string | null;
  costs: ProfitCost[];
  labor: Cents;
  collected: Cents;
}): Profitability {
  const revenue = input.cancelled ? 0n : input.price;
  const sums: Record<CostGroup, Cents> = { materials: 0n, production: 0n, other: 0n };
  let draftCosts = 0n;
  for (const c of input.costs) {
    if (c.isDraft) draftCosts += c.amount;
    else sums[COST_GROUP_OF[c.category]] += c.amount;
  }
  const directCosts = sums.materials + sums.production + input.labor + sums.other;
  const grossProfit = revenue - directCosts;
  const reasons: ProvisionalReason[] = [];
  if (input.costStatus !== "CLOSED") reasons.push("cost-review-open");
  if (draftCosts > 0n) reasons.push("drafts");
  if (input.cancelled) reasons.push("cancelled");
  else if (!input.delivered) reasons.push("not-delivered");
  if (revenue <= 0n) reasons.push("zero-revenue");
  const due = input.cancelled ? 0n : input.price;
  return {
    revenue,
    materials: sums.materials,
    production: sums.production,
    labor: input.labor,
    otherDirect: sums.other,
    directCosts,
    draftCosts,
    grossProfit,
    margin: marginPercent(grossProfit, revenue),
    expectedProfit: grossProfit - draftCosts,
    collected: input.collected,
    outstanding: due > input.collected ? due - input.collected : 0n,
    overpaid: input.collected > due ? input.collected - due : 0n,
    // Final only when costs are closed with no drafts and the order was delivered.
    provisional: reasons.some((r) => r === "cost-review-open" || r === "drafts" || r === "not-delivered"),
    reasons,
  };
}

export const PROVISIONAL_LABELS: Record<ProvisionalReason, string> = {
  "cost-review-open": "تكاليف الأوردر لسه متقفلتش",
  drafts: "فيه تكاليف مسودة لسه متسجلتش على الموردين",
  "not-delivered": "الأوردر لسه متسلمش بالكامل",
  cancelled: "الأوردر ملغي — مالوش إيراد",
  "zero-revenue": "إيراد الأوردر صفر — مفيش نسبة هامش",
};

// ───────────── Months ─────────────

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export function isValidMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

/** "2026-11" → first and last day. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Revenue recognition basis («أساس الاعتراف بالإيراد»):
 *  - DELIVERY (default): an order's revenue AND all its direct costs belong to
 *    the month its last piece was delivered (latest valid delivery date of a
 *    COMPLETED order). Open orders are not in any month yet (work in progress).
 *  - BOOKING: the month the order was received (existing «received_date»
 *    convention of the order reports). Orders still open are included but
 *    flagged provisional.
 * Costs always follow their order (matching), never their own cost date —
 * so a later cost correction moves the order's month, visibly.
 */
export const RECOGNITION_BASES = ["DELIVERY", "BOOKING"] as const;
export type RecognitionBasis = (typeof RECOGNITION_BASES)[number];
export const BASIS_LABELS: Record<RecognitionBasis, string> = {
  DELIVERY: "بتاريخ التسليم الكامل (الأساس الرسمي)",
  BOOKING: "بتاريخ استلام الأوردر (عرض إداري مبدئي)",
};
