import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CostCategory, CostReviewStatus, ExpenseCategory, OrderStatus } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { UNALLOCATED } from "@/lib/finance/allocation";
import { EXPENSE_CATEGORIES } from "@/lib/finance/labels";
import {
  computeProfitability,
  isValidMonth,
  marginPercent,
  monthBounds,
  RECOGNITION_BASES,
  type Profitability,
  type ProvisionalReason,
  type RecognitionBasis,
} from "@/lib/finance/profitability";
import { centsToDecimalString, MAX_CENTS, parseMoney, toCents, type Cents } from "@/lib/money";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { loadOrderFinances } from "./department-finance";
import { laborByOrders, laborSharesInRange } from "./labor-service";
import { getWorkerObligations } from "./reports-service";
import { balanceAt, loadAccounts, loadEntries, type LedgerEntry } from "./treasury-service";

/**
 * Order profitability and the monthly financial closing («قفل الشهر»).
 *
 * Read-only over the existing records — no new ledger. Every figure is
 * derived from: orders (selling value), order_costs (booked vs draft),
 * labour allocation (worker days split by work logs), general_expenses,
 * order_payments / outgoing_payments (cash), and the treasury ledger.
 * The only writes are the owner's review (monthly_closes + events), fixed
 * expense templates, and generating a month's fixed expense rows.
 *
 * Accounting period rules (see docs/monthly-closing.md):
 *   - Order revenue AND its direct costs (booked costs + allocated labour)
 *     are recognized together in ONE month, chosen by the basis
 *     (DELIVERY default: month of the last valid delivery of a completed
 *     order; BOOKING: month the order was received).
 *   - Booked costs of CANCELLED orders: a loss in the month of the cost date.
 *   - General expenses: month of expense_date (recognition), split fixed /
 *     operating. Their payments are cash only.
 *   - Labour NOT allocated to any order: month of the work date.
 *   - Cash figures: by payment date. Treasury: the existing ledger.
 */

const money = (c: Cents) => centsToDecimalString(c);

function guardOrder(actor: Actor) {
  assertPermission(actor, "finance:reports");
  assertPermission(actor, "costs:view");
  assertPermission(actor, "labor:view");
}

/** Company-wide figures (treasury, expenses, every order): owner only. */
function guardMonthly(actor: Actor) {
  guardOrder(actor);
  assertPermission(actor, "treasury:manage");
  assertPermission(actor, "expenses:view");
}

function bad(field: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", message, { fieldErrors: { [field]: [message] } });
}

// ───────────────────────────── Shared order loading ─────────────────────────────

type OrderRow = {
  id: string;
  number: number;
  title: string;
  customerName: string;
  status: OrderStatus;
  costStatus: CostReviewStatus | null;
  receivedDate: string;
  price: Cents;
  completionDate: string | null;
  costs: { category: CostCategory; amount: Cents; isDraft: boolean; departmentId: string | null }[];
  collected: Cents;
};

async function loadOrders(db: DbClient, ids: string[]): Promise<OrderRow[]> {
  if (ids.length === 0) return [];
  const [orders, payments, deliveries] = await Promise.all([
    db.order.findMany({
      where: { id: { in: ids } },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        costStatus: true,
        receivedDate: true,
        totalPrice: true,
        customer: { select: { name: true } },
        costs: { where: { voidedAt: null }, select: { category: true, amount: true, isDraft: true, departmentId: true, orderGroup: { select: { departmentId: true } } } },
      },
    }),
    db.orderPayment.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, voidedAt: null }, _sum: { amount: true } }),
    db.delivery.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, voidedAt: null }, _max: { deliveredAt: true } }),
  ]);
  const paid = new Map(payments.map((p) => [p.orderId, toCents(p._sum.amount)]));
  const lastDelivery = new Map(deliveries.map((d) => [d.orderId, d._max.deliveredAt ? dateToString(d._max.deliveredAt) : null]));
  return orders.map((o) => ({
    id: o.id,
    number: o.number,
    title: o.title,
    customerName: o.customer.name,
    status: o.status,
    costStatus: o.costStatus,
    receivedDate: dateToString(o.receivedDate),
    price: toCents(o.totalPrice),
    completionDate: o.status === "COMPLETED" ? (lastDelivery.get(o.id) ?? null) : null,
    costs: o.costs.map((c) => ({ category: c.category, amount: toCents(c.amount), isDraft: c.isDraft, departmentId: c.departmentId ?? c.orderGroup?.departmentId ?? null })),
    collected: paid.get(o.id) ?? 0n,
  }));
}

function profitOf(o: OrderRow, labor: Cents): Profitability {
  return computeProfitability({
    price: o.price,
    cancelled: o.status === "CANCELLED",
    delivered: o.status === "COMPLETED",
    costStatus: o.costStatus,
    costs: o.costs,
    labor,
    collected: o.collected,
  });
}

// ───────────────────────────── One order ─────────────────────────────

export type OrderProfitabilityView = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  status: OrderStatus;
  costStatus: CostReviewStatus | null;
  completionDate: string | null;
  revenue: string;
  materials: string;
  production: string;
  labor: string;
  otherDirect: string;
  directCosts: string;
  draftCosts: string;
  grossProfit: string;
  margin: string | null;
  expectedProfit: string;
  collected: string;
  outstanding: string;
  overpaid: string;
  provisional: boolean;
  reasons: ProvisionalReason[];
};

function view(o: OrderRow, p: Profitability): OrderProfitabilityView {
  return {
    orderId: o.id,
    number: o.number,
    title: o.title,
    customerName: o.customerName,
    status: o.status,
    costStatus: o.costStatus,
    completionDate: o.completionDate,
    revenue: money(p.revenue),
    materials: money(p.materials),
    production: money(p.production),
    labor: money(p.labor),
    otherDirect: money(p.otherDirect),
    directCosts: money(p.directCosts),
    draftCosts: money(p.draftCosts),
    grossProfit: money(p.grossProfit),
    margin: p.margin,
    expectedProfit: money(p.expectedProfit),
    collected: money(p.collected),
    outstanding: money(p.outstanding),
    overpaid: money(p.overpaid),
    provisional: p.provisional,
    reasons: p.reasons,
  };
}

