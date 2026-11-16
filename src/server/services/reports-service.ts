import type { CostCategory, ExpenseCategory, OrderStatus, PaymentMethod, WorkerPaymentType } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";
import { centsToDecimalString, toCents, type Cents } from "@/lib/money";
import { sharePercent, trailingMonths } from "@/lib/reports/period";
import { paidByCostIds, paidByExpenseIds, supplierBalances } from "@/server/repositories/payable-repository";
import { balancesByWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";
import { laborByOrders, laborTotals } from "./labor-service";

/**
 * Phase 6 — read-only financial reports, derived ONLY from recorded events.
 * Nothing here writes. No balance is stored anywhere; every figure is a sum of
 * source rows, and voided rows are excluded (voids mean "entered in error").
 *
 * Authoritative sources (see docs/financial-model.md):
 *   cash IN   = order_payments            (valid, by paid_at)
 *   cash OUT  = outgoing_payments         (valid, by paid_at) — exactly one of
 *               order cost | general expense | worker (WAGE or ADVANCE)
 *   incurred  = order_costs (cost_date) · general_expenses (expense_date)
 *               · worker_workdays (worked, wage snapshot, work_date)
 *   selling   = orders.total_price (not CANCELLED)
 * Costs and their payments are never added together; customer payments are
 * never added to the selling value.
 */

export type Range = { from: string; to: string };
const between = (r: Range) => ({ gte: dateFromString(r.from), lte: dateFromString(r.to) });
const money = (c: Cents) => centsToDecimalString(c);

function guard(actor: Actor) {
  assertPermission(actor, "finance:view-summary");
}

// ───────────────────────────── Cash flow ─────────────────────────────

export type CashLine = { key: "customers" | "costs" | "expenses" | "wages" | "advances"; total: string; count: number; share: string | null };
export type CashFlow = {
  range: Range;
  inflows: CashLine[];
  outflows: CashLine[];
  totalIn: string;
  totalOut: string;
  /** Cash in − cash out. NOT profit. */
  net: string;
  /** Last six months up to the period end, for a compact in/out comparison. */
  months: { month: string; in: string; out: string }[];
};

export async function getCashFlow(db: DbClient, actor: Actor, range: Range): Promise<CashFlow> {
  guard(actor);
  const paid = between(range);
  const out = (where: object) => db.outgoingPayment.aggregate({ where: { voidedAt: null, paidAt: paid, ...where }, _sum: { amount: true }, _count: { _all: true } });
  const [customers, costs, expenses, wages, advances] = await Promise.all([
    db.orderPayment.aggregate({ where: { voidedAt: null, paidAt: paid }, _sum: { amount: true }, _count: { _all: true } }),
    out({ orderCostId: { not: null } }),
    out({ expenseId: { not: null } }),
    out({ workerId: { not: null }, workerPaymentType: "WAGE" }),
    out({ workerId: { not: null }, workerPaymentType: "ADVANCE" }),
  ]);
  const totalIn = toCents(customers._sum.amount);
  const outs = { costs, expenses, wages, advances };
  const totalOut = Object.values(outs).reduce((s, a) => s + toCents(a._sum.amount), 0n);

  // Six-month series (by payment month), one grouped query per table.
  const months = trailingMonths(range.to, 6);
  const seriesFrom = `${months[0]}-01`;
  const [inRows, outRows] = await Promise.all([
    db.$queryRaw<{ m: string; s: string }[]>`
      SELECT to_char(paid_at, 'YYYY-MM') AS m, SUM(amount)::text AS s FROM order_payments
      WHERE voided_at IS NULL AND paid_at >= ${dateFromString(seriesFrom)} AND paid_at <= ${dateFromString(range.to)} GROUP BY 1`,
    db.$queryRaw<{ m: string; s: string }[]>`
      SELECT to_char(paid_at, 'YYYY-MM') AS m, SUM(amount)::text AS s FROM outgoing_payments
      WHERE voided_at IS NULL AND paid_at >= ${dateFromString(seriesFrom)} AND paid_at <= ${dateFromString(range.to)} GROUP BY 1`,
  ]);
  const inMap = new Map(inRows.map((r) => [r.m, r.s]));
  const outMap = new Map(outRows.map((r) => [r.m, r.s]));

  return {
    range,
    inflows: [{ key: "customers", total: money(totalIn), count: customers._count._all, share: totalIn > 0n ? "100" : null }],
    outflows: (Object.entries(outs) as [CashLine["key"], typeof costs][]).map(([key, a]) => {
      const t = toCents(a._sum.amount);
      return { key, total: money(t), count: a._count._all, share: sharePercent(t, totalOut) };
    }),
    totalIn: money(totalIn),
    totalOut: money(totalOut),
    net: money(totalIn - totalOut),
    months: months.map((m) => ({ month: m, in: inMap.get(m) ?? "0.00", out: outMap.get(m) ?? "0.00" })),
  };
}

// ───────────────────────────── Cash movements (drill-down) ─────────────────────────────

export type MovementKind = "customer" | "cost" | "expense" | "wage" | "advance";
export type Movement = {
  id: string;
  kind: MovementKind;
  direction: "in" | "out";
  date: string;
  amount: string;
  method: PaymentMethod;
  /** Who/what: customer, supplier or order, expense category, worker. */
  party: string;
  detail: string;
  href: string;
  recordedBy: string;
  voided: null | { reason: string };
  createdAt: Date;
};
export type MovementFilter = { range: Range; kind?: MovementKind | "in" | "out"; q?: string; page?: number };
const MOVES_PER_PAGE = 30;

export async function listCashMovements(db: DbClient, actor: Actor, filter: MovementFilter) {
  guard(actor);
  const paid = between(filter.range);
  const wantIn = !filter.kind || filter.kind === "in" || filter.kind === "customer";
  const wantOut = !filter.kind || filter.kind !== "customer";
  const outKind = filter.kind && !["in", "out", "customer"].includes(filter.kind) ? (filter.kind as MovementKind) : null;

  const [incoming, outgoing] = await Promise.all([
    wantIn
      ? db.orderPayment.findMany({
          where: { paidAt: paid },
          select: {
            id: true, amount: true, paidAt: true, method: true, isAdvance: true, createdAt: true, voidReason: true, voidedAt: true,
            recordedBy: { select: { name: true } },
            order: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } },
          },
        })
      : [],
    wantOut
      ? db.outgoingPayment.findMany({
          where: {
            paidAt: paid,
            ...(outKind === "cost" ? { orderCostId: { not: null } } : {}),
            ...(outKind === "expense" ? { expenseId: { not: null } } : {}),
            ...(outKind === "wage" ? { workerPaymentType: "WAGE" as WorkerPaymentType } : {}),
            ...(outKind === "advance" ? { workerPaymentType: "ADVANCE" as WorkerPaymentType } : {}),
          },
          select: {
            id: true, amount: true, paidAt: true, method: true, createdAt: true, voidReason: true, voidedAt: true, workerPaymentType: true,
            recordedBy: { select: { name: true } },
            orderCost: { select: { orderId: true, category: true, description: true, supplier: { select: { id: true, name: true } }, order: { select: { number: true, title: true } } } },
            expense: { select: { id: true, category: true, description: true } },
            worker: { select: { id: true, name: true } },
          },
        })
      : [],
  ]);

  const rows: Movement[] = [];
  for (const p of incoming) {
    rows.push({
      id: p.id,
      kind: "customer",
      direction: "in",
      date: dateToString(p.paidAt),
      amount: p.amount.toString(),
      method: p.method,
      party: p.order.customer.name,
      detail: `#${String(p.order.number).padStart(4, "0")} ${p.order.title}${p.isAdvance ? " · مقدم" : ""}`,
      href: `/orders/${p.order.id}`,
      recordedBy: p.recordedBy.name,
      voided: p.voidedAt ? { reason: p.voidReason ?? "" } : null,
      createdAt: p.createdAt,
    });
  }
  for (const p of outgoing) {
    const base = { id: p.id, direction: "out" as const, date: dateToString(p.paidAt), amount: p.amount.toString(), method: p.method, recordedBy: p.recordedBy.name, voided: p.voidedAt ? { reason: p.voidReason ?? "" } : null, createdAt: p.createdAt };
    if (p.orderCost) {
      rows.push({
        ...base,
        kind: "cost",
        party: p.orderCost.supplier?.name ?? "بدون مورد",
        detail: `#${String(p.orderCost.order.number).padStart(4, "0")} ${p.orderCost.order.title}${p.orderCost.description ? ` · ${p.orderCost.description}` : ""}`,
        href: p.orderCost.supplier ? `/suppliers/${p.orderCost.supplier.id}` : `/orders/${p.orderCost.orderId}#costs`,
      });
    } else if (p.expense) {
      rows.push({ ...base, kind: "expense", party: EXPENSE_CATEGORY_LABELS[p.expense.category], detail: p.expense.description ?? "", href: `/expenses/${p.expense.id}` });
    } else if (p.worker) {
      rows.push({ ...base, kind: p.workerPaymentType === "ADVANCE" ? "advance" : "wage", party: p.worker.name, detail: "", href: `/workers/${p.worker.id}` });
    }
  }

  const q = filter.q?.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => `${r.party} ${r.detail}`.toLowerCase().includes(q)) : rows;
  filtered.sort((a, b) => (a.date === b.date ? b.createdAt.getTime() - a.createdAt.getTime() : a.date < b.date ? 1 : -1));

  let totalIn = 0n;
  let totalOut = 0n;
  for (const r of filtered) {
    if (r.voided) continue;
    if (r.direction === "in") totalIn += toCents(r.amount);
    else totalOut += toCents(r.amount);
  }
  const page = Math.max(1, filter.page ?? 1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / MOVES_PER_PAGE));
  return {
    items: filtered.slice((page - 1) * MOVES_PER_PAGE, page * MOVES_PER_PAGE),
    count: filtered.length,
    validCount: filtered.filter((r) => !r.voided).length,
    totalIn: money(totalIn),
    totalOut: money(totalOut),
    page,
    pageCount,
  };
}

