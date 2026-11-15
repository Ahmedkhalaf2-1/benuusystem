import type { OrderStatus } from "@/generated/prisma/enums";
import type { Cents } from "@/lib/money";

/**
 * Customer-facing money figures for invoices, order summaries and account
 * statements. Pure functions over exact piasters (bigint), so the same rules
 * are tested once and shared by every document.
 *
 * Rules (the same as the customer and order screens and the receivables report):
 * - An order's charge is its CURRENT agreed total price.
 * - Only valid payments count; voided payments are excluded everywhere.
 * - A cancelled order is not owed. Money already paid on it is NOT netted
 *   against other orders: there is no refund event in the system, so it is
 *   reported as "needs a decision" (refund or customer credit).
 * - An over-paid active order shows the excess as a credit, not a negative
 *   outstanding.
 */

export type DocPayment = {
  id: string;
  amount: Cents;
  /** "YYYY-MM-DD" (business date the money was received). */
  paidAt: string;
  method: string;
  isAdvance: boolean;
  /** For a stable order between payments on the same day. */
  createdAt: Date;
};

export type DocOrder = {
  id: string;
  number: number;
  title: string;
  productType: string;
  status: OrderStatus;
  totalPrice: Cents;
  /** "YYYY-MM-DD" — the order date used for periods and the ledger. */
  receivedDate: string;
  /** Valid (not voided) payments only. */
  payments: DocPayment[];
};

export type OrderBalance = {
  cancelled: boolean;
  /** Agreed total (0 for a cancelled order: it is not owed). */
  charged: Cents;
  paid: Cents;
  /** Still owed by the customer (never negative). */
  outstanding: Cents;
  /** Paid above the agreed total on an active order. */
  overpaid: Cents;
  /** Paid on a cancelled order — refund or credit still to be decided. */
  paidOnCancelled: Cents;
};

export function sumPayments(payments: readonly DocPayment[]): Cents {
  return payments.reduce((sum, p) => sum + p.amount, 0n);
}

export function orderBalance(order: Pick<DocOrder, "status" | "totalPrice" | "payments">): OrderBalance {
  const paid = sumPayments(order.payments);
  if (order.status === "CANCELLED") {
    return { cancelled: true, charged: 0n, paid, outstanding: 0n, overpaid: 0n, paidOnCancelled: paid };
  }
  const diff = order.totalPrice - paid;
  return {
    cancelled: false,
    charged: order.totalPrice,
    paid,
    outstanding: diff > 0n ? diff : 0n,
    overpaid: diff < 0n ? -diff : 0n,
    paidOnCancelled: 0n,
  };
}

export type OrdersTotals = {
  /** Active (not cancelled) orders. */
  activeCount: number;
  cancelledCount: number;
  /** Sum of agreed totals of active orders. */
  agreed: Cents;
  /** Valid payments on active orders. */
  paid: Cents;
  /**
   * agreed − paid over active orders: the customer screen's «المتبقي عليه».
   * Over-payments on one order reduce it (see `overpaid`).
   */
  net: Cents;
  /** Sum of per-order outstanding amounts (what is actually still due). */
  outstanding: Cents;
  /** Sum of over-payments on active orders (customer credit). */
  overpaid: Cents;
  /** Valid payments on cancelled orders — refund or credit to be decided. */
  paidOnCancelled: Cents;
};

export function totalsFor(orders: readonly DocOrder[]): OrdersTotals {
  const t: OrdersTotals = { activeCount: 0, cancelledCount: 0, agreed: 0n, paid: 0n, net: 0n, outstanding: 0n, overpaid: 0n, paidOnCancelled: 0n };
  for (const order of orders) {
    const b = orderBalance(order);
    if (b.cancelled) {
      t.cancelledCount += 1;
      t.paidOnCancelled += b.paidOnCancelled;
      continue;
    }
    t.activeCount += 1;
    t.agreed += b.charged;
    t.paid += b.paid;
    t.outstanding += b.outstanding;
    t.overpaid += b.overpaid;
  }
  t.net = t.agreed - t.paid;
  return t;
}

export type Period = { from?: string; to?: string };

export function inPeriod(date: string, period: Period): boolean {
  return (!period.from || date >= period.from) && (!period.to || date <= period.to);
}

export type LedgerEntry = {
  date: string;
  kind: "charge" | "payment";
  orderNumber: number;
  /** Order title for charges; payment method (and «مقدم») for payments. */
  orderTitle: string;
  method?: string;
  isAdvance?: boolean;
  /** Payment received on an order that is now cancelled. */
  onCancelledOrder?: boolean;
  debit: Cents;
  credit: Cents;
  /** Positive = the customer owes; negative = the customer is in credit. */
  balance: Cents;
};

export type Statement = {
  period: Period;
  /** Balance of all entries dated before `period.from` (0 without a start date). */
  opening: Cents;
  entries: LedgerEntry[];
  totalDebit: Cents;
  totalCredit: Cents;
  closing: Cents;
  /** Payments inside the period that sit on cancelled orders. */
  paidOnCancelledInPeriod: Cents;
  /** All payments on cancelled orders up to the period end (part of `closing`). */
  paidOnCancelledToDate: Cents;
};

/**
 * Chronological ledger built from current records: one charge per active
 * order (its current agreed total, on its order date) and one credit per
 * valid payment (on its payment date). Payments on cancelled orders stay in
 * the ledger — the money was received — and show up as customer credit.
 */
export function buildStatement(orders: readonly DocOrder[], period: Period): Statement {
  type Raw = Omit<LedgerEntry, "balance"> & { sort: string };
  const raw: Raw[] = [];
  for (const order of orders) {
    const cancelled = order.status === "CANCELLED";
    if (!cancelled) {
      raw.push({
        date: order.receivedDate,
        kind: "charge",
        orderNumber: order.number,
        orderTitle: order.title,
        debit: order.totalPrice,
        credit: 0n,
        sort: `${order.receivedDate}|0|${String(order.number).padStart(8, "0")}`,
      });
    }
    for (const p of order.payments) {
      raw.push({
        date: p.paidAt,
        kind: "payment",
        orderNumber: order.number,
        orderTitle: order.title,
        method: p.method,
        isAdvance: p.isAdvance,
        onCancelledOrder: cancelled,
        debit: 0n,
        credit: p.amount,
        // Same day: the charge comes first, then payments in recording order.
        sort: `${p.paidAt}|1|${p.createdAt.toISOString()}|${p.id}`,
      });
    }
  }
  raw.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  let opening = 0n;
  let balance = 0n;
  const entries: LedgerEntry[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  let paidOnCancelledInPeriod = 0n;
  let paidOnCancelledToDate = 0n;
  for (const { sort, ...e } of raw) {
    void sort;
    if (period.to && e.date > period.to) continue;
    if (e.onCancelledOrder) paidOnCancelledToDate += e.credit;
    if (period.from && e.date < period.from) {
      opening += e.debit - e.credit;
      continue;
    }
    if (entries.length === 0) balance = opening;
    balance += e.debit - e.credit;
    totalDebit += e.debit;
    totalCredit += e.credit;
    if (e.onCancelledOrder) paidOnCancelledInPeriod += e.credit;
    entries.push({ ...e, balance });
  }
  return {
    period,
    opening,
    entries,
    totalDebit,
    totalCredit,
    closing: opening + totalDebit - totalCredit,
    paidOnCancelledInPeriod,
    paidOnCancelledToDate,
  };
}