/** Profitability of one order (owner). Null when the order does not exist. */
export async function getOrderProfitability(db: DbClient, actor: Actor, orderId: string): Promise<OrderProfitabilityView | null> {
  guardOrder(actor);
  const [o] = await loadOrders(db, [orderId]);
  if (!o) return null;
  const labor = (await laborByOrders(db, actor, [orderId])).get(orderId) ?? 0n;
  return view(o, profitOf(o, labor));
}

// ───────────────────────────── Monthly closing ─────────────────────────────

export type MonthlyOrderRow = OrderProfitabilityView & {
  /** Department view: the department's part of revenue / costs. */
  paymentStatus: "PAID" | "PARTIAL" | "UNPAID" | "NONE";
  /** Department view only: some of this order's costs could not be attributed to the department. */
  splitUnreliable?: boolean;
};

export type TreasuryPanel = {
  /** No account had a known balance during the month. */
  available: boolean;
  opening: string;
  /** Opening balances of accounts first counted during the month. */
  newAccountsOpening: string;
  customerCollections: string;
  capitalIn: string;
  adjustmentsIn: string;
  otherIn: string;
  supplierPayments: string;
  expensePayments: string;
  workerPayments: string;
  drawings: string;
  adjustmentsOut: string;
  otherOut: string;
  /** Between the business's own accounts — not income, not expense. */
  internalTransfers: string;
  calculatedClosing: string;
  ledgerClosing: string;
  /** calculated − ledger. Never adjusted silently. */
  discrepancy: string;
  accounts: { id: string; name: string; opening: string | null; closing: string }[];
  /** Valid payments in the month with no treasury account (after the cutover). */
  unattributed: { count: number; total: string };
  /** Counts in the month whose difference is still open against the books. */
  openCounts: { accountName: string; date: string; counted: string; system: string; difference: string }[];
};

export type MonthlyClosing = {
  month: string;
  from: string;
  to: string;
  basis: RecognitionBasis;
  departmentId: string | null;
  monthEnded: boolean;
  pnl: {
    revenue: string;
    materials: string;
    production: string;
    labor: string;
    otherDirect: string;
    directCosts: string;
    grossProfit: string;
    grossMargin: string | null;
    /** Booked costs of cancelled orders, by cost date. */
    cancelledOrderCosts: string;
    /** Wages allocated to cancelled orders, by work date (incurred, so never dropped). */
    cancelledOrderLabor: string;
    /** cancelledOrderCosts + cancelledOrderLabor. */
    cancellationLosses: string;
    operatingExpenses: string;
    fixedExpenses: string;
    /** Worker wages of the month not allocated to any order. */
    unallocatedLabor: string;
    netOperatingProfit: string;
    netMargin: string | null;
    /** Drafts on the recognized orders (not in profit). */
    draftCosts: string;
    /** Booked costs dated this month on orders recognized in another month (work in progress). */
    deferredCosts: string;
    /** Department view: costs of shared orders that could not be attributed to the department. */
    unattributedCosts?: string;
    /** Department view: value of the month's orders that no department can claim reliably (one total price, missing item price, stale split). */
    unallocatedRevenue?: string;
    unallocatedOrders?: number;
  };
  /**
   * Wages earned in the month (by work date), split exactly once:
   * earned = withOrdersThisMonth + cancelled + unallocated + deferred.
   * «deferred» = wages on orders recognized in another month (or not yet): they
   * are counted in THAT order's month as part of its direct costs.
   */
  laborCheck: { earned: string; withOrdersThisMonth: string; cancelled: string; unallocated: string; deferred: string };
  /** Unresolved money on orders as of month end (no refund workflow exists — nothing is settled automatically). */
  unresolved: { orderId: string; number: number; title: string; kind: "CANCELLED_WITH_PAYMENTS" | "OVERPAID"; amount: string }[];
  /** Corrections made AFTER the month ended that change its figures (restatements), from the audit trail and void records. */
  restatements: { kind: "PAYMENT_VOIDED" | "SUPPLIER_PAYMENT_VOIDED" | "COST_AMENDED" | "COST_VOIDED" | "ORDER_PRICE_CHANGED" | "ORDER_STATUS_CHANGED" | "DELIVERY_VOIDED"; count: number }[];
  /** True only when nothing material is unresolved (treasury, attribution, counts, refunds). */
  reconciled: boolean;
  cash: { customerCollections: string; collectionsCount: number; supplierPayments: string; expensePayments: string; workerPayments: string };
  balances: { receivables: string; supplierPayables: string; looseCostPayables: string; expensePayables: string; workersOwed: string };
  orders: MonthlyOrderRow[];
  expenses: { id: string; category: ExpenseCategory; description: string | null; date: string; amount: string; paid: string; isFixed: boolean }[];
  cancelledCosts: { orderId: string; number: number; title: string; costs: string; labor: string; amount: string }[];
  treasury: TreasuryPanel | null;
  checks: {
    costReviewOpen: number;
    withDrafts: number;
    notDelivered: number;
    completedWithoutDelivery: { id: string; number: number; title: string }[];
    unattributedPayments: number;
    treasuryDiscrepancy: boolean;
    openCounts: number;
    fixedNotGenerated: number;
    unresolvedRefunds: number;
    zeroRevenue: number;
    negativeProfit: number;
  };
  close: CloseState;
};

export type CloseSnapshot = Record<string, string | number | null>;
export type CloseState = {
  status: "OPEN" | "CONFIRMED" | "CHANGED" | "REOPENED";
  version: number;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  basis: string | null;
  notes: string | null;
  /** Figures that differ from the confirmed snapshot. */
  changes: { key: string; confirmed: string | number | null; now: string | number | null }[];
  events: { action: string; reason: string | null; by: string; at: Date }[];
};

function addDays(day: string, n: number) {
  return dateToString(new Date(dateFromString(day).getTime() + n * 86_400_000));
}