// ───────────────────────────── Receivables ─────────────────────────────

export type Receivable = {
  orderId: string;
  number: number;
  title: string;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  price: string;
  paid: string;
  outstanding: string;
  deliveryDate: string;
  overdue: boolean;
};

/**
 * لينا كام عند العملاء: per order, selling value − valid customer payments.
 * Cancelled orders are not owed (existing rule). Payments on a cancelled order
 * and over-payments are listed separately: there is no refund event to settle them.
 */
export async function getReceivables(db: DbClient, actor: Actor, opts: { q?: string; overdueOnly?: boolean; sort?: "amount" | "due" } = {}) {
  guard(actor);
  const today = todayDateString();
  const rows = await db.$queryRaw<
    { id: string; number: number; title: string; status: OrderStatus; price: string; paid: string; delivery: Date; cid: string; cname: string }[]
  >`
    SELECT o.id, o.number, o.title, o.status, o.total_price::text AS price, COALESCE(p.paid, 0)::text AS paid,
           o.delivery_date AS delivery, c.id AS cid, c.name AS cname
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM order_payments WHERE voided_at IS NULL GROUP BY order_id) p ON p.order_id = o.id
    WHERE o.archived_at IS NULL
      AND ((o.status <> 'CANCELLED' AND o.total_price <> COALESCE(p.paid, 0))
       OR (o.status = 'CANCELLED' AND COALESCE(p.paid, 0) > 0))`;

  const open: Receivable[] = [];
  const needsDecision: (Receivable & { reason: "cancelled-with-payments" | "overpaid" })[] = [];
  for (const r of rows) {
    const price = toCents(r.price);
    const paidC = toCents(r.paid);
    const deliveryDate = dateToString(r.delivery);
    const item: Receivable = {
      orderId: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      customerId: r.cid,
      customerName: r.cname,
      price: money(price),
      paid: money(paidC),
      outstanding: money(price - paidC),
      deliveryDate,
      overdue: (r.status === "NEW" || r.status === "IN_PROGRESS") && deliveryDate < today,
    };
    if (r.status === "CANCELLED") needsDecision.push({ ...item, outstanding: money(-paidC), reason: "cancelled-with-payments" });
    else if (paidC > price) needsDecision.push({ ...item, reason: "overpaid" });
    else open.push(item);
  }

  const q = opts.q?.trim().toLowerCase();
  let items = q ? open.filter((r) => `${r.customerName} ${r.title} ${r.number}`.toLowerCase().includes(q)) : open;
  if (opts.overdueOnly) items = items.filter((r) => r.overdue);
  items.sort((a, b) =>
    opts.sort === "due" ? a.deliveryDate.localeCompare(b.deliveryDate) : Number(toCents(b.outstanding) - toCents(a.outstanding)),
  );

  const sum = (list: Receivable[], f: (r: Receivable) => string) => list.reduce((s, r) => s + toCents(f(r)), 0n);
  const byCustomer = new Map<string, { id: string; name: string; outstanding: Cents; orders: number }>();
  for (const r of open) {
    const c = byCustomer.get(r.customerId) ?? { id: r.customerId, name: r.customerName, outstanding: 0n, orders: 0 };
    c.outstanding += toCents(r.outstanding);
    c.orders += 1;
    byCustomer.set(r.customerId, c);
  }
  return {
    items,
    total: money(sum(open, (r) => r.outstanding)),
    overdueTotal: money(sum(open.filter((r) => r.overdue), (r) => r.outstanding)),
    shownTotal: money(sum(items, (r) => r.outstanding)),
    orderCount: open.length,
    customers: [...byCustomer.values()]
      .sort((a, b) => Number(b.outstanding - a.outstanding))
      .map((c) => ({ ...c, outstanding: money(c.outstanding) })),
    needsDecision,
  };
}

