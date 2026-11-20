import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import { shiftMonth } from "@/lib/finance/profitability";
import type { Actor } from "@/server/services/actor";
import { amendCostEntry, closeOrderCosts, getCostWorkspace, recordCostEntry } from "@/server/services/cost-review-service";
import { recordExpense } from "@/server/services/expense-service";
import { getOrderDetails } from "@/server/services/order-service";
import { payPayable } from "@/server/services/outgoing-payment-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import { recordDelivery, recordReady } from "@/server/services/production-service";
import {
  closeWarnings,
  confirmMonth,
  createRecurringExpense,
  generateFixedExpenses,
  getMonthlyClosing,
  getOrderProfitability,
  reopenMonth,
} from "@/server/services/profitability-service";
import { getCashFlow } from "@/server/services/reports-service";
import { createSupplier } from "@/server/services/supplier-service";
import { createAccount, getLedger, recordMovement } from "@/server/services/treasury-service";
import { recordWorkday, recordWorkLog } from "@/server/services/work-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker } from "@/server/services/worker-service";
import { createSharedOrder, createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

/** Order profitability & monthly financial closing — one realistic month, end to end. */
const TODAY = todayDateString();
const THIS = TODAY.slice(0, 7);
/** The month under test: last month (ended, so it can be confirmed). */
const M = shiftMonth(THIS, -1);
const PREV = shiftMonth(THIS, -2);
const d = (day: number, month = M) => `${month}-${String(day).padStart(2, "0")}`;

describe.skipIf(!hasTestDatabase)("order profitability & monthly closing (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;
  let partner: Actor;

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
    staff = await createTestUser(db, "STAFF", undefined, ["orders:view", "orders:view-prices", "costs:view", "costs:record", "expenses:view", "expenses:record", "finance:view-summary", "payments:view", "payments:record"]);
    partner = await createTestUser(db, "PARTNER");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Per-item priced order: 10 pieces × unit price, so the existing department rule can allocate its value. */
  async function itemOrder(unitPrice: string, received = d(2)) {
    const { orderId } = await createSharedOrder(db, owner, { idempotencyKey: randomUUID(), customer: { mode: "new", name: `عميل ${randomUUID().slice(0, 4)}` }, title: `بنود ${unitPrice}`, productType: "تيشيرت", pricing: "items", unit: "PIECE", groups: [{ name: "تيشيرت", quantity: "10", unitPrice, plain: true, designs: [] }], receivedDate: received, deliveryDate: "2099-01-15" });
    return orderId;
  }
  async function order(price: string, opts: { received?: string; advance?: string; advanceAt?: string; account?: string } = {}) {
    const { orderId } = await createSharedOrder(db, owner, {
      idempotencyKey: randomUUID(),
      customer: { mode: "new", name: `عميل ${randomUUID().slice(0, 4)}` },
      title: `أوردر ${price}`,
      productType: "تيشيرت",
      material: "قطن",
      quantity: "10",
      unit: "PIECE",
      groups: [{ operations: [], plain: true }],
      totalPrice: price,
      ...(opts.advance ? { advance: opts.advance, advanceMethod: "CASH", advancePaidAt: opts.advanceAt, advanceAccountId: opts.account } : {}),
      receivedDate: opts.received ?? d(2),
      deliveryDate: "2099-01-15",
    });
    return orderId;
  }
  async function deliver(orderId: string, date: string) {
    const g = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    await recordReady(db, owner, { orderId, orderGroupId: g.id, quantity: "10", readyDate: date, idempotencyKey: randomUUID() });
    await recordDelivery(db, owner, { orderId, orderGroupId: g.id, quantity: "10", deliveredAt: date, idempotencyKey: randomUUID() });
  }
  const cost = (orderId: string, category: string, amount: string, supplierId: string | undefined, date = d(4)) =>
    recordCostEntry(db, owner, { orderId, idempotencyKey: randomUUID(), category, description: category, amount, costDate: date, ...(supplierId ? { supplierId } : {}) });
  async function closeCosts(orderId: string) {
    const ws = (await getCostWorkspace(db, owner, orderId))!;
    await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion, suppliers: Object.fromEntries(ws.entries.filter((e) => e.draft && !e.supplier).map((e) => [e.id, "none"])), confirmZero: ws.entries.length === 0 });
  }

  /** The month: two accounts (one opened mid-month), five orders, payments both ways, expenses, a transfer, unallocated labour. */
  async function seedMonth() {
    const cash = (await createAccount(db, owner, { name: "الخزنة", type: "CASH", openingBalance: "1000", countDate: d(1, PREV), basis: "START_OF_DAY", confirmed: true })).id;
    const bank = (await createAccount(db, owner, { name: "البنك", type: "BANK", openingBalance: "500", countDate: d(10), basis: "START_OF_DAY", confirmed: true })).id;
    const s = (await createSupplier(db, owner, { name: "مورد القماش" })).id;

    // A: 10,000 — advance 3,000 (cash), 2,000 later (bank); costs 2,000 materials + 1,500 printing; delivered on the 15th.
    const a = await order("10000", { advance: "3000", advanceAt: d(3), account: cash });
    const aMat = await cost(a, "MATERIALS", "2000", s);
    await cost(a, "PRINTING", "1500", s);
    await closeCosts(a);
    await deliver(a, d(15));
    await recordPayment(db, owner, { orderId: a, idempotencyKey: randomUUID(), amount: "2000", paidAt: d(16), method: "BANK_TRANSFER", accountId: bank });
    await payPayable(db, owner, "cost", { targetId: aMat.costId, idempotencyKey: randomUUID(), amount: "1000", paidAt: d(18), method: "CASH", accountId: cash });

    // B: loss-making — 1,000 sale, 1,800 cost, delivered, unpaid.
    const b = await order("1000");
    await cost(b, "OUTSOURCED_LABOR", "1800", s);
    await closeCosts(b);
    await deliver(b, d(20));

    // D: delivered, costs still a draft (review open) → provisional, draft not in profit.
    const dd = await order("2000");
    await cost(dd, "MATERIALS", "700", s);
    await deliver(dd, d(22));

    // E: still open (not delivered) with a booked cost dated this month → deferred (work in progress).
    const e = await order("1500");
    await cost(e, "MATERIALS", "400", s);
    await closeCosts(e);

    // F: cancelled after a booked cost → that cost is a loss of the month (by cost date).
    const f = await order("900");
    await cost(f, "MATERIALS", "300", s);
    await closeCosts(f);
    await db.order.update({ where: { id: f }, data: { status: "CANCELLED" } }); // fixture: an order cancelled after buying material

    // Expenses: rent from a fixed template (generated, unpaid) + electricity paid in cash.
    await createRecurringExpense(db, owner, { category: "RENT", description: "إيجار المحل", amount: "2500", dayOfMonth: 1, startMonth: PREV });
    await recordExpense(db, owner, { idempotencyKey: randomUUID(), category: "ELECTRICITY", amount: "400", expenseDate: d(25), payStatus: "FULL", method: "CASH", accountId: cash });

    // Treasury-only: capital into the bank, an internal transfer cash → bank.
    await recordMovement(db, owner, { kind: "CAPITAL_IN", accountId: bank, amount: "1000", date: d(11), idempotencyKey: randomUUID() });
    await recordMovement(db, owner, { kind: "TRANSFER", accountId: cash, toAccountId: bank, amount: "500", date: d(12), idempotencyKey: randomUUID() });

    // A worker day with no work logged on any order: wages of the month, not an order cost.
    const w = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "200" });
    await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: d(8), worked: true });

    return { cash, bank, s, a, aMat, b, dd, e, f };
  }

  it("order profitability: booked costs only, margin, collections, provisional vs final; payments to suppliers never reduce profit twice", async () => {
    const { a, aMat, b, dd } = await seedMonth();
    const pa = (await getOrderProfitability(db, owner, a))!;
    expect(pa).toMatchObject({ revenue: "10000.00", materials: "2000.00", production: "1500.00", labor: "0.00", otherDirect: "0.00", directCosts: "3500.00", draftCosts: "0.00", grossProfit: "6500.00", margin: "65.0", collected: "5000.00", outstanding: "5000.00", provisional: false, costStatus: "CLOSED" });
    // Paying the supplier changed nothing above (cost was recognized once when booked).
    await payPayable(db, owner, "cost", { targetId: aMat.costId, idempotencyKey: randomUUID(), amount: "500", paidAt: TODAY, method: "CASH", accountId: (await db.financialAccount.findFirstOrThrow({ where: { type: "CASH" } })).id });
    expect((await getOrderProfitability(db, owner, a))!.grossProfit).toBe("6500.00");

    expect(await getOrderProfitability(db, owner, b)).toMatchObject({ grossProfit: "-800.00", margin: "-80.0", outstanding: "1000.00" });
    const pd = (await getOrderProfitability(db, owner, dd))!;
    expect(pd).toMatchObject({ directCosts: "0.00", draftCosts: "700.00", grossProfit: "2000.00", expectedProfit: "1300.00", provisional: true });
    expect(pd.reasons).toEqual(expect.arrayContaining(["cost-review-open", "drafts"]));

    // A correction after closing (with reason) flows into profit exactly once.
    const ws = (await getCostWorkspace(db, owner, a))!;
    const mat = ws.entries.find((x) => x.id === aMat.costId)!;
    await amendCostEntry(db, owner, { costId: mat.id, expectedVersion: mat.version, amount: "2300", reason: "فاتورة المورد الفعلية" });
    expect((await getOrderProfitability(db, owner, a))!).toMatchObject({ directCosts: "3800.00", grossProfit: "6200.00", margin: "62.0" });
  });

  it("monthly closing: revenue & costs by delivery month, expenses, unallocated labour, cancelled and deferred costs, net profit", async () => {
    await seedMonth();
    // Fixed rent is due but not generated yet → warning; generating twice adds it once.
    let m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.checks.fixedNotGenerated).toBe(1);
    expect(await generateFixedExpenses(db, owner, { month: M })).toEqual({ created: 1 });
    expect(await generateFixedExpenses(db, owner, { month: M })).toEqual({ created: 0 });
    expect(await db.generalExpense.count({ where: { recurringId: { not: null } } })).toBe(1);

    m = await getMonthlyClosing(db, owner, { month: M });
    // A (10,000) + B (1,000) + D (2,000) delivered; E open; F cancelled.
    expect(m.orders.map((o) => o.revenue).sort()).toEqual(["1000.00", "10000.00", "2000.00"]);
    expect(m.pnl).toMatchObject({
      revenue: "13000.00",
      materials: "2000.00",
      production: "3300.00", // printing 1,500 + outside workshop 1,800
      directCosts: "5300.00",
      grossProfit: "7700.00",
      draftCosts: "700.00",
      cancelledOrderCosts: "300.00",
      operatingExpenses: "400.00",
      fixedExpenses: "2500.00",
      unallocatedLabor: "200.00",
      deferredCosts: "400.00",
      netOperatingProfit: "4300.00", // 7,700 − 300 − 400 − 2,500 − 200
      grossMargin: "59.2",
    });
    expect(m.checks).toMatchObject({ costReviewOpen: 1, withDrafts: 1, negativeProfit: 1, notDelivered: 0 });
    // Cash: collections 3,000 + 2,000; supplier paid 1,000; expense paid 400.
    expect(m.cash).toMatchObject({ customerCollections: "5000.00", collectionsCount: 2, supplierPayments: "1000.00", expensePayments: "400.00", workerPayments: "0.00" });
    // Every order is counted once; the department split covers the whole revenue.
    expect(new Set(m.orders.map((o) => o.orderId)).size).toBe(m.orders.length);

    // Booking basis: E (received this month, still open) is included and provisional.
    const booking = await getMonthlyClosing(db, owner, { month: M, basis: "BOOKING" });
    expect(booking.pnl.revenue).toBe("14500.00");
    expect(booking.orders.find((o) => o.revenue === "1500.00")).toMatchObject({ provisional: true, directCosts: "400.00" });
    expect(booking.pnl.deferredCosts).toBe("0.00");
  });

  it("treasury: opening → flows → closing reconciles with the ledger; transfers are internal; a mid-month account adds its opening", async () => {
    const { cash, bank } = await seedMonth();
    const t = (await getMonthlyClosing(db, owner, { month: M })).treasury!;
    expect(t).toMatchObject({
      available: true,
      opening: "1000.00", // cash only (bank opened on the 10th)
      newAccountsOpening: "500.00",
      customerCollections: "5000.00",
      capitalIn: "1000.00",
      supplierPayments: "1000.00",
      expensePayments: "400.00",
      internalTransfers: "500.00",
      calculatedClosing: "6100.00",
      ledgerClosing: "6100.00",
      discrepancy: "0.00",
      unattributed: { count: 0, total: "0.00" },
    });
    // Matches the existing ledger per account and combined.
    const ledger = await getLedger(db, owner, { from: d(1), to: monthEnd(M) });
    expect(ledger.closing).toBe("6100.00");
    const accounts = Object.fromEntries(t.accounts.map((a) => [a.id, a.closing]));
    expect(accounts[cash]).toBe("2100.00"); // 1,000 + 3,000 − 1,000 − 400 − 500
    expect(accounts[bank]).toBe("4000.00"); // 500 + 1,000 + 500 + 2,000
    // The existing cash-flow report agrees with the month's cash figures.
    const cf = await getCashFlow(db, owner, { from: d(1), to: monthEnd(M) });
    expect(cf.totalIn).toBe("5000.00");
  });

  it("an unattributed payment after the cutover is reported as a discrepancy item, never adjusted silently", async () => {
    await seedMonth();
    const x = await order("800");
    // Older data: a payment row without an account (the app now requires one).
    await db.orderPayment.create({ data: { orderId: x, amount: "300", paidAt: new Date(`${d(26)}T00:00:00Z`), method: "CASH", idempotencyKey: randomUUID(), recordedById: owner.id } });
    const m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.treasury!.unattributed).toEqual({ count: 1, total: "300.00" });
    expect(m.treasury!.ledgerClosing).toBe("6100.00");
    expect(m.cash.customerCollections).toBe("5300.00");
    expect(closeWarnings(m)).toEqual(expect.arrayContaining([expect.stringContaining("مش متحدد حسابها")]));
  });

  it("month-end balances: receivables and supplier payables as of the period end", async () => {
    await seedMonth();
    // Everything was booked today (closing costs happens now), so last month owed suppliers nothing yet…
    const last = await getMonthlyClosing(db, owner, { month: M });
    expect(last.balances).toMatchObject({ receivables: "9500.00", supplierPayables: "0.00" }); // A 5,000 + B 1,000 + D 2,000 + E 1,500
    // …and this month: 2,000 + 1,500 + 1,800 + 400 + 300 − 1,000 paid = 5,000.
    const now = await getMonthlyClosing(db, owner, { month: THIS });
    expect(now.balances.supplierPayables).toBe("5000.00");
    expect(now.monthEnded).toBe(false);
  });

  it("review: warnings must be acknowledged; the snapshot is kept; later changes show as differences; reopen needs a reason; all audited", async () => {
    const { b } = await seedMonth();
    await generateFixedExpenses(db, owner, { month: M });
    let m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.close.status).toBe("OPEN");
    await expect(confirmMonth(db, owner, { month: M, basis: "DELIVERY", expectedVersion: 0, acknowledge: false })).rejects.toMatchObject({ fieldErrors: { acknowledge: [expect.any(String)] } });
    await expect(confirmMonth(db, owner, { month: THIS, basis: "DELIVERY", expectedVersion: 0, acknowledge: true })).rejects.toMatchObject({ code: "CONFLICT" }); // not ended
    await confirmMonth(db, owner, { month: M, basis: "DELIVERY", expectedVersion: 0, acknowledge: true, notes: "مراجعة أولى" });
    await expect(confirmMonth(db, owner, { month: M, basis: "DELIVERY", expectedVersion: 1, acknowledge: true })).rejects.toMatchObject({ code: "CONFLICT" });
    m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.close).toMatchObject({ status: "CONFIRMED", version: 1, changes: [] });

    // A later cost correction on a delivered order: nothing is locked, the difference is visible.
    const ws = (await getCostWorkspace(db, owner, b))!;
    await amendCostEntry(db, owner, { costId: ws.entries[0]!.id, expectedVersion: ws.entries[0]!.version, amount: "1600", reason: "خصم من المورد" });
    m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.close.status).toBe("CHANGED");
    expect(m.close.changes).toEqual(expect.arrayContaining([{ key: "grossProfit", confirmed: "7700.00", now: "7900.00" }]));
    // Re-confirming the corrected figures is allowed (a new event; the old snapshot stays in history).
    await confirmMonth(db, owner, { month: M, basis: "DELIVERY", expectedVersion: 1, acknowledge: true });
    await expect(reopenMonth(db, owner, { month: M, expectedVersion: 2, reason: "" })).rejects.toMatchObject({ fieldErrors: { reason: [expect.any(String)] } });
    await reopenMonth(db, owner, { month: M, expectedVersion: 2, reason: "مراجعة المصاريف" });
    m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.close.status).toBe("REOPENED");
    expect(m.close.events.map((e) => e.action)).toEqual(["REOPENED", "CONFIRMED", "CONFIRMED"]);
    const events = await db.monthlyCloseEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect((events[0]!.snapshot as Record<string, string>).grossProfit).toBe("7700.00");
    expect(await db.auditLog.count({ where: { action: { in: ["MONTHLY_CLOSE_CONFIRMED", "MONTHLY_CLOSE_REOPENED"] } } })).toBe(3);
    // Confirming never wrote money: no new payments, movements or expenses.
    expect(await db.treasuryMovement.count()).toBe(2);
  });

  it("department view: the department's share of value, no double counting, unallocatable orders reported, company-wide lines hidden", async () => {
    const { a } = await seedMonth(); // A, B, D have one total price → not allocatable to a department (existing rule)
    await generateFixedExpenses(db, owner, { month: M });
    const departments = await db.department.findMany({ orderBy: { sortOrder: "asc" } });
    const [embroidery, , printing] = departments;
    const p1 = await itemOrder("300"); // 3,000
    const p2 = await itemOrder("50"); // 500
    await db.orderGroup.updateMany({ where: { orderId: p1 }, data: { departmentId: printing!.id } }); // fixture: item departments
    await db.orderGroup.updateMany({ where: { orderId: p2 }, data: { departmentId: embroidery!.id } });
    await cost(p1, "PRINTING", "1000", undefined);
    await closeCosts(p1);
    await closeCosts(p2);
    await deliver(p1, d(21));
    await deliver(p2, d(21));

    const company = await getMonthlyClosing(db, owner, { month: M });
    expect(company.pnl.revenue).toBe("16500.00"); // 13,000 + 3,000 + 500
    let revenue = 0n;
    for (const dep of departments) {
      const v = await getMonthlyClosing(db, owner, { month: M, departmentId: dep.id });
      expect(v.treasury).toBeNull();
      expect(v.expenses).toEqual([]);
      expect(v.pnl.fixedExpenses).toBe("0.00");
      expect(v.pnl).toMatchObject({ unallocatedRevenue: "13000.00", unallocatedOrders: 3 });
      expect(v.orders.some((o) => o.orderId === a)).toBe(false);
      revenue += BigInt(v.pnl.revenue.replace(".", ""));
    }
    // Department shares + the unallocatable part = company revenue: nothing counted twice or lost.
    expect(revenue + 13_000_00n).toBe(16_500_00n);
    const pr = await getMonthlyClosing(db, owner, { month: M, departmentId: printing!.id });
    expect(pr.pnl).toMatchObject({ revenue: "3000.00", directCosts: "1000.00", grossProfit: "2000.00", netOperatingProfit: "2000.00", unattributedCosts: "0.00" });
  });


  /** The identities every month must satisfy, from the returned figures alone. */
  function assertIdentities(m: Awaited<ReturnType<typeof getMonthlyClosing>>) {
    const c = (v: string) => BigInt(v.replace(".", ""));
    const p = m.pnl;
    expect(c(p.directCosts)).toBe(c(p.materials) + c(p.production) + c(p.labor) + c(p.otherDirect));
    expect(c(p.grossProfit)).toBe(c(p.revenue) - c(p.directCosts));
    expect(c(p.cancellationLosses)).toBe(c(p.cancelledOrderCosts) + c(p.cancelledOrderLabor));
    expect(c(p.netOperatingProfit)).toBe(c(p.grossProfit) - c(p.cancellationLosses) - c(p.operatingExpenses) - c(p.fixedExpenses) - c(p.unallocatedLabor));
    const l = m.laborCheck;
    expect(c(l.earned)).toBe(c(l.withOrdersThisMonth) + c(l.cancelled) + c(l.unallocated) + c(l.deferred));
    expect(l.cancelled).toBe(p.cancelledOrderLabor);
    expect(l.unallocated).toBe(p.unallocatedLabor);
    const t = m.treasury;
    if (t?.available) {
      const inflow = c(t.customerCollections) + c(t.capitalIn) + c(t.adjustmentsIn) + c(t.otherIn);
      const outflow = c(t.supplierPayments) + c(t.expensePayments) + c(t.workerPayments) + c(t.drawings) + c(t.adjustmentsOut) + c(t.otherOut);
      expect(c(t.calculatedClosing)).toBe(c(t.opening) + c(t.newAccountsOpening) + inflow - outflow);
      expect(t.calculatedClosing).toBe(t.ledgerClosing);
    }
  }

  it("cancelled-order wages stay recognized once (by work date) as a cancellation loss; every wage lands in exactly one bucket", async () => {
    const { a, f } = await seedMonth(); // seed: one 200 day with no work (unallocated)
    const w = await createWorker(db, owner, { name: "سعيد", job: "FINISHING_PACKING", dailyWage: "300" });
    const day = async (date: string, logs: [string, string][]) => {
      await recordWorkday(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: date, worked: true });
      for (const [orderId, quantity] of logs) await recordWorkLog(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), workDate: date, orderId, workType: "PACKING", unit: "PIECE", quantity });
    };
    const h = await order("2500"); // will be cancelled after work was done on it
    const j = await order("1200"); // stays open: its wages wait for its delivery month
    await day(d(9), [[a, "10"], [h, "20"]]); // A 100, H 200
    await day(d(10), [[h, "5"]]); // H 300
    await day(d(11), []); // unallocated 300
    await day(d(12), [[j, "3"]]); // J 300 (deferred)
    await db.order.update({ where: { id: h }, data: { status: "CANCELLED" } }); // fixture: cancelled after the work was done

    const m = await getMonthlyClosing(db, owner, { month: M });
    assertIdentities(m);
    expect(m.laborCheck).toEqual({ earned: "1400.00", withOrdersThisMonth: "100.00", cancelled: "500.00", unallocated: "500.00", deferred: "300.00" });
    expect(m.pnl).toMatchObject({ labor: "100.00", cancelledOrderCosts: "300.00", cancelledOrderLabor: "500.00", cancellationLosses: "800.00", unallocatedLabor: "500.00" });
    // 7,700 + A's 100 wage now in direct costs → gross 7,600; − 800 − 400 − 0 fixed (not generated) − 500.
    expect(m.pnl.grossProfit).toBe("7600.00");
    expect(m.pnl.netOperatingProfit).toBe("5900.00");
    expect(m.cancelledCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: h, costs: "0.00", labor: "500.00", amount: "500.00" }),
      expect.objectContaining({ orderId: f, costs: "300.00", labor: "0.00", amount: "300.00" }),
    ]));
    // Paying wages later is cash only: the month's results do not move, and no other month picks the wages up again.
    await payWorker(db, owner, { workerId: w.id, idempotencyKey: randomUUID(), type: "WAGE", amount: "1200", paidAt: TODAY, method: "CASH", accountId: (await db.financialAccount.findFirstOrThrow({ where: { type: "CASH" } })).id });
    const again = await getMonthlyClosing(db, owner, { month: M });
    expect(again.pnl).toEqual(m.pnl);
    const now = await getMonthlyClosing(db, owner, { month: THIS });
    expect(now.pnl).toMatchObject({ cancelledOrderLabor: "0.00", unallocatedLabor: "0.00" });
    expect(now.cash.workerPayments).toBe("1200.00");
    // Supplier balances and treasury payments are untouched by reporting.
    expect(await db.outgoingPayment.count({ where: { orderCostId: { not: null } } })).toBe(1);
  });

  it("revenue: full-delivery month only, once; partial delivery is not revenue; the received-date view is provisional and cannot be confirmed", async () => {
    await seedMonth();
    const k = await order("3000");
    await closeCosts(k); // reviewed: no costs
    const g = (await getOrderDetails(db, owner, k))!.groups[0]!;
    await recordReady(db, owner, { orderId: k, orderGroupId: g.id, quantity: "10", readyDate: d(14), idempotencyKey: randomUUID() });
    await recordDelivery(db, owner, { orderId: k, orderGroupId: g.id, quantity: "6", deliveredAt: d(14), idempotencyKey: randomUUID() }); // partial in M
    expect((await getMonthlyClosing(db, owner, { month: M })).orders.some((o) => o.orderId === k)).toBe(false);
    await recordDelivery(db, owner, { orderId: k, orderGroupId: g.id, quantity: "4", deliveredAt: TODAY, idempotencyKey: randomUUID() }); // completed this month
    const months = [PREV, M, THIS];
    const hits = [];
    for (const month of months) hits.push((await getMonthlyClosing(db, owner, { month })).orders.filter((o) => o.orderId === k).length);
    expect(hits).toEqual([0, 0, 1]);
    const booking = await getMonthlyClosing(db, owner, { month: M, basis: "BOOKING" });
    expect(booking.orders.find((o) => o.orderId === k)).toMatchObject({ provisional: false }); // now delivered
    expect(booking.orders.filter((o) => o.provisional).length).toBeGreaterThan(0);
    await expect(confirmMonth(db, owner, { month: M, basis: "BOOKING", expectedVersion: 0, acknowledge: true })).rejects.toMatchObject({ fieldErrors: { basis: [expect.any(String)] } });
    for (const month of months) assertIdentities(await getMonthlyClosing(db, owner, { month }));
  });

  it("historical as-of balances: later payments never change last month's receivables or payables; later corrections are flagged as restatements", async () => {
    const cash = (await createAccount(db, owner, { name: "الخزنة", type: "CASH", openingBalance: "0", countDate: d(1), basis: "START_OF_DAY", confirmed: true })).id;
    const s = (await createSupplier(db, owner, { name: "مورد" })).id;
    const k = await order("5000");
    const first = await recordPayment(db, owner, { orderId: k, idempotencyKey: randomUUID(), amount: "1000", paidAt: d(5), method: "CASH", accountId: cash });
    await cost(k, "MATERIALS", "2000", s);
    // The owner closed the costs on the 6th of that month (simulated clock: only the app's "now" moves).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${d(6)}T10:00:00Z`));
    await closeCosts(k);
    vi.useRealTimers();
    const costId = (await db.orderCost.findFirstOrThrow({ where: { orderId: k } })).id;

    const before = await getMonthlyClosing(db, owner, { month: M });
    expect(before.balances).toMatchObject({ receivables: "4000.00", supplierPayables: "2000.00" });
    // This month: the customer pays 2,500 and we pay the supplier 1,500.
    await recordPayment(db, owner, { orderId: k, idempotencyKey: randomUUID(), amount: "2500", paidAt: TODAY, method: "CASH", accountId: cash });
    await payPayable(db, owner, "cost", { targetId: costId, idempotencyKey: randomUUID(), amount: "1500", paidAt: TODAY, method: "CASH", accountId: cash });
    const after = await getMonthlyClosing(db, owner, { month: M });
    expect(after.balances).toEqual(before.balances);
    expect(after.cash).toEqual(before.cash);
    expect(after.treasury!.ledgerClosing).toBe(before.treasury!.ledgerClosing);
    expect(after.restatements).toEqual([]);
    const now = await getMonthlyClosing(db, owner, { month: THIS });
    expect(now.balances).toMatchObject({ receivables: "1500.00", supplierPayables: "500.00" });

    // A correction to last month's records (void with a reason) restates it — visibly.
    await confirmMonth(db, owner, { month: M, expectedVersion: 0, acknowledge: true });
    await voidPayment(db, owner, { paymentId: first.paymentId, reason: "دفعة متسجلة بالغلط" });
    const restated = await getMonthlyClosing(db, owner, { month: M });
    expect(restated.restatements).toEqual([{ kind: "PAYMENT_VOIDED", count: 1 }]);
    expect(restated.balances.receivables).toBe("5000.00");
    expect(restated.close.status).toBe("CHANGED");
    expect(restated.close.changes).toEqual(expect.arrayContaining([{ key: "receivables", confirmed: "4000.00", now: "5000.00" }]));
    assertIdentities(restated);
  });

  it("refunds: cancelled orders holding payments and over-payments are listed, never netted; the month is not shown as reconciled", async () => {
    await seedMonth();
    expect((await getMonthlyClosing(db, owner, { month: M })).reconciled).toBe(true);
    const cancelled = await order("1000");
    await db.order.update({ where: { id: cancelled }, data: { status: "CANCELLED" } });
    const over = await order("500");
    const cashId = (await db.financialAccount.findFirstOrThrow({ where: { type: "CASH" } })).id;
    // Legacy rows the app would refuse today (cancel with payments / pay above price): fixture inserts.
    for (const [orderId, amount] of [[cancelled, "400"], [over, "650"]] as const) {
      await db.orderPayment.create({ data: { orderId, amount, paidAt: new Date(`${d(24)}T00:00:00Z`), method: "CASH", idempotencyKey: randomUUID(), recordedById: owner.id, accountId: cashId } });
    }
    const paymentsBefore = await db.orderPayment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, voidedAt: true } });
    const m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.unresolved).toEqual([
      expect.objectContaining({ orderId: cancelled, kind: "CANCELLED_WITH_PAYMENTS", amount: "400.00" }),
      expect.objectContaining({ orderId: over, kind: "OVERPAID", amount: "150.00" }),
    ]);
    expect(m.reconciled).toBe(false);
    expect(closeWarnings(m)).toEqual(expect.arrayContaining([expect.stringContaining("محتاجة قرار")]));
    // Not revenue, not netted: receivables exclude both, the money stays in the treasury as received.
    expect(m.pnl.revenue).toBe("13000.00");
    expect(m.treasury!.customerCollections).toBe("6050.00");
    expect(await db.orderPayment.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, voidedAt: true } })).toEqual(paymentsBefore);
    await expect(confirmMonth(db, owner, { month: M, expectedVersion: 0, acknowledge: false })).rejects.toMatchObject({ fieldErrors: { acknowledge: [expect.any(String)] } });
  });

  it("expenses: recognized by expense date, paid separately; order costs never appear as operating expenses; a transfer does not change company cash", async () => {
    await seedMonth();
    const before = await getMonthlyClosing(db, owner, { month: M });
    const { expenseId } = await recordExpense(db, owner, { idempotencyKey: randomUUID(), category: "MAINTENANCE", amount: "700", expenseDate: d(28), payStatus: "CREDIT" });
    await payPayable(db, owner, "expense", { targetId: expenseId, idempotencyKey: randomUUID(), amount: "700", paidAt: TODAY, method: "CASH", accountId: (await db.financialAccount.findFirstOrThrow({ where: { type: "CASH" } })).id });
    const m = await getMonthlyClosing(db, owner, { month: M });
    expect(m.pnl.operatingExpenses).toBe("1100.00"); // 400 + 700, recognized in M
    expect(m.cash.expensePayments).toBe(before.cash.expensePayments); // paid in a later month
    expect(m.balances.expensePayables).toBe("700.00"); // still owed at M's end
    const now = await getMonthlyClosing(db, owner, { month: THIS });
    expect(now.pnl.operatingExpenses).toBe("0.00");
    expect(now.cash.expensePayments).toBe("700.00");
    // Order costs (5,300 booked + 300 cancelled) never leak into expenses.
    expect(m.expenses.map((e) => e.amount).sort()).toEqual(["400.00", "700.00"]);
    // Another internal transfer: consolidated cash and every flow total unchanged.
    const accounts = await db.financialAccount.findMany();
    await recordMovement(db, owner, { kind: "TRANSFER", accountId: accounts.find((a) => a.type === "BANK")!.id, toAccountId: accounts.find((a) => a.type === "CASH")!.id, amount: "300", date: d(29), idempotencyKey: randomUUID() });
    const t = (await getMonthlyClosing(db, owner, { month: M })).treasury!;
    expect({ ...t, internalTransfers: "", accounts: [] }).toEqual({ ...m.treasury!, internalTransfers: "", accounts: [] });
    expect(t.internalTransfers).toBe("800.00");
    assertIdentities(m);
  });

  it("security: staff with costs/expenses access and partners never see profit, treasury or the monthly closing", async () => {
    const { a } = await seedMonth();
    for (const actor of [staff, partner]) {
      await expect(getOrderProfitability(db, actor, a)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getMonthlyClosing(db, actor, { month: M })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(confirmMonth(db, actor, { month: M, basis: "DELIVERY", expectedVersion: 0, acknowledge: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(generateFixedExpenses(db, actor, { month: M })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createRecurringExpense(db, actor, { category: "RENT", description: "x", amount: "1", dayOfMonth: 1, startMonth: M })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(getMonthlyClosing(db, owner, { month: "2026-13" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a manually recorded fixed expense counts as fixed, an ordinary one as operating; neither touches order profit", async () => {
    const { a } = await seedMonth();
    const before = await getMonthlyClosing(db, owner, { month: M });
    await recordExpense(db, owner, { idempotencyKey: randomUUID(), category: "SALARIES", amount: "4000", expenseDate: d(27), payStatus: "CREDIT", isFixed: true });
    await recordExpense(db, owner, { idempotencyKey: randomUUID(), category: "TRANSPORT", amount: "150", expenseDate: d(27), payStatus: "CREDIT" });
    const after = await getMonthlyClosing(db, owner, { month: M });
    expect(after.pnl.fixedExpenses).toBe("4000.00");
    expect(after.pnl.operatingExpenses).toBe("550.00");
    expect(after.pnl.grossProfit).toBe(before.pnl.grossProfit);
    expect((await getOrderProfitability(db, owner, a))!.grossProfit).toBe("6500.00");
    expect(after.balances.expensePayables).toBe("4150.00");
  });

  it("fixed expense templates: validated, not generated before their day or outside their months, stoppable", async () => {
    await expect(createRecurringExpense(db, owner, { category: "RENT", description: "إيجار", amount: "0", dayOfMonth: 1, startMonth: M })).rejects.toMatchObject({ fieldErrors: { amount: [expect.any(String)] } });
    await expect(createRecurringExpense(db, owner, { category: "RENT", description: "إيجار", amount: "10", dayOfMonth: 31, startMonth: M })).rejects.toMatchObject({ fieldErrors: { dayOfMonth: [expect.any(String)] } });
    await expect(createRecurringExpense(db, owner, { category: "RENT", description: "إيجار", amount: "10", dayOfMonth: 1, startMonth: M, endMonth: PREV })).rejects.toMatchObject({ fieldErrors: { endMonth: [expect.any(String)] } });
    await createRecurringExpense(db, owner, { category: "INTERNET", description: "إنترنت", amount: "300", dayOfMonth: 5, startMonth: M, endMonth: M });
    await createRecurringExpense(db, owner, { category: "SALARIES", description: "مرتب المحاسب", amount: "6000", dayOfMonth: 28, startMonth: PREV });
    expect(await generateFixedExpenses(db, owner, { month: PREV })).toEqual({ created: 1 }); // salary only (internet starts in M)
    expect(await generateFixedExpenses(db, owner, { month: shiftMonth(THIS, 1) })).toEqual({ created: 0 }); // future: not early
    expect(await generateFixedExpenses(db, owner, { month: M })).toEqual({ created: 2 });
    const rows = await db.generalExpense.findMany({ where: { recurringMonth: M }, orderBy: { amount: "asc" } });
    expect(rows.map((r) => [r.amount.toString(), r.isFixed, r.expenseDate.toISOString().slice(0, 10)])).toEqual([
      ["300", true, d(5)],
      ["6000", true, d(28)],
    ]);
    expect(await db.outgoingPayment.count()).toBe(0); // generating never pays
  });
});

function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