/** Order ids recognized in the month under the basis (never archived, never cancelled). */
async function recognizedOrderIds(db: DbClient, basis: RecognitionBasis, from: string, to: string): Promise<string[]> {
  if (basis === "BOOKING") {
    const rows = await db.order.findMany({ where: { archivedAt: null, status: { not: "CANCELLED" }, receivedDate: { gte: dateFromString(from), lte: dateFromString(to) } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM orders o
    JOIN deliveries d ON d.order_id = o.id AND d.voided_at IS NULL
    WHERE o.status = 'COMPLETED' AND o.archived_at IS NULL
    GROUP BY o.id
    HAVING MAX(d.delivered_at) BETWEEN ${dateFromString(from)} AND ${dateFromString(to)}`;
  return rows.map((r) => r.id);
}

function payStatus(revenue: Cents, collected: Cents): MonthlyOrderRow["paymentStatus"] {
  if (revenue <= 0n) return "NONE";
  if (collected >= revenue) return "PAID";
  return collected > 0n ? "PARTIAL" : "UNPAID";
}

export async function getMonthlyClosing(db: DbClient, actor: Actor, opts: { month: string; basis?: string; departmentId?: string | null }): Promise<MonthlyClosing> {
  guardMonthly(actor);
  if (!isValidMonth(opts.month)) throw new AppError("VALIDATION_ERROR", "اختار شهر صحيح");
  const basis: RecognitionBasis = (RECOGNITION_BASES as readonly string[]).includes(opts.basis ?? "") ? (opts.basis as RecognitionBasis) : "DELIVERY";
  const { from, to } = monthBounds(opts.month);
  const range = { gte: dateFromString(from), lte: dateFromString(to) };
  const today = todayDateString();
  const departmentId = opts.departmentId || null;
  if (departmentId && !(await db.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) throw new AppError("NOT_FOUND");

  const ids = await recognizedOrderIds(db, basis, from, to);
  const [orders, labor, expensesRows, cancelledCostRows, deferredRows, laborMonth, completedNoDelivery] = await Promise.all([
    loadOrders(db, ids),
    laborByOrders(db, actor, ids),
    db.generalExpense.findMany({
      where: { voidedAt: null, expenseDate: range },
      orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, category: true, description: true, expenseDate: true, amount: true, isFixed: true, payments: { where: { voidedAt: null }, select: { amount: true } } },
    }),
    db.orderCost.findMany({
      where: { voidedAt: null, isDraft: false, costDate: range, order: { status: "CANCELLED" } },
      select: { amount: true, order: { select: { id: true, number: true, title: true } } },
    }),
    db.orderCost.aggregate({ where: { voidedAt: null, isDraft: false, costDate: range, orderId: { notIn: ids }, order: { status: { not: "CANCELLED" } } }, _sum: { amount: true } }),
    laborSharesInRange(db, actor, { from, to }),
    db.order.findMany({ where: { status: "COMPLETED", archivedAt: null, deliveries: { none: { voidedAt: null } } }, select: { id: true, number: true, title: true } }),
  ]);

  // Department view: the department's share of each order (existing allocation).
  const deptShare = new Map<string, Cents>();
  let unallocatedRevenue = 0n;
  let unallocatedOrders = 0;
  if (departmentId) {
    for (const f of await loadOrderFinances(db, { id: { in: ids } }, { lean: true })) {
      deptShare.set(f.orderId, f.buckets.get(departmentId)?.value ?? 0n);
      const loose = f.buckets.get(UNALLOCATED)?.value ?? 0n;
      if (loose > 0n) {
        unallocatedRevenue += loose;
        unallocatedOrders += 1;
      }
    }
  }

  let revenue = 0n, materials = 0n, production = 0n, laborSum = 0n, other = 0n, drafts = 0n, unattributed = 0n;
  const rows: MonthlyOrderRow[] = [];
  const counts = { costReviewOpen: 0, withDrafts: 0, notDelivered: 0, zeroRevenue: 0, negativeProfit: 0 };
  for (const o of orders) {
    const orderLabor = labor.get(o.id) ?? 0n;
    let p: Profitability;
    let splitUnreliable = false;
    if (departmentId) {
      const share = deptShare.get(o.id) ?? 0n;
      const whole = share > 0n && share === o.price;
      const mine = o.costs.filter((c) => c.departmentId === departmentId || (c.departmentId === null && whole));
      const lost = o.costs.filter((c) => !c.isDraft && c.departmentId === null && !whole).reduce((s, c) => s + c.amount, 0n) + (whole ? 0n : orderLabor);
      const hasMine = share > 0n || mine.length > 0;
      if (!hasMine) continue;
      if (lost > 0n && share > 0n) {
        splitUnreliable = true;
        unattributed += lost;
      }
      p = computeProfitability({ price: share, cancelled: false, delivered: o.status === "COMPLETED", costStatus: o.costStatus, costs: mine, labor: whole ? orderLabor : 0n, collected: 0n });
      // Collections are allocated by the existing department rule; show the order's own payment state.
      p = { ...p, collected: o.collected, outstanding: o.price > o.collected ? o.price - o.collected : 0n };
    } else {
      p = profitOf(o, orderLabor);
    }
    revenue += p.revenue;
    materials += p.materials;
    production += p.production;
    laborSum += p.labor;
    other += p.otherDirect;
    drafts += p.draftCosts;
    if (p.reasons.includes("cost-review-open")) counts.costReviewOpen += 1;
    if (p.reasons.includes("drafts")) counts.withDrafts += 1;
    if (p.reasons.includes("not-delivered")) counts.notDelivered += 1;
    if (p.revenue <= 0n) counts.zeroRevenue += 1;
    if (p.grossProfit < 0n) counts.negativeProfit += 1;
    rows.push({ ...view(o, p), paymentStatus: payStatus(o.price, o.collected), ...(departmentId ? { splitUnreliable } : {}) });
  }
  const directCosts = materials + production + laborSum + other;
  const grossProfit = revenue - directCosts;

  // Company-wide lines (not split by department: there is no reliable rule).
  const company = !departmentId;
  let operating = 0n, fixed = 0n;
  for (const e of expensesRows) {
    if (e.isFixed) fixed += toCents(e.amount);
    else operating += toCents(e.amount);
  }
  // Wages of the month: each share belongs to exactly one bucket.
  const shareOrders = laborMonth.byOrder.size ? await db.order.findMany({ where: { id: { in: [...laborMonth.byOrder.keys()] } }, select: { id: true, number: true, title: true, status: true } }) : [];
  const recognized = new Set(ids);
  const lostOrders = new Map<string, { id: string; number: number; title: string; costs: Cents; labor: Cents }>();
  let laborThisMonth = 0n, laborCancelled = 0n, laborDeferred = 0n;
  for (const o of shareOrders) {
    const cents = laborMonth.byOrder.get(o.id)!;
    if (o.status === "CANCELLED") {
      laborCancelled += cents;
      lostOrders.set(o.id, { id: o.id, number: o.number, title: o.title, costs: 0n, labor: cents });
    } else if (recognized.has(o.id)) laborThisMonth += cents;
    else laborDeferred += cents;
  }
  for (const c of cancelledCostRows) {
    const x = lostOrders.get(c.order.id) ?? { ...c.order, costs: 0n, labor: 0n };
    x.costs += toCents(c.amount);
    lostOrders.set(c.order.id, x);
  }
  const cancelledCosts = company ? cancelledCostRows.reduce((s, c) => s + toCents(c.amount), 0n) : 0n;
  const cancelledLabor = company ? laborCancelled : 0n;
  const unallocatedLabor = company ? laborMonth.unallocated : 0n;
  const net = company ? grossProfit - cancelledCosts - cancelledLabor - operating - fixed - unallocatedLabor : grossProfit;

  const [cash, balances, treasury, fixedNotGenerated, close, unresolved, restatements] = await Promise.all([
    monthCash(db, range),
    monthEndBalances(db, actor, to),
    company ? treasuryPanel(db, from, to) : null,
    pendingFixedCount(db, opts.month, today),
    company ? closeState(db, opts.month) : null,
    unresolvedAsOf(db, to),
    restatementsAfter(db, to, ids),
  ]);

  const result: MonthlyClosing = {
    month: opts.month,
    from,
    to,
    basis,
    departmentId,
    monthEnded: to < today,
    pnl: {
      revenue: money(revenue),
      materials: money(materials),
      production: money(production),
      labor: money(laborSum),
      otherDirect: money(other),
      directCosts: money(directCosts),
      grossProfit: money(grossProfit),
      grossMargin: marginPercent(grossProfit, revenue),
      cancelledOrderCosts: money(cancelledCosts),
      cancelledOrderLabor: money(cancelledLabor),
      cancellationLosses: money(cancelledCosts + cancelledLabor),
      operatingExpenses: money(company ? operating : 0n),
      fixedExpenses: money(company ? fixed : 0n),
      unallocatedLabor: money(unallocatedLabor),
      netOperatingProfit: money(net),
      netMargin: marginPercent(net, revenue),
      draftCosts: money(drafts),
      deferredCosts: money(company ? toCents(deferredRows._sum.amount) : 0n),
      ...(departmentId ? { unattributedCosts: money(unattributed), unallocatedRevenue: money(unallocatedRevenue), unallocatedOrders } : {}),
    },
    laborCheck: {
      earned: money(laborMonth.earned),
      withOrdersThisMonth: money(laborThisMonth),
      cancelled: money(laborCancelled),
      unallocated: money(laborMonth.unallocated),
      deferred: money(laborDeferred),
    },
    unresolved,
    restatements,
    reconciled: false,
    cash,
    balances,
    orders: rows,
    expenses: company
      ? expensesRows.map((e) => ({
          id: e.id,
          category: e.category,
          description: e.description,
          date: dateToString(e.expenseDate),
          amount: money(toCents(e.amount)),
          paid: money(e.payments.reduce((s, p) => s + toCents(p.amount), 0n)),
          isFixed: e.isFixed,
        }))
      : [],
    cancelledCosts: company
      ? [...lostOrders.values()].sort((a, b) => a.number - b.number).map((c) => ({ orderId: c.id, number: c.number, title: c.title, costs: money(c.costs), labor: money(c.labor), amount: money(c.costs + c.labor) }))
      : [],
    treasury,
    checks: {
      ...counts,
      completedWithoutDelivery: completedNoDelivery,
      unattributedPayments: treasury?.unattributed.count ?? 0,
      treasuryDiscrepancy: treasury ? toCents(treasury.discrepancy) !== 0n : false,
      openCounts: treasury?.openCounts.length ?? 0,
      fixedNotGenerated,
      unresolvedRefunds: unresolved.length,
    },
    close: close ?? { status: "OPEN", version: 0, confirmedAt: null, confirmedBy: null, basis: null, notes: null, changes: [], events: [] },
  };
  result.reconciled = company && !!treasury && treasury.available && !result.checks.treasuryDiscrepancy && result.checks.unattributedPayments === 0 && result.checks.openCounts === 0 && unresolved.length === 0;
  if (close && (close.status === "CONFIRMED" || close.status === "CHANGED")) {
    const changes = diffSnapshot(close.snapshot, snapshotOf(result));
    result.close = { ...close, status: changes.length > 0 ? "CHANGED" : "CONFIRMED", changes };
  }
  return result;
}

/**
 * Cancelled orders that still hold customer money, and orders paid above their
 * price, as of the month end. There is no refund event: these are reported for
 * an owner decision and never netted, refunded or adjusted automatically.
 */
async function unresolvedAsOf(db: DbClient, to: string): Promise<MonthlyClosing["unresolved"]> {
  const end = dateFromString(to);
  const rows = await db.$queryRaw<{ id: string; number: number; title: string; status: OrderStatus; price: string; paid: string }[]>`
    SELECT o.id, o.number, o.title, o.status, o.total_price::text AS price, p.paid::text AS paid
    FROM orders o
    JOIN (SELECT order_id, SUM(amount) AS paid FROM order_payments WHERE voided_at IS NULL AND paid_at <= ${end} GROUP BY order_id) p ON p.order_id = o.id
    WHERE (o.status = 'CANCELLED' AND p.paid > 0) OR (o.status <> 'CANCELLED' AND p.paid > o.total_price)
    ORDER BY o.number`;
  return rows.map((r) =>
    r.status === "CANCELLED"
      ? { orderId: r.id, number: r.number, title: r.title, kind: "CANCELLED_WITH_PAYMENTS" as const, amount: money(toCents(r.paid)) }
      : { orderId: r.id, number: r.number, title: r.title, kind: "OVERPAID" as const, amount: money(toCents(r.paid) - toCents(r.price)) },
  );
}

/**
 * Corrections recorded after the month ended that change its figures. Voids and
 * amendments keep their audit (who, when, why); the month is recomputed from
 * the corrected records and these counts explain the restatement.
 */
async function restatementsAfter(db: DbClient, to: string, recognizedIds: string[]): Promise<MonthlyClosing["restatements"]> {
  const end = dateFromString(to);
  const next = addDays(to, 1);
  const ids = recognizedIds.length ? recognizedIds : ["00000000-0000-0000-0000-000000000000"];
  const [r] = await db.$queryRaw<{ pv: number; sv: number; ca: number; cv: number; pc: number; sc: number; dv: number }[]>`
    WITH cutoff AS (SELECT (${next}::date)::timestamp AT TIME ZONE 'Africa/Cairo' AS ts)
    SELECT
      (SELECT COUNT(*)::int FROM order_payments, cutoff WHERE paid_at <= ${end} AND voided_at >= cutoff.ts) AS pv,
      (SELECT COUNT(*)::int FROM outgoing_payments, cutoff WHERE paid_at <= ${end} AND voided_at >= cutoff.ts) AS sv,
      (SELECT COUNT(*)::int FROM order_cost_revisions r JOIN order_costs c ON c.id = r.order_cost_id, cutoff
        WHERE r.created_at >= cutoff.ts AND (c.order_id = ANY(${ids}::uuid[]) OR c.cost_date <= ${end})) AS ca,
      (SELECT COUNT(*)::int FROM order_costs c, cutoff
        WHERE c.voided_at >= cutoff.ts AND c.is_draft = false AND (c.order_id = ANY(${ids}::uuid[]) OR c.cost_date <= ${end})) AS cv,
      (SELECT COUNT(*)::int FROM audit_logs a JOIN orders o ON a.entity_id = o.id::text, cutoff
        WHERE a.action = 'ORDER_PRICE_CHANGED' AND a.created_at >= cutoff.ts AND o.received_date <= ${end}) AS pc,
      (SELECT COUNT(*)::int FROM audit_logs a JOIN orders o ON a.entity_id = o.id::text, cutoff
        WHERE a.action = 'ORDER_STATUS_CHANGED' AND a.created_at >= cutoff.ts AND o.received_date <= ${end}) AS sc,
      (SELECT COUNT(*)::int FROM deliveries, cutoff WHERE delivered_at <= ${end} AND voided_at >= cutoff.ts) AS dv`;
  const all = [
    ["PAYMENT_VOIDED", r!.pv],
    ["SUPPLIER_PAYMENT_VOIDED", r!.sv],
    ["COST_AMENDED", r!.ca],
    ["COST_VOIDED", r!.cv],
    ["ORDER_PRICE_CHANGED", r!.pc],
    ["ORDER_STATUS_CHANGED", r!.sc],
    ["DELIVERY_VOIDED", r!.dv],
  ] as const;
  return all.filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count }));
}

async function monthCash(db: DbClient, range: { gte: Date; lte: Date }) {
  const out = (where: object) => db.outgoingPayment.aggregate({ where: { voidedAt: null, paidAt: range, ...where }, _sum: { amount: true } });
  const [cin, sup, exp, wrk] = await Promise.all([
    db.orderPayment.aggregate({ where: { voidedAt: null, paidAt: range }, _sum: { amount: true }, _count: { _all: true } }),
    out({ orderCostId: { not: null } }),
    out({ expenseId: { not: null } }),
    out({ workerId: { not: null } }),
  ]);
  return {
    customerCollections: money(toCents(cin._sum.amount)),
    collectionsCount: cin._count._all,
    supplierPayments: money(toCents(sup._sum.amount)),
    expensePayments: money(toCents(exp._sum.amount)),
    workerPayments: money(toCents(wrk._sum.amount)),
  };
}

/** What was owed, both ways, at the END of the month (records dated ≤ end; payments ≤ end). */
async function monthEndBalances(db: DbClient, actor: Actor, to: string) {
  const end = dateFromString(to);
  const [recv, suppliers, loose, expenses, workers] = await Promise.all([
    db.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(GREATEST(o.total_price - COALESCE((SELECT SUM(p.amount) FROM order_payments p WHERE p.order_id = o.id AND p.voided_at IS NULL AND p.paid_at <= ${end}), 0), 0))::text AS total
      FROM orders o WHERE o.archived_at IS NULL AND o.status <> 'CANCELLED' AND o.received_date <= ${end}`,
    // Booked by the end of the month (posting time in Cairo) − paid by then; per supplier, only what we still owe.
    db.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(GREATEST(x.owed, 0))::text AS total FROM (
        SELECT c.supplier_id, SUM(c.amount - COALESCE((SELECT SUM(p.amount) FROM outgoing_payments p WHERE p.order_cost_id = c.id AND p.voided_at IS NULL AND p.paid_at <= ${end}), 0)) AS owed
        FROM order_costs c
        WHERE c.voided_at IS NULL AND c.is_draft = false AND c.supplier_id IS NOT NULL
          AND (c.posted_at AT TIME ZONE 'Africa/Cairo')::date <= ${end}
        GROUP BY c.supplier_id) x`,
    db.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(GREATEST(c.amount - COALESCE((SELECT SUM(p.amount) FROM outgoing_payments p WHERE p.order_cost_id = c.id AND p.voided_at IS NULL AND p.paid_at <= ${end}), 0), 0))::text AS total
      FROM order_costs c
      WHERE c.voided_at IS NULL AND c.is_draft = false AND c.supplier_id IS NULL AND (c.posted_at AT TIME ZONE 'Africa/Cairo')::date <= ${end}`,
    db.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(GREATEST(e.amount - COALESCE((SELECT SUM(p.amount) FROM outgoing_payments p WHERE p.expense_id = e.id AND p.voided_at IS NULL AND p.paid_at <= ${end}), 0), 0))::text AS total
      FROM general_expenses e WHERE e.voided_at IS NULL AND e.expense_date <= ${end}`,
    getWorkerObligations(db, actor, to),
  ]);
  const t = (r: { total: string | null }[]) => money(toCents(r[0]?.total ?? "0"));
  return { receivables: t(recv), supplierPayables: t(suppliers), looseCostPayables: t(loose), expensePayables: t(expenses), workersOwed: workers.totals.owedToWorkers };
}

/** Opening → flows → closing for every account with a known balance in the month, reconciled to the ledger. */
async function treasuryPanel(db: DbClient, from: string, to: string): Promise<TreasuryPanel> {
  const accounts = await loadAccounts(db);
  const dayBefore = addDays(from, -1);
  const included = accounts.filter((a) => a.knownFrom <= to);
  const entries = await loadEntries(db, accounts, to);
  const z = () => 0n;
  const f = { opening: z(), newOpen: z(), collections: z(), capital: z(), adjIn: z(), otherIn: z(), supplier: z(), expense: z(), workers: z(), drawings: z(), adjOut: z(), otherOut: z(), internal: z() };
  const inMonth = new Set(included.map((a) => a.id));
  const accountRows: TreasuryPanel["accounts"] = [];
  for (const a of included) {
    const opening = a.knownFrom <= dayBefore ? balanceAt(a, entries, dayBefore)! : null;
    if (opening === null) f.newOpen += a.openingBalance;
    else f.opening += opening;
    accountRows.push({ id: a.id, name: a.name, opening: opening === null ? null : money(opening), closing: money(balanceAt(a, entries, to)!) });
  }
  const monthEntries = entries.filter((e) => e.date >= from && e.date <= to && inMonth.has(e.accountId));
  const transferSides = new Map<string, LedgerEntry[]>();
  for (const e of monthEntries) {
    if (e.kind === "TRANSFER") {
      transferSides.set(e.movementId!, [...(transferSides.get(e.movementId!) ?? []), e]);
      continue;
    }
    switch (e.kind) {
      case "CUSTOMER_PAYMENT": f.collections += e.moneyIn; break;
      case "CAPITAL_IN": f.capital += e.moneyIn; break;
      case "SUPPLIER_OR_COST": f.supplier += e.moneyOut; break;
      case "EXPENSE": f.expense += e.moneyOut; break;
      case "WAGE": f.workers += e.moneyOut; break;
      case "DRAWING": f.drawings += e.moneyOut; break;
      case "ADJUSTMENT": f.adjIn += e.moneyIn; f.adjOut += e.moneyOut; break;
    }
  }
  for (const sides of transferSides.values()) {
    // Both sides inside the business: internal, counted in neither total.
    if (sides.length === 2) f.internal += sides[0]!.moneyIn + sides[0]!.moneyOut;
    else for (const s of sides) { f.otherIn += s.moneyIn; f.otherOut += s.moneyOut; }
  }
  const totalIn = f.collections + f.capital + f.adjIn + f.otherIn;
  const totalOut = f.supplier + f.expense + f.workers + f.drawings + f.adjOut + f.otherOut;
  const calculated = f.opening + f.newOpen + totalIn - totalOut;
  const ledger = included.reduce((s, a) => s + balanceAt(a, entries, to)!, 0n);

  // Payments in the month that should be in an account but are not (after the cutover).
  const cutover = accounts.length ? accounts.map((a) => a.openingDate).sort()[0]! : null;
  let unCount = 0, unTotal = 0n;
  if (cutover && cutover <= to) {
    const since = dateFromString(cutover > from ? cutover : from);
    const [i, o] = await Promise.all([
      db.orderPayment.aggregate({ where: { accountId: null, voidedAt: null, paidAt: { gte: since, lte: dateFromString(to) } }, _sum: { amount: true }, _count: { _all: true } }),
      db.outgoingPayment.aggregate({ where: { accountId: null, voidedAt: null, paidAt: { gte: since, lte: dateFromString(to) } }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    unCount = i._count._all + o._count._all;
    unTotal = toCents(i._sum.amount) + toCents(o._sum.amount);
  }

  // Physical counts in the month: still open when the books (now) differ from what was counted.
  const counts = await db.treasuryReconciliation.findMany({ where: { countDate: { gte: dateFromString(from), lte: dateFromString(to) } }, orderBy: { countDate: "asc" }, include: { account: { select: { name: true } } } });
  const openCounts: TreasuryPanel["openCounts"] = [];
  for (const c of counts) {
    const account = accounts.find((a) => a.id === c.accountId);
    const date = dateToString(c.countDate);
    const now = account ? balanceAt(account, entries, date) : null;
    const counted = toCents(c.countedAmount);
    if (now !== null && now !== counted) openCounts.push({ accountName: c.account.name, date, counted: money(counted), system: money(now), difference: money(counted - now) });
  }

  return {
    available: included.length > 0,
    opening: money(f.opening),
    newAccountsOpening: money(f.newOpen),
    customerCollections: money(f.collections),
    capitalIn: money(f.capital),
    adjustmentsIn: money(f.adjIn),
    otherIn: money(f.otherIn),
    supplierPayments: money(f.supplier),
    expensePayments: money(f.expense),
    workerPayments: money(f.workers),
    drawings: money(f.drawings),
    adjustmentsOut: money(f.adjOut),
    otherOut: money(f.otherOut),
    internalTransfers: money(f.internal),
    calculatedClosing: money(calculated),
    ledgerClosing: money(ledger),
    discrepancy: money(calculated - ledger),
    accounts: accountRows,
    unattributed: { count: unCount, total: money(unTotal) },
    openCounts,
  };
}

// ───────────────────────────── Review & confirmation ─────────────────────────────

const SNAPSHOT_KEYS = ["revenue", "directCosts", "grossProfit", "cancelledOrderCosts", "cancelledOrderLabor", "operatingExpenses", "fixedExpenses", "unallocatedLabor", "netOperatingProfit", "draftCosts"] as const;

function snapshotOf(m: MonthlyClosing): CloseSnapshot {
  const s: CloseSnapshot = { basis: m.basis, orders: m.orders.length };
  for (const k of SNAPSHOT_KEYS) s[k] = m.pnl[k];
  s.customerCollections = m.cash.customerCollections;
  s.supplierPayments = m.cash.supplierPayments;
  s.receivables = m.balances.receivables;
  s.supplierPayables = m.balances.supplierPayables;
  s.treasuryClosing = m.treasury?.ledgerClosing ?? null;
  return s;
}

function diffSnapshot(before: CloseSnapshot, now: CloseSnapshot): CloseState["changes"] {
  return Object.keys(before)
    .filter((k) => (before[k] ?? null) !== (now[k] ?? null))
    .map((k) => ({ key: k, confirmed: before[k] ?? null, now: now[k] ?? null }));
}

async function closeState(db: DbClient, month: string): Promise<(CloseState & { snapshot: CloseSnapshot }) | null> {
  const c = await db.monthlyClose.findUnique({
    where: { month },
    include: { confirmedBy: { select: { name: true } }, events: { orderBy: { createdAt: "desc" }, include: { by: { select: { name: true } } } } },
  });
  if (!c) return null;
  return {
    status: c.status === "CONFIRMED" ? "CONFIRMED" : "REOPENED",
    version: c.version,
    confirmedAt: c.confirmedAt,
    confirmedBy: c.confirmedBy?.name ?? null,
    basis: c.basis,
    notes: c.notes,
    changes: [],
    events: c.events.map((e) => ({ action: e.action, reason: e.reason, by: e.by.name, at: e.createdAt })),
    snapshot: c.snapshot as CloseSnapshot,
  };
}

/** Warnings that must be acknowledged before confirming (nothing is blocked silently). */
export function closeWarnings(m: MonthlyClosing): string[] {
  const w: string[] = [];
  const c = m.checks;
  if (c.costReviewOpen) w.push(`${c.costReviewOpen} أوردر تكاليفه لسه متقفلتش`);
  if (c.withDrafts) w.push(`${c.withDrafts} أوردر عليه تكاليف مسودة`);
  if (c.notDelivered) w.push(`${c.notDelivered} أوردر لسه متسلمش (الربح مبدئي)`);
  if (c.completedWithoutDelivery.length) w.push(`${c.completedWithoutDelivery.length} أوردر مكتمل من غير تاريخ تسليم`);
  if (c.unattributedPayments) w.push(`${c.unattributedPayments} دفعة مش متحدد حسابها في الخزنة`);
  if (c.treasuryDiscrepancy) w.push("فيه فرق بين حساب الخزنة والدفتر");
  if (c.openCounts) w.push(`${c.openCounts} جرد فيه فرق لسه متسوّاش`);
  if (c.fixedNotGenerated) w.push(`${c.fixedNotGenerated} مصروف ثابت لسه متسجلش للشهر ده`);
  if (c.unresolvedRefunds) w.push(`${c.unresolvedRefunds} أوردر عليه فلوس محتاجة قرار (ملغي واتدفع عليه، أو مدفوع أكتر من سعره) — مفيش استرداد متسجل`);
  if (m.treasury && !m.treasury.available) w.push("مفيش رصيد خزنة معروف للشهر ده — الخزنة مش متسوّية");
  return w;
}

export async function confirmMonth(db: PrismaClient, actor: Actor, payload: { month: unknown; basis?: unknown; expectedVersion: unknown; acknowledge: unknown; notes?: unknown }) {
  guardMonthly(actor);
  if (!isValidMonth(payload.month)) bad("month", "اختار شهر صحيح");
  const month = payload.month;
  // The confirmed (official) view is the delivery basis; the received-date view is a provisional management view only.
  if (payload.basis !== undefined && payload.basis !== "DELIVERY") bad("basis", "التأكيد بيتعمل على أساس التسليم الكامل بس. عرض تاريخ الاستلام إداري ومبدئي.");
  const m = await getMonthlyClosing(db, actor, { month, basis: "DELIVERY" });
  if (!m.monthEnded) throw new AppError("CONFLICT", "الشهر لسه مخلصش — تقدر تراجعه بس متأكدهوش غير بعد ما يخلص");
  if (m.close.status === "CONFIRMED") throw new AppError("CONFLICT", "الشهر ده متأكد بالفعل ومفيش تغيير من ساعتها");
  if (Number(payload.expectedVersion) !== m.close.version) throw new AppError("CONFLICT", "حد عدّل حالة الشهر ده. حدّث الصفحة.");
  const warnings = closeWarnings(m);
  if (warnings.length > 0 && payload.acknowledge !== true) bad("acknowledge", "راجع التنبيهات وأكّد إنك شايفها قبل التأكيد");
  const notes = typeof payload.notes === "string" && payload.notes.trim() ? payload.notes.trim().slice(0, 1000) : null;
  const snapshot = snapshotOf(m);
  return db.$transaction(async (tx) => {
    const existing = await tx.monthlyClose.findUnique({ where: { month }, select: { id: true, version: true } });
    if ((existing?.version ?? 0) !== m.close.version) throw new AppError("CONFLICT", "حد عدّل حالة الشهر ده. حدّث الصفحة.");
    const data = { status: "CONFIRMED" as const, basis: m.basis, snapshot, notes, confirmedById: actor.id, confirmedAt: new Date(), version: { increment: 1 } };
    const row = existing
      ? await tx.monthlyClose.update({ where: { id: existing.id, version: existing.version }, data, select: { id: true } })
      : await tx.monthlyClose.create({ data: { month, ...data, version: 1 }, select: { id: true } });
    await tx.monthlyCloseEvent.create({ data: { closeId: row.id, action: "CONFIRMED", reason: warnings.length ? `تأكيد مع تنبيهات: ${warnings.join("؛ ")}`.slice(0, 500) : notes?.slice(0, 500) ?? null, snapshot, byId: actor.id } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.MONTHLY_CLOSE_CONFIRMED, entityType: "MonthlyClose", entityId: row.id, metadata: { month, basis: m.basis, warnings, ...snapshot } });
    return { closeId: row.id };
  });
}

export async function reopenMonth(db: PrismaClient, actor: Actor, payload: { month: unknown; expectedVersion: unknown; reason: unknown }) {
  guardMonthly(actor);
  if (!isValidMonth(payload.month)) bad("month", "اختار شهر صحيح");
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (reason.length < 3) bad("reason", "اكتب سبب فتح الشهر تاني");
  return db.$transaction(async (tx) => {
    const c = await tx.monthlyClose.findUnique({ where: { month: payload.month as string } });
    if (!c || c.status !== "CONFIRMED") throw new AppError("CONFLICT", "الشهر ده مش متأكد");
    if (Number(payload.expectedVersion) !== c.version) throw new AppError("CONFLICT", "حد عدّل حالة الشهر ده. حدّث الصفحة.");
    await tx.monthlyClose.update({ where: { id: c.id, version: c.version }, data: { status: "REOPENED", version: { increment: 1 } } });
    await tx.monthlyCloseEvent.create({ data: { closeId: c.id, action: "REOPENED", reason: reason.slice(0, 500), snapshot: c.snapshot ?? {}, byId: actor.id } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.MONTHLY_CLOSE_REOPENED, entityType: "MonthlyClose", entityId: c.id, metadata: { month: c.month, reason } });
    return { closeId: c.id };
  });
}

// ───────────────────────────── Fixed (recurring) expenses ─────────────────────────────

function guardExpenses(actor: Actor) {
  assertPermission(actor, "finance:reports");
  assertPermission(actor, "expenses:record");
}

export async function listRecurringExpenses(db: DbClient, actor: Actor) {
  guardExpenses(actor);
  const rows = await db.recurringExpense.findMany({ orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }, { createdAt: "asc" }], include: { _count: { select: { expenses: true } } } });
  return rows.map((r) => ({ id: r.id, category: r.category, description: r.description, amount: money(toCents(r.amount)), dayOfMonth: r.dayOfMonth, startMonth: r.startMonth, endMonth: r.endMonth, isActive: r.isActive, generated: r._count.expenses }));
}

export async function createRecurringExpense(db: PrismaClient, actor: Actor, payload: { category: unknown; description: unknown; amount: unknown; dayOfMonth: unknown; startMonth: unknown; endMonth?: unknown }) {
  guardExpenses(actor);
  if (!(EXPENSE_CATEGORIES as readonly unknown[]).includes(payload.category)) bad("category", "اختار نوع المصروف");
  const description = typeof payload.description === "string" ? payload.description.trim().slice(0, 300) : "";
  if (description.length < 2) bad("description", "اكتب وصف المصروف (مثال: إيجار المحل)");
  const amount = parseMoney(typeof payload.amount === "string" ? payload.amount.trim() : "");
  if (amount === null || amount <= 0n) bad("amount", "اكتب المبلغ");
  if (amount > MAX_CENTS) bad("amount", "المبلغ كبير جدًا");
  const day = Number(payload.dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 28) bad("dayOfMonth", "اختار يوم من 1 لـ 28");
  if (!isValidMonth(payload.startMonth)) bad("startMonth", "اختار أول شهر");
  const end = payload.endMonth === undefined || payload.endMonth === null || payload.endMonth === "" ? null : payload.endMonth;
  if (end !== null && (!isValidMonth(end) || end < payload.startMonth)) bad("endMonth", "آخر شهر لازم يكون بعد أول شهر");
  return db.$transaction(async (tx) => {
    const r = await tx.recurringExpense.create({
      data: { category: payload.category as ExpenseCategory, description, amount: money(amount), dayOfMonth: day, startMonth: payload.startMonth as string, endMonth: end as string | null, createdById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.RECURRING_EXPENSE_CREATED, entityType: "RecurringExpense", entityId: r.id, metadata: { category: payload.category as string, description, amount: money(amount), dayOfMonth: day, startMonth: payload.startMonth as string, endMonth: end as string | null } });
    return r;
  });
}

/** Stop / resume a template. Already generated expenses are untouched. */
export async function setRecurringActive(db: PrismaClient, actor: Actor, payload: { id: unknown; active: unknown }) {
  guardExpenses(actor);
  if (typeof payload.id !== "string" || typeof payload.active !== "boolean") throw new AppError("VALIDATION_ERROR");
  return db.$transaction(async (tx) => {
    const r = await tx.recurringExpense.findUnique({ where: { id: payload.id as string }, select: { id: true } });
    if (!r) throw new AppError("NOT_FOUND");
    await tx.recurringExpense.update({ where: { id: r.id }, data: { isActive: payload.active as boolean } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.RECURRING_EXPENSE_UPDATED, entityType: "RecurringExpense", entityId: r.id, metadata: { active: payload.active as boolean } });
  });
}

/** Templates that apply to the month, are due by today, and have no expense row for it yet. */
async function pendingTemplates(db: DbClient, month: string, today: string) {
  const templates = await db.recurringExpense.findMany({
    where: { isActive: true, startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }], expenses: { none: { recurringMonth: month } } },
  });
  return templates.filter((t) => `${month}-${String(t.dayOfMonth).padStart(2, "0")}` <= today);
}

async function pendingFixedCount(db: DbClient, month: string, today: string): Promise<number> {
  return (await pendingTemplates(db, month, today)).length;
}

/**
 * Creates the month's fixed expenses from the active templates — unpaid, dated
 * on the template's day. Idempotent: a template never gets two rows for the
 * same month (unique key), so running it twice adds nothing. Future-dated
 * expenses are not created early.
 */
export async function generateFixedExpenses(db: PrismaClient, actor: Actor, payload: { month: unknown }): Promise<{ created: number }> {
  guardExpenses(actor);
  if (!isValidMonth(payload.month)) bad("month", "اختار شهر صحيح");
  const month = payload.month;
  let created = 0;
  for (const t of await pendingTemplates(db, month, todayDateString())) {
    try {
      await db.$transaction(async (tx) => {
        const e = await tx.generalExpense.create({
          data: {
            category: t.category,
            description: t.description,
            amount: t.amount,
            expenseDate: dateFromString(`${month}-${String(t.dayOfMonth).padStart(2, "0")}`),
            isFixed: true,
            recurringId: t.id,
            recurringMonth: month,
            idempotencyKey: randomUUID(),
            recordedById: actor.id,
          },
          select: { id: true },
        });
        await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.EXPENSE_RECORDED, entityType: "GeneralExpense", entityId: e.id, metadata: { category: t.category, amount: money(toCents(t.amount)), expenseDate: `${month}-${String(t.dayOfMonth).padStart(2, "0")}`, recurringId: t.id, month, paidNow: "0.00" } });
      });
      created += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // generated concurrently: already there
    }
  }
  if (created > 0) await recordAudit(db, { userId: actor.id, action: AUDIT_ACTIONS.FIXED_EXPENSES_GENERATED, entityType: "MonthlyClose", entityId: month, metadata: { month, created } });
  return { created };
}