// ───────────────────────────── Payables ─────────────────────────────

/**
 * علينا كام: supplier balances (valid costs − valid payments on them), unpaid
 * order costs with no supplier, and unpaid general expenses — kept separate.
 */
export async function getPayables(db: DbClient, actor: Actor, opts: { q?: string } = {}) {
  guard(actor);
  const [suppliers, balances, looseCosts, expenses] = await Promise.all([
    db.supplier.findMany({ select: { id: true, name: true, phone: true } }),
    supplierBalances(db),
    db.orderCost.findMany({
      where: { voidedAt: null, supplierId: null },
      select: { id: true, amount: true, category: true, description: true, costDate: true, order: { select: { id: true, number: true, title: true } } },
    }),
    db.generalExpense.findMany({
      where: { voidedAt: null },
      select: { id: true, amount: true, category: true, description: true, expenseDate: true },
    }),
  ]);
  const [costPaid, expensePaid] = await Promise.all([paidByCostIds(db, looseCosts.map((c) => c.id)), paidByExpenseIds(db, expenses.map((e) => e.id))]);

  const q = opts.q?.trim().toLowerCase();
  const supplierRows = suppliers
    .map((s) => {
      const b = balances.get(s.id) ?? { purchased: 0n, paid: 0n, outstanding: 0n };
      return { id: s.id, name: s.name, phone: s.phone, purchased: b.purchased, paid: b.paid, outstanding: b.outstanding };
    })
    .filter((s) => s.outstanding !== 0n)
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.outstanding - a.outstanding));

  const unpaidCosts = looseCosts
    .map((c) => ({ ...c, remaining: toCents(c.amount) - (costPaid.get(c.id) ?? 0n) }))
    .filter((c) => c.remaining > 0n);
  const unpaidExpenses = expenses
    .map((e) => ({ ...e, remaining: toCents(e.amount) - (expensePaid.get(e.id) ?? 0n) }))
    .filter((e) => e.remaining > 0n);

  const supplierTotal = [...balances.values()].reduce((s, b) => s + (b.outstanding > 0n ? b.outstanding : 0n), 0n);
  const costTotal = unpaidCosts.reduce((s, c) => s + c.remaining, 0n);
  const expenseTotal = unpaidExpenses.reduce((s, e) => s + e.remaining, 0n);
  return {
    suppliers: supplierRows.map((s) => ({ ...s, purchased: money(s.purchased), paid: money(s.paid), outstanding: money(s.outstanding) })),
    supplierTotal: money(supplierTotal),
    unpaidCosts: unpaidCosts.map((c) => ({
      id: c.id,
      category: c.category as CostCategory,
      description: c.description,
      date: dateToString(c.costDate),
      order: c.order,
      remaining: money(c.remaining),
    })),
    unpaidCostsTotal: money(costTotal),
    unpaidExpenses: unpaidExpenses
      .sort((a, b) => (a.expenseDate < b.expenseDate ? 1 : -1))
      .map((e) => ({ id: e.id, category: e.category as ExpenseCategory, description: e.description, date: dateToString(e.expenseDate), remaining: money(e.remaining) })),
    unpaidExpensesTotal: money(expenseTotal),
    total: money(supplierTotal + costTotal + expenseTotal),
  };
}

