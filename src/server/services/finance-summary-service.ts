import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, monthRange, todayDateString } from "@/lib/dates";
import { centsToDecimalString, toCents } from "@/lib/money";
import { supplierBalances } from "@/server/repositories/payable-repository";
import type { Actor } from "./actor";

/**
 * Read-only money summaries. Two families, never mixed:
 *  - RECORDED amounts (costs/expenses by their own date) — what things cost;
 *  - CASH amounts (payments by their payment date) — money that actually moved.
 * No profit is computed here: payroll and overhead do not exist yet.
 */

type Range = { from: string; to: string };

function between(range: Range) {
  return { gte: dateFromString(range.from), lte: dateFromString(range.to) };
}

/** Cash in from customers and cash out (suppliers/costs, expenses, workers) within a period. */
export async function getCashMovement(db: DbClient, actor: Actor, range: Range) {
  assertPermission(actor, "finance:view-summary");
  const [incoming, outgoingCosts, outgoingExpenses, outgoingWorkers] = await Promise.all([
    db.orderPayment.aggregate({ where: { voidedAt: null, paidAt: between(range) }, _sum: { amount: true } }),
    db.outgoingPayment.aggregate({
      where: { voidedAt: null, paidAt: between(range), orderCostId: { not: null } },
      _sum: { amount: true },
    }),
    db.outgoingPayment.aggregate({
      where: { voidedAt: null, paidAt: between(range), expenseId: { not: null } },
      _sum: { amount: true },
    }),
    // Wages AND advances: both are cash that left (an advance is not a wage expense).
    db.outgoingPayment.aggregate({
      where: { voidedAt: null, paidAt: between(range), workerId: { not: null } },
      _sum: { amount: true },
    }),
  ]);
  const cin = toCents(incoming._sum.amount);
  const outCosts = toCents(outgoingCosts._sum.amount);
  const outExpenses = toCents(outgoingExpenses._sum.amount);
  const outWorkers = toCents(outgoingWorkers._sum.amount);
  return {
    customerPaymentsIn: centsToDecimalString(cin),
    paidForOrderCosts: centsToDecimalString(outCosts),
    paidForExpenses: centsToDecimalString(outExpenses),
    paidToWorkers: centsToDecimalString(outWorkers),
    totalPaidOut: centsToDecimalString(outCosts + outExpenses + outWorkers),
    net: centsToDecimalString(cin - outCosts - outExpenses - outWorkers),
  };
}

/** Expenses recorded in a period (by expense date) and how much of them is paid. */
export async function getExpenseTotals(db: DbClient, actor: Actor, range: Range) {
  assertPermission(actor, "expenses:view");
  const expenses = await db.generalExpense.findMany({
    where: { voidedAt: null, expenseDate: between(range) },
    select: { amount: true, payments: { where: { voidedAt: null }, select: { amount: true } } },
  });
  let recorded = 0n;
  let paid = 0n;
  for (const e of expenses) {
    recorded += toCents(e.amount);
    for (const p of e.payments) paid += toCents(p.amount);
  }
  return {
    recorded: centsToDecimalString(recorded),
    paid: centsToDecimalString(paid),
    remaining: centsToDecimalString(recorded - paid),
  };
}

/** Everything still owed to suppliers (valid costs − valid payments). */
export async function getSupplierOutstandingTotal(db: DbClient, actor: Actor): Promise<string> {
  assertPermission(actor, "suppliers:view-balances");
  let total = 0n;
  for (const b of (await supplierBalances(db)).values()) total += b.outstanding;
  return centsToDecimalString(total);
}

export type FinanceDashboard = {
  expensesThisMonth: string;
  expensesPaidThisMonth: string;
  paidOutThisMonth: string;
  supplierOutstanding: string;
};

export async function getFinanceDashboard(db: DbClient, actor: Actor): Promise<FinanceDashboard> {
  assertPermission(actor, "finance:view-summary");
  const month = monthRange(todayDateString());
  const [expenses, cash, supplierOutstanding] = await Promise.all([
    getExpenseTotals(db, actor, month),
    getCashMovement(db, actor, month),
    getSupplierOutstandingTotal(db, actor),
  ]);
  return {
    expensesThisMonth: expenses.recorded,
    expensesPaidThisMonth: expenses.paid,
    paidOutThisMonth: cash.totalPaidOut,
    supplierOutstanding,
  };
}
