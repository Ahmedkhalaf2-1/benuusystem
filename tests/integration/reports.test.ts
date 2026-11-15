import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { dateFromString, dateToString, monthRange, todayDateString } from "@/lib/dates";
import type { Actor } from "@/server/services/actor";
import { recordOrderCost } from "@/server/services/cost-service";
import { createCustomer } from "@/server/services/customer-service";
import { recordExpense } from "@/server/services/expense-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { payPayable } from "@/server/services/outgoing-payment-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import {
  getCashFlow,
  getExpenseReport,
  getFinancialOverview,
  getOrderContributions,
  getPayables,
  getReceivables,
  getWorkerObligations,
  listCashMovements,
} from "@/server/services/reports-service";
import { recordWorkday, recordWorkLog } from "@/server/services/work-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker } from "@/server/services/worker-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const MONTH = monthRange(TODAY);
/** n months before the month containing today, as "YYYY-MM-DD" on the given day. */
function monthsAgo(n: number, day: number) {
  const t = dateFromString(TODAY);
  return dateToString(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, day)));
}

describe.skipIf(!hasTestDatabase)("Phase 6 financial reports (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;

  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    owner = await createTestUser(db, "OWNER_ADMIN");
    staff = await createTestUser(db, "STAFF");
  });

  async function mahmoudOrder(extra: { totalPrice?: string; advance?: string; receivedDate?: string } = {}) {
    const c = await createCustomer(db, owner, { name: `محمود ${randomUUID().slice(0, 4)}` });
    return (
      await createOrder(db, owner, {
        idempotencyKey: randomUUID(),
        customer: { mode: "existing", id: c.id },
        title: "200 تيشيرت",
        productType: "تيشيرت",
        material: "قطن",
        quantity: "200",
        unit: "PIECE",
        groups: [{ operations: ["DTF"], plain: false }],
        totalPrice: extra.totalPrice ?? "40000",
        advance: extra.advance ?? "20000",
        advanceMethod: "CASH",
        receivedDate: extra.receivedDate ?? TODAY,
        deliveryDate: "2099-01-15",
      })
    ).orderId;
  }

  it("E: empty database → exact zeros, empty lists, no fabricated numbers", async () => {
    const o = await getFinancialOverview(db, owner, MONTH);
    expect(o.cash).toEqual({ in: "0.00", out: "0.00", net: "0.00" });
    expect(o.receivables).toMatchObject({ total: "0.00", overdue: "0.00", orders: 0, needsDecision: 0 });
    expect(o.payables).toEqual({ suppliers: "0.00", looseCosts: "0.00", expenses: "0.00", total: "0.00" });
    expect(o.workers).toEqual({ owed: "0.00", advancesOutstanding: "0.00" });
    expect(o.labor).toEqual({ earned: "0.00", unallocated: "0.00" });
    const cf = await getCashFlow(db, owner, MONTH);
    expect(cf.inflows[0]).toMatchObject({ total: "0.00", count: 0, share: null });
    expect(cf.outflows.every((l) => l.total === "0.00" && l.share === null)).toBe(true);
    expect(cf.months.every((m) => m.in === "0.00" && m.out === "0.00")).toBe(true);
    expect((await listCashMovements(db, owner, { range: MONTH })).items).toEqual([]);
    expect(await getOrderContributions(db, owner)).toEqual([]);
  });

  it("A + B: credit purchase, labour, contribution 30,800 and cash movement 16,000 (not profit)", async () => {
    const orderId = await mahmoudOrder();

    // A — fabric 8,000 on credit-ish: 3,000 paid now.
    await recordOrderCost(db, staff, {
      orderId,
      idempotencyKey: randomUUID(),
      category: "MATERIALS",
      description: "قماش",
      amount: "8000",
      costDate: TODAY,
      supplier: { mode: "new", name: "Ahmed Fabrics" },
      payStatus: "PARTIAL",
      paidNow: "3000",
    });

    // B — one worker, one day earning 1,200, fully on this order; 1,000 paid.
    const w = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "1200" });
    await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, worked: true });
    await recordWorkLog(db, staff, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId, workType: "DTF", unit: "PRINT", quantity: "200" });
    await payWorker(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), type: "WAGE", amount: "1000", paidAt: TODAY, method: "CASH" });

    // Customer side.
    const r = await getReceivables(db, owner);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ price: "40000.00", paid: "20000.00", outstanding: "20000.00" });
    expect(r.total).toBe("20000.00");

    // Supplier side: 8,000 incurred, 3,000 paid, 5,000 owed.
    const p = await getPayables(db, owner);
    expect(p.suppliers).toEqual([expect.objectContaining({ name: "Ahmed Fabrics", purchased: "8000.00", paid: "3000.00", outstanding: "5000.00" })]);
    expect(p.supplierTotal).toBe("5000.00");

    // Worker: earned 1,200, paid 1,000, owed 200.
    const wo = await getWorkerObligations(db, owner);
    expect(wo.workers[0]).toMatchObject({ earned: "1200.00", wagesPaid: "1000.00", advancesPaid: "0.00", balance: "200.00" });
    expect(wo.totals.owedToWorkers).toBe("200.00");

    // Contribution: 40,000 − 8,000 − 1,200 = 30,800 (77%), still provisional (order open).
    const [c] = await getOrderContributions(db, owner, { orderIds: [orderId] });
    expect(c).toMatchObject({ price: "40000.00", materials: "8000.00", directCosts: "8000.00", labor: "1200.00", contribution: "30800.00", percent: "77" });
    expect(c!.warnings).toContain("open");
    expect(c!.warnings).not.toContain("no-labor");

    // Cash: +20,000 in; −3,000 supplier −1,000 worker. The 8,000 cost is NOT cash out.
    const cf = await getCashFlow(db, owner, MONTH);
    expect(cf.totalIn).toBe("20000.00");
    expect(cf.totalOut).toBe("4000.00");
    expect(cf.net).toBe("16000.00");
    expect(Object.fromEntries(cf.outflows.map((l) => [l.key, l.total]))).toEqual({ costs: "3000.00", expenses: "0.00", wages: "1000.00", advances: "0.00" });
    expect(cf.outflows.find((l) => l.key === "costs")!.share).toBe("75");

    // Drill-down reconciles with the summary.
    const moves = await listCashMovements(db, owner, { range: MONTH });
    expect(moves.totalIn).toBe(cf.totalIn);
    expect(moves.totalOut).toBe(cf.totalOut);
    expect(moves.items.map((m) => m.kind).sort()).toEqual(["cost", "customer", "wage"]);
    expect((await listCashMovements(db, owner, { range: MONTH, kind: "wage" })).items).toHaveLength(1);
    expect((await listCashMovements(db, owner, { range: MONTH, q: "Ahmed" })).items).toHaveLength(1);
  });

  it("advance then earned days: cash counted once, cost counted once, balance moves back", async () => {
    const w = await createWorker(db, owner, { name: "كريم", job: "OTHER", dailyWage: "300" });
    await payWorker(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), type: "ADVANCE", amount: "500", paidAt: TODAY, method: "CASH" });
    let wo = await getWorkerObligations(db, owner);
    expect(wo.totals).toMatchObject({ earned: "0.00", advancesPaid: "500.00", owedToWorkers: "0.00", advancesOutstanding: "500.00" });

    await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, worked: true });
    await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: monthsAgo(1, 15), worked: true });
    wo = await getWorkerObligations(db, owner);
    expect(wo.totals).toMatchObject({ earned: "600.00", owedToWorkers: "100.00", advancesOutstanding: "0.00" });

    // Cash out is the 500 advance only — earning days never creates cash out.
    const all = { from: monthsAgo(2, 1), to: TODAY };
    const cf = await getCashFlow(db, owner, all);
    expect(cf.totalOut).toBe("500.00");
    expect(cf.outflows.find((l) => l.key === "advances")!.total).toBe("500.00");
  });

  it("unallocated labour is reported, never silently zeroed or split", async () => {
    const orderId = await mahmoudOrder();
    const w = await createWorker(db, owner, { name: "سامي", job: "OTHER", dailyWage: "300" });
    // Day 1: no work logged at all → 300 unallocated.
    await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, worked: true });
    const o = await getFinancialOverview(db, owner, MONTH);
    expect(o.labor).toEqual({ earned: "300.00", unallocated: "300.00" });
    const [c] = await getOrderContributions(db, owner, { orderIds: [orderId] });
    expect(c!.labor).toBe("0.00");
    expect(c!.warnings).toContain("no-labor");
  });

  it("C: expense incurred last-but-one month, paid last month — each counted once in its own report", async () => {
    const incurredOn = monthsAgo(2, 28);
    const paidOn = monthsAgo(1, 3);
    const e = await recordExpense(db, owner, { idempotencyKey: randomUUID(), category: "RENT", amount: "5000", expenseDate: incurredOn, payStatus: "CREDIT" });
    await payPayable(db, owner, "expense", { targetId: e.expenseId, idempotencyKey: randomUUID(), amount: "5000", paidAt: paidOn, method: "CASH" });

    const incurMonth = monthRange(incurredOn);
    const payMonth = monthRange(paidOn);
    // Incurred month: expense yes, cash no.
    expect((await getExpenseReport(db, owner, incurMonth)).totalIncurred).toBe("5000.00");
    expect((await getExpenseReport(db, owner, incurMonth)).unpaidAtEnd).toBe("5000.00");
    expect((await getCashFlow(db, owner, incurMonth)).totalOut).toBe("0.00");
    // Payment month: cash yes, no second expense.
    expect((await getCashFlow(db, owner, payMonth)).outflows.find((l) => l.key === "expenses")!.total).toBe("5000.00");
    const pm = await getExpenseReport(db, owner, payMonth);
    expect(pm.totalIncurred).toBe("0.00");
    expect(pm.totalPaid).toBe("5000.00");
    expect(pm.unpaidAtEnd).toBe("0.00");
  });

  it("D: voiding a payment removes it from cash, restores the receivable, keeps the record and the audit", async () => {
    const orderId = await mahmoudOrder({ advance: "0" });
    const p = await recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount: "15000", paidAt: TODAY, method: "CASH" });
    expect((await getCashFlow(db, owner, MONTH)).totalIn).toBe("15000.00");
    expect((await getReceivables(db, owner)).total).toBe("25000.00");

    await voidPayment(db, owner, { paymentId: p.paymentId, reason: "اتسجلت غلط" });
    expect((await getCashFlow(db, owner, MONTH)).totalIn).toBe("0.00");
    expect((await getReceivables(db, owner)).total).toBe("40000.00");
    const moves = await listCashMovements(db, owner, { range: MONTH });
    expect(moves.items).toHaveLength(1);
    expect(moves.items[0]!.voided).toEqual({ reason: "اتسجلت غلط" });
    expect(moves.totalIn).toBe("0.00");
    expect(await db.orderPayment.count()).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: p.paymentId } })).toBeGreaterThanOrEqual(2);
  });

  it("receivables: partial, multiple, fully paid, cancelled, overdue filter and sorting", async () => {
    const a = await mahmoudOrder({ totalPrice: "1000", advance: "0" });
    const b = await mahmoudOrder({ totalPrice: "5000", advance: "1000" });
    const full = await mahmoudOrder({ totalPrice: "2000", advance: "2000" });
    await recordPayment(db, owner, { orderId: b, idempotencyKey: randomUUID(), amount: "500", paidAt: TODAY, method: "CASH" });
    // Cancel a (no payments) — no longer owed.
    const before = (await getOrderDetails(db, owner, a))!;
    await updateOrder(db, owner, {
      orderId: a,
      expectedUpdatedAt: before.updatedAt,
      customer: { mode: "existing", id: before.customerId },
      title: before.title,
      productType: before.productType,
      material: before.material,
      quantity: String(before.quantity),
      unit: before.unit,
      groups: before.groups.map((g) => ({ id: g.id, quantity: String(g.quantity), material: g.material, operations: g.operations, plain: g.operations.length === 0, notes: "" })),
      totalPrice: before.totalPrice,
      receivedDate: before.receivedDate,
      deliveryDate: before.deliveryDate,
      notes: "",
      status: "CANCELLED",
    });
    const r = await getReceivables(db, owner);
    expect(r.items.map((i) => i.orderId)).toEqual([b]);
    expect(r.items[0]).toMatchObject({ paid: "1500.00", outstanding: "3500.00" });
    expect(r.items.some((i) => i.orderId === full)).toBe(false);
    expect(r.total).toBe("3500.00");
    expect(r.needsDecision).toEqual([]);
    expect((await getReceivables(db, owner, { overdueOnly: true })).items).toEqual([]);
  });

  it("large amounts stay exact to the piaster", async () => {
    const orderId = await mahmoudOrder({ totalPrice: "1234567.89", advance: "1234567.88" });
    const r = await getReceivables(db, owner);
    expect(r.items[0]!.outstanding).toBe("0.01");
    const [c] = await getOrderContributions(db, owner, { orderIds: [orderId] });
    expect(c!.contribution).toBe("1234567.89");
    expect(c!.percent).toBe("100");
    expect((await getCashFlow(db, owner, MONTH)).totalIn).toBe("1234567.88");
  });

  it("period boundaries are inclusive Cairo business dates", async () => {
    const orderId = await mahmoudOrder({ advance: "0" });
    const first = MONTH.from;
    const lastOfPrev = monthRange(monthsAgo(1, 1)).to;
    await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "100", paidAt: first, method: "CASH" });
    await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "7", paidAt: lastOfPrev, method: "CASH" });
    expect((await getCashFlow(db, owner, MONTH)).totalIn).toBe("100.00");
    expect((await getCashFlow(db, owner, monthRange(lastOfPrev))).totalIn).toBe("7.00");
    expect((await getCashFlow(db, owner, { from: lastOfPrev, to: first })).totalIn).toBe("107.00");
  });

  it("staff can still record money but every report is refused", async () => {
    const orderId = await mahmoudOrder({ advance: "0" });
    await expect(recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount: "10", paidAt: TODAY, method: "CASH" })).resolves.toBeTruthy();
    for (const call of [
      () => getFinancialOverview(db, staff, MONTH),
      () => getCashFlow(db, staff, MONTH),
      () => listCashMovements(db, staff, { range: MONTH }),
      () => getReceivables(db, staff),
      () => getPayables(db, staff),
      () => getWorkerObligations(db, staff),
      () => getOrderContributions(db, staff),
      () => getExpenseReport(db, staff, MONTH),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