// ───────────────────────────── Worker obligations ─────────────────────────────

/**
 * Existing Phase 4 semantics: a worker's balance = wages earned (valid worked
 * days, wage snapshot) − ALL valid cash paid to them (wages AND advances).
 * Positive = we owe them; negative = an advance not yet earned back. An advance
 * is cash, not a wage cost; when later days are earned the balance simply moves
 * back — no second cash outflow and no second cost is ever created.
 */
export async function getWorkerObligations(db: DbClient, actor: Actor, asOf = todayDateString()) {
  guard(actor);
  assertPermission(actor, "workers:view-pay");
  const workers = await db.worker.findMany({ select: { id: true, name: true, isActive: true, dailyWage: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  const ids = workers.map((w) => w.id);
  const [balances, byType] = await Promise.all([
    balancesByWorker(db, ids, asOf),
    ids.length
      ? db.outgoingPayment.groupBy({
          by: ["workerId", "workerPaymentType"],
          where: { workerId: { in: ids }, voidedAt: null, paidAt: { lte: dateFromString(asOf) } },
          _sum: { amount: true },
        })
      : [],
  ]);
  const typeMap = new Map<string, { wages: Cents; advances: Cents }>();
  for (const r of byType) {
    const t = typeMap.get(r.workerId!) ?? { wages: 0n, advances: 0n };
    if (r.workerPaymentType === "ADVANCE") t.advances += toCents(r._sum.amount);
    else t.wages += toCents(r._sum.amount);
    typeMap.set(r.workerId!, t);
  }
  let earned = 0n, wages = 0n, advances = 0n, owed = 0n, ahead = 0n;
  const rows = workers.map((w) => {
    const b = balances.get(w.id)!;
    const t = typeMap.get(w.id) ?? { wages: 0n, advances: 0n };
    const balance = b.earned - b.paid;
    earned += b.earned;
    wages += t.wages;
    advances += t.advances;
    if (balance > 0n) owed += balance;
    else ahead += -balance;
    return {
      id: w.id,
      name: w.name,
      isActive: w.isActive,
      earned: money(b.earned),
      wagesPaid: money(t.wages),
      advancesPaid: money(t.advances),
      balance: money(balance),
    };
  });
  return {
    asOf,
    workers: rows.filter((r) => r.isActive || toCents(r.earned) > 0n || toCents(r.balance) !== 0n),
    totals: { earned: money(earned), wagesPaid: money(wages), advancesPaid: money(advances), owedToWorkers: money(owed), advancesOutstanding: money(ahead) },
  };
}

// ───────────────────────────── Order contribution ─────────────────────────────

const MATERIAL: CostCategory[] = ["MATERIALS", "PACKAGING"];
const OUTSIDE: CostCategory[] = ["PRINTING", "EMBROIDERY", "OUTSOURCED_LABOR"];

export type ContributionWarning = "open" | "cancelled" | "no-costs" | "no-labor" | "no-price";
export type OrderContribution = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  status: OrderStatus;
  price: string;
  paid: string;
  outstanding: string;
  materials: string;
  outside: string;
  otherCosts: string;
  directCosts: string;
  labor: string;
  /** price − direct costs − allocated labour. Before overhead; NOT final profit. */
  contribution: string;
  /** % of selling value, null when the price is zero. */
  percent: string | null;
  warnings: ContributionWarning[];
};

/** Contribution for a set of orders (2 grouped queries + batched labour), or one order. */
export async function getOrderContributions(
  db: DbClient,
  actor: Actor,
  opts: { orderIds?: string[]; range?: Range; status?: "open" | "completed" | "all"; q?: string } = {},
): Promise<OrderContribution[]> {
  guard(actor);
  assertPermission(actor, "costs:view");
  assertPermission(actor, "labor:view");
  const orders = await db.order.findMany({
    where: {
      archivedAt: null,
      ...(opts.orderIds ? { id: { in: opts.orderIds } } : {}),
      ...(opts.range ? { receivedDate: between(opts.range) } : {}),
      ...(opts.status === "open" ? { status: { in: ["NEW", "IN_PROGRESS"] } } : opts.status === "completed" ? { status: "COMPLETED" } : {}),
      ...(opts.q ? { OR: [{ title: { contains: opts.q, mode: "insensitive" } }, { customer: { name: { contains: opts.q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: [{ receivedDate: "desc" }, { number: "desc" }],
    take: 200,
    select: { id: true, number: true, title: true, status: true, totalPrice: true, customer: { select: { name: true } } },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) return [];
  const [costs, payments, labor, logCounts] = await Promise.all([
    db.orderCost.groupBy({ by: ["orderId", "category"], where: { orderId: { in: ids }, voidedAt: null }, _sum: { amount: true } }),
    db.orderPayment.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, voidedAt: null }, _sum: { amount: true } }),
    laborByOrders(db, actor, ids),
    db.workerWorkLog.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, voidedAt: null }, _count: { _all: true } }),
  ]);
  const paidMap = new Map(payments.map((p) => [p.orderId, toCents(p._sum.amount)]));
  const logged = new Set(logCounts.map((l) => l.orderId));
  return orders.map((o) => {
    let materials = 0n, outside = 0n, other = 0n;
    for (const c of costs) {
      if (c.orderId !== o.id) continue;
      const v = toCents(c._sum.amount);
      if (MATERIAL.includes(c.category)) materials += v;
      else if (OUTSIDE.includes(c.category)) outside += v;
      else other += v;
    }
    const price = toCents(o.totalPrice);
    const paidC = paidMap.get(o.id) ?? 0n;
    const direct = materials + outside + other;
    const lab = labor.get(o.id) ?? 0n;
    const contribution = price - direct - lab;
    const warnings: ContributionWarning[] = [];
    if (o.status === "CANCELLED") warnings.push("cancelled");
    else if (o.status !== "COMPLETED") warnings.push("open");
    if (direct === 0n) warnings.push("no-costs");
    if (!logged.has(o.id)) warnings.push("no-labor");
    if (price === 0n) warnings.push("no-price");
    return {
      orderId: o.id,
      number: o.number,
      title: o.title,
      customerName: o.customer.name,
      status: o.status,
      price: money(price),
      paid: money(paidC),
      outstanding: money(o.status === "CANCELLED" ? 0n : price - paidC),
      materials: money(materials),
      outside: money(outside),
      otherCosts: money(other),
      directCosts: money(direct),
      labor: money(lab),
      contribution: money(contribution),
      percent: sharePercent(contribution, price),
      warnings,
    };
  });
}

// ───────────────────────────── Expenses ─────────────────────────────

/**
 * Expenses INCURRED in the period (by expense date) per category, and expense
 * CASH paid in the period (by payment date) — two different dates, never mixed.
 */
export async function getExpenseReport(db: DbClient, actor: Actor, range: Range) {
  guard(actor);
  const [incurred, paidRows, open] = await Promise.all([
    db.generalExpense.groupBy({ by: ["category"], where: { voidedAt: null, expenseDate: between(range) }, _sum: { amount: true }, _count: { _all: true } }),
    db.outgoingPayment.findMany({
      where: { voidedAt: null, expenseId: { not: null }, paidAt: between(range) },
      select: { amount: true, expense: { select: { category: true } } },
    }),
    db.generalExpense.findMany({ where: { voidedAt: null, expenseDate: { lte: dateFromString(range.to) } }, select: { id: true, amount: true } }),
  ]);
  const totalIncurred = incurred.reduce((s, r) => s + toCents(r._sum.amount), 0n);
  const paidByCat = new Map<ExpenseCategory, Cents>();
  let totalPaid = 0n;
  for (const p of paidRows) {
    const v = toCents(p.amount);
    totalPaid += v;
    const cat = p.expense!.category;
    paidByCat.set(cat, (paidByCat.get(cat) ?? 0n) + v);
  }
  // Unpaid as of the period end: expenses dated ≤ end, minus payments dated ≤ end.
  const paidToEnd = open.length
    ? await db.outgoingPayment.groupBy({
        by: ["expenseId"],
        where: { voidedAt: null, expenseId: { in: open.map((e) => e.id) }, paidAt: { lte: dateFromString(range.to) } },
        _sum: { amount: true },
      })
    : [];
  const paidEndMap = new Map(paidToEnd.map((p) => [p.expenseId!, toCents(p._sum.amount)]));
  const unpaidAtEnd = open.reduce((s, e) => {
    const r = toCents(e.amount) - (paidEndMap.get(e.id) ?? 0n);
    return s + (r > 0n ? r : 0n);
  }, 0n);
  const cats = new Set<ExpenseCategory>([...incurred.map((r) => r.category), ...paidByCat.keys()]);
  return {
    range,
    categories: [...cats]
      .map((c) => {
        const inc = incurred.find((r) => r.category === c);
        const incC = toCents(inc?._sum.amount);
        return { category: c, incurred: money(incC), count: inc?._count._all ?? 0, paid: money(paidByCat.get(c) ?? 0n), share: sharePercent(incC, totalIncurred) };
      })
      .sort((a, b) => Number(toCents(b.incurred) - toCents(a.incurred))),
    totalIncurred: money(totalIncurred),
    totalPaid: money(totalPaid),
    unpaidAtEnd: money(unpaidAtEnd),
  };
}

// ───────────────────────────── Overview ─────────────────────────────

export async function getFinancialOverview(db: DbClient, actor: Actor, range: Range) {
  guard(actor);
  const [cash, receivables, payables, workers, labor, expenses] = await Promise.all([
    getCashFlow(db, actor, range),
    getReceivables(db, actor),
    getPayables(db, actor),
    getWorkerObligations(db, actor),
    laborTotals(db, actor, range),
    getExpenseReport(db, actor, range),
  ]);
  return {
    range,
    cash: { in: cash.totalIn, out: cash.totalOut, net: cash.net },
    receivables: { total: receivables.total, overdue: receivables.overdueTotal, orders: receivables.orderCount, needsDecision: receivables.needsDecision.length },
    payables: { suppliers: payables.supplierTotal, looseCosts: payables.unpaidCostsTotal, expenses: payables.unpaidExpensesTotal, total: payables.total },
    workers: { owed: workers.totals.owedToWorkers, advancesOutstanding: workers.totals.advancesOutstanding },
    labor: { earned: money(labor.earned), unallocated: money(labor.unallocated) },
    expenses: { incurred: expenses.totalIncurred, paid: expenses.totalPaid },
  };
}
