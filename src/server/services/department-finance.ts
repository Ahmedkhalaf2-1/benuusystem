import type { Prisma } from "@/generated/prisma/client";
import type { OrderPricing, OrderStatus } from "@/generated/prisma/enums";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString } from "@/lib/dates";
import { allocateAmount, attributeItem, orderBasis, shareStatus, UNALLOCATED, type BasisItem, type ShareStatus } from "@/lib/finance/allocation";
import { centsToDecimalString, toCents } from "@/lib/money";

/**
 * Department money, derived from the existing orders and customer payments.
 *
 * - Work value: each item's value counts once — for its department, or split
 *   by the owner's explicit shares (src/lib/finance/allocation.ts).
 * - Allocated collections: every VALID customer payment of the order split
 *   pro-rata over those values (largest remainder, exact piasters). Voided
 *   payments are excluded; the payment rows are never changed; no treasury
 *   transaction is created. This is NOT money paid to any partner.
 * - Whatever can't be attributed reliably (no department, stale split, older
 *   single-total orders) stays UNALLOCATED — never pushed into a department.
 */

const FINANCE_ORDER_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  pricing: true,
  totalPrice: true,
  receivedDate: true,
  customer: { select: { name: true } },
  groups: {
    orderBy: { position: "asc" },
    select: { id: true, position: true, name: true, quantity: true, unitPrice: true, departmentId: true, valueShares: { select: { departmentId: true, amount: true } } },
  },
  payments: { where: { voidedAt: null }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }], select: { id: true, amount: true, paidAt: true, isAdvance: true } },
} as const satisfies Prisma.OrderSelect;

type FinanceOrder = Prisma.OrderGetPayload<{ select: typeof FINANCE_ORDER_SELECT }>;

export type Allocation = { paymentId: string; paidAt: string; isAdvance: boolean; amount: bigint };

export type OrderBucketFinance = {
  /** Value attributed to the bucket (0 for cancelled orders). */
  value: bigint;
  /** Σ of this bucket's allocated share of every valid payment. */
  collected: bigint;
  allocations: Allocation[];
};

export type OrderFinance = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  status: OrderStatus;
  pricing: OrderPricing;
  receivedDate: string;
  total: bigint;
  paid: bigint;
  buckets: Map<string, OrderBucketFinance>;
  /** Per item: where its value went (for "can't be allocated reliably" flags). */
  items: { id: string; position: number; name: string | null; departmentId: string | null; attribution: ReturnType<typeof attributeItem> }[];
};

export async function departmentSortOrder(db: DbClient): Promise<(id: string) => number> {
  const rows = await db.department.findMany({ select: { id: true, sortOrder: true } });
  const map = new Map(rows.map((r) => [r.id, r.sortOrder]));
  return (id) => map.get(id) ?? Number.MAX_SAFE_INTEGER;
}

function basisItems(order: FinanceOrder): BasisItem[] {
  return order.groups.map((g) => ({
    id: g.id,
    lineValue: order.pricing === "PER_ITEM" && g.unitPrice !== null ? BigInt(g.quantity) * toCents(g.unitPrice) : null,
    departmentId: g.departmentId,
    shares: g.valueShares.map((s) => ({ departmentId: s.departmentId, amount: toCents(s.amount) })),
  }));
}

/** One order's money per bucket (department id or UNALLOCATED). */
export function financeOfOrder(order: FinanceOrder, sortOrder: (id: string) => number): OrderFinance {
  const items = basisItems(order);
  const total = toCents(order.totalPrice);
  const basis = orderBasis({ pricing: order.pricing, total, items }, sortOrder);
  const cancelled = order.status === "CANCELLED";
  const buckets = new Map<string, OrderBucketFinance>(basis.map((b) => [b.key, { value: cancelled ? 0n : b.weight, collected: 0n, allocations: [] }]));
  let paid = 0n;
  for (const p of order.payments) {
    const amount = toCents(p.amount);
    paid += amount;
    for (const [key, share] of allocateAmount(amount, basis)) {
      if (!buckets.has(key)) buckets.set(key, { value: 0n, collected: 0n, allocations: [] });
      const b = buckets.get(key)!;
      b.collected += share;
      if (share > 0n) b.allocations.push({ paymentId: p.id, paidAt: dateToString(p.paidAt), isAdvance: p.isAdvance, amount: share });
    }
  }
  return {
    orderId: order.id,
    number: order.number,
    title: order.title,
    customerName: order.customer.name,
    status: order.status,
    pricing: order.pricing,
    receivedDate: dateToString(order.receivedDate),
    total,
    paid,
    buckets,
    items: order.groups.map((g, i) => ({ id: g.id, position: g.position, name: g.name, departmentId: g.departmentId, attribution: attributeItem(items[i]!) })),
  };
}

export async function loadOrderFinances(db: DbClient, where: Prisma.OrderWhereInput): Promise<OrderFinance[]> {
  const [orders, sortOrder] = await Promise.all([db.order.findMany({ where, select: FINANCE_ORDER_SELECT }), departmentSortOrder(db)]);
  return orders.map((o) => financeOfOrder(o, sortOrder));
}

/** The allocation snapshot of ONE payment amount on an order right now (for the audit log). */
export async function allocationSnapshot(db: DbClient, orderId: string, amount: bigint): Promise<Record<string, string>> {
  const [order, sortOrder] = await Promise.all([db.order.findUnique({ where: { id: orderId }, select: FINANCE_ORDER_SELECT }), departmentSortOrder(db)]);
  if (!order) return {};
  const basis = orderBasis({ pricing: order.pricing, total: toCents(order.totalPrice), items: basisItems(order) }, sortOrder);
  const out: Record<string, string> = {};
  for (const [key, v] of allocateAmount(amount, basis)) out[key] = centsToDecimalString(v);
  return out;
}

export type DepartmentFinanceSummary = {
  workValue: bigint;
  collected: bigint;
  outstanding: bigint;
  /** Department items whose value can't be allocated reliably (no item price, stale split). */
  unreliableItems: number;
  orders: Record<ShareStatus, number>;
  history: (Allocation & { orderId: string; orderNumber: number; orderTitle: string })[];
  perOrder: Map<string, { value: bigint; collected: bigint; status: ShareStatus; allocations: Allocation[] }>;
};

/** Sums one bucket across orders. */
export function summarizeBucket(finances: OrderFinance[], key: string): DepartmentFinanceSummary {
  const summary: DepartmentFinanceSummary = { workValue: 0n, collected: 0n, outstanding: 0n, unreliableItems: 0, orders: { PAID: 0, PARTIAL: 0, UNPAID: 0 }, history: [], perOrder: new Map() };
  for (const f of finances) {
    if (key !== UNALLOCATED && f.status !== "CANCELLED") {
      summary.unreliableItems += f.items.filter((i) => i.departmentId === key && i.attribution.kind === "unallocated").length;
    }
    const b = f.buckets.get(key);
    if (!b) continue;
    summary.workValue += b.value;
    summary.collected += b.collected;
    const status = shareStatus(b.value, b.collected);
    if (f.status !== "CANCELLED" && b.value > 0n) summary.orders[status] += 1;
    summary.perOrder.set(f.orderId, { value: b.value, collected: b.collected, status, allocations: b.allocations });
    for (const a of b.allocations) summary.history.push({ ...a, orderId: f.orderId, orderNumber: f.number, orderTitle: f.title });
  }
  summary.outstanding = summary.workValue - summary.collected;
  summary.history.sort((a, b) => (a.paidAt === b.paidAt ? b.orderNumber - a.orderNumber : a.paidAt < b.paidAt ? 1 : -1));
  return summary;
}
