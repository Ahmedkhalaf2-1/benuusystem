import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { monthRange, previousMonthRange, todayDateString } from "@/lib/dates";
import type { RecordExpensePayload, RecordOrderCostPayload } from "@/lib/validations/finance";
import type { Actor } from "@/server/services/actor";
import { getOrderCosts, recordOrderCost, voidOrderCost } from "@/server/services/cost-service";
import { createCustomer } from "@/server/services/customer-service";
import { getExpenseDetails, listExpenses, recordExpense, voidExpense } from "@/server/services/expense-service";
import {
  getCashMovement,
  getExpenseTotals,
  getFinanceDashboard,
  getSupplierOutstandingTotal,
} from "@/server/services/finance-summary-service";
import { getOrderDetails } from "@/server/services/order-service";
import { payPayable, voidOutgoingPayment } from "@/server/services/outgoing-payment-service";
import { createSupplier, getSupplierDetails, listSuppliers, searchSuppliers } from "@/server/services/supplier-service";
import {
  createTestPrisma,
  createTestUser,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase, createSharedOrder } from "../support/test-db";

const TODAY = todayDateString();
const MONTH = monthRange(TODAY);
const PREV = previousMonthRange(TODAY);

describe.skipIf(!hasTestDatabase)("order costs, suppliers & expenses (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;
  let orderId: string;

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
    const mahmoud = await createCustomer(db, owner, { name: "محمود" });
    orderId = (
      await createSharedOrder(db, owner, {
        idempotencyKey: randomUUID(),
        customer: { mode: "existing", id: mahmoud.id },
        title: "200 تيشيرت",
        productType: "تيشيرت",
        material: "قطن",
        quantity: "200",
        unit: "PIECE",
        groups: [{ operations: ["DTF"], plain: false }],
        totalPrice: "40000",
        advance: "20000",
        advanceMethod: "CASH",
        receivedDate: TODAY,
        deliveryDate: "2099-01-15",
      })
    ).orderId;
  });

  const cost = (overrides: Partial<RecordOrderCostPayload> = {}): RecordOrderCostPayload => ({
    orderId,
    idempotencyKey: randomUUID(),
    category: "MATERIALS",
    description: "شراء قماش قطن",
    amount: "14000",
    costDate: TODAY,
    payStatus: "CREDIT",
    ...overrides,
  });
  const expense = (overrides: Partial<RecordExpensePayload> = {}): RecordExpensePayload => ({
    idempotencyKey: randomUUID(),
    category: "ELECTRICITY",
    amount: "2000",
    expenseDate: TODAY,
    payStatus: "FULL",
    method: "CASH",
    ...overrides,
  });
  const pay = (targetId: string, amount: string, extra: Record<string, unknown> = {}) => ({
    targetId,
    idempotencyKey: randomUUID(),
    amount,
    paidAt: TODAY,
    method: "CASH",
    ...extra,
  });

  // ─── Acceptance scenario ───

  it("acceptance: Mahmoud's order costs, Ahmed Fabrics balance, electricity, cash movement", async () => {
    const fabric = await recordOrderCost(
      db,
      staff,
      cost({ supplier: { mode: "new", name: "Ahmed Fabrics" }, payStatus: "PARTIAL", paidNow: "6000" }),
    );
    await recordOrderCost(db, staff, cost({ category: "PRINTING", description: "طباعة DTF", amount: "3000", payStatus: "FULL" }));
    await recordExpense(db, staff, expense({ description: "فاتورة الكهرباء" }));

    const costs = await getOrderCosts(db, owner, orderId);
    expect(costs.totals).toEqual({ costs: "17000.00", paid: "9000.00", outstanding: "8000.00" });
    expect(costs.entries.map((e) => [e.description, e.status])).toEqual(
      expect.arrayContaining([
        ["شراء قماش قطن", "PARTIAL"],
        ["طباعة DTF", "PAID"],
      ]),
    );

    const supplierId = (await db.orderCost.findUniqueOrThrow({ where: { id: fabric.costId } })).supplierId!;
    const supplier = (await getSupplierDetails(db, owner, supplierId))!;
    expect(supplier.name).toBe("Ahmed Fabrics");
    expect(supplier.totals).toEqual({ purchased: "14000.00", paid: "6000.00", outstanding: "8000.00" });

    expect(await getExpenseTotals(db, owner, MONTH)).toEqual({ recorded: "2000.00", paid: "2000.00", remaining: "0.00" });

    // Customer side is untouched by costs.
    const order = (await getOrderDetails(db, owner, orderId))!;
    expect(order.money!.paid).toBe("20000.00");
    expect(order.money!.outstanding).toBe("20000.00");

    // Cash: +20,000 in, −6,000 −3,000 −2,000 out = +9,000.
    expect(await getCashMovement(db, owner, MONTH)).toEqual({
      customerPaymentsIn: "20000.00",
      paidForOrderCosts: "9000.00",
      paidForExpenses: "2000.00",
      paidToWorkers: "0.00",
      totalPaidOut: "11000.00",
      net: "9000.00",
    });

    // Electricity is not an order cost; there is no link between them at all.
    expect(costs.entries).toHaveLength(2);
    expect(await db.outgoingPayment.count({ where: { expenseId: { not: null }, orderCostId: { not: null } } })).toBe(0);
  });

  // ─── Order costs ───

  it("records a fully paid cost: full cost + one equal payment", async () => {
    const r = await recordOrderCost(db, staff, cost({ amount: "3000", payStatus: "FULL", method: "INSTAPAY" }));
    const payments = await db.outgoingPayment.findMany({ where: { orderCostId: r.costId } });
    expect(payments.map((p) => [p.amount.toString(), p.method])).toEqual([["3000", "INSTAPAY"]]);
    expect((await getOrderCosts(db, owner, orderId)).totals).toEqual({ costs: "3000.00", paid: "3000.00", outstanding: "0.00" });
  });

  it("records a credit purchase: counts as cost, NOT as cash paid", async () => {
    await recordOrderCost(db, staff, cost({ payStatus: "CREDIT" }));
    expect(await db.outgoingPayment.count()).toBe(0);
    expect((await getOrderCosts(db, owner, orderId)).totals).toEqual({ costs: "14000.00", paid: "0.00", outstanding: "14000.00" });
    expect((await getCashMovement(db, owner, MONTH)).paidForOrderCosts).toBe("0.00");
  });

  it("validates the partially-paid amount", async () => {
    await expect(recordOrderCost(db, staff, cost({ payStatus: "PARTIAL", paidNow: "" }))).rejects.toMatchObject({
      fieldErrors: { paidNow: ["اكتب المبلغ اللي اتدفع"] },
    });
    await expect(recordOrderCost(db, staff, cost({ payStatus: "PARTIAL", paidNow: "14000" }))).rejects.toMatchObject({
      fieldErrors: { paidNow: expect.any(Array) },
    });
    await expect(recordOrderCost(db, staff, cost({ amount: "0" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.orderCost.count()).toBe(0);
  });

  // ─── Suppliers ───

  it("supplier balance across a purchase and several later payments; no overpayment", async () => {
    const ahmed = await createSupplier(db, staff, { name: "Ahmed Fabrics", phone: "01011112222" });
    const fabric = await recordOrderCost(
      db,
      staff,
      cost({ supplier: { mode: "existing", id: ahmed.id }, payStatus: "PARTIAL", paidNow: "6000" }),
    );
    await payPayable(db, staff, "cost", pay(fabric.costId, "3000"));
    let details = (await getSupplierDetails(db, owner, ahmed.id))!;
    expect(details.totals).toEqual({ purchased: "14000.00", paid: "9000.00", outstanding: "5000.00" });
    expect(details.payments).toHaveLength(2);
    expect(details.purchases[0]).toMatchObject({ remaining: "5000.00", status: "PARTIAL", orderNumber: 1 });

    await expect(payPayable(db, staff, "cost", pay(fabric.costId, "5000.01"))).rejects.toMatchObject({
      fieldErrors: { amount: ["المبلغ أكبر من الباقي (5,000 ج.م)"] },
    });
    await payPayable(db, staff, "cost", pay(fabric.costId, "5000"));
    await expect(payPayable(db, staff, "cost", pay(fabric.costId, "1"))).rejects.toMatchObject({
      fieldErrors: { amount: ["ده متدفع بالكامل"] },
    });
    details = (await getSupplierDetails(db, owner, ahmed.id))!;
    expect(details.totals.outstanding).toBe("0.00");

    // Supplier payments never become costs: the order's cost is still 14,000.
    expect((await getOrderCosts(db, owner, orderId)).totals.costs).toBe("14000.00");
    expect(await db.orderCost.count()).toBe(1);

    const list = await listSuppliers(db, owner, {});
    expect(list.items[0]).toMatchObject({ name: "Ahmed Fabrics", purchased: "14000.00", outstanding: "0.00" });
    expect((await searchSuppliers(db, staff, "١١١٢")).map((s) => s.name)).toEqual(["Ahmed Fabrics"]);
  });

  it("does not let two simultaneous payments overpay a cost", async () => {
    const r = await recordOrderCost(db, staff, cost({ amount: "1000" }));
    const results = await Promise.allSettled([
      payPayable(db, staff, "cost", pay(r.costId, "700")),
      payPayable(db, staff, "cost", pay(r.costId, "700")),
      payPayable(db, staff, "cost", pay(r.costId, "700")),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await getOrderCosts(db, owner, orderId)).totals.paid).toBe("700.00");
  });

  it("ignores duplicate submissions of costs, expenses and payments", async () => {
    const c = cost({ payStatus: "PARTIAL", paidNow: "100", supplier: { mode: "new", name: "مورد" } });
    const costs = await Promise.all([recordOrderCost(db, staff, c), recordOrderCost(db, staff, c), recordOrderCost(db, staff, c)]);
    expect(new Set(costs.map((x) => x.costId)).size).toBe(1);
    expect(await db.orderCost.count()).toBe(1);
    expect(await db.supplier.count()).toBe(1);
    expect(await db.outgoingPayment.count()).toBe(1);

    const e = expense({ payStatus: "CREDIT" });
    await Promise.all([recordExpense(db, staff, e), recordExpense(db, staff, e)]);
    expect(await db.generalExpense.count()).toBe(1);

    const p = pay(costs[0]!.costId, "50");
    const pays = await Promise.all([payPayable(db, staff, "cost", p), payPayable(db, staff, "cost", p)]);
    expect(pays[0]!.paymentId).toBe(pays[1]!.paymentId);
    expect(await db.outgoingPayment.count()).toBe(2);
  });

  // ─── General expenses ───

  it("records partially paid expenses and pays the rest later", async () => {
    const rent = await recordExpense(db, staff, expense({ category: "RENT", amount: "5000", payStatus: "PARTIAL", paidNow: "3000" }));
    let d = (await getExpenseDetails(db, owner, rent.expenseId))!;
    expect([d.paid, d.remaining, d.status]).toEqual(["3000.00", "2000.00", "PARTIAL"]);
    await payPayable(db, staff, "expense", pay(rent.expenseId, "2000", { method: "BANK_TRANSFER" }));
    d = (await getExpenseDetails(db, owner, rent.expenseId))!;
    expect([d.paid, d.remaining, d.status]).toEqual(["5000.00", "0.00", "PAID"]);
    await expect(payPayable(db, staff, "expense", pay(rent.expenseId, "1"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("monthly totals: by expense date for recorded amounts, by payment date for cash", async () => {
    await recordExpense(db, staff, expense({ category: "RENT", amount: "5000", expenseDate: PREV.from, payStatus: "CREDIT" }));
    await recordExpense(db, staff, expense({ amount: "2000" }));
    await recordExpense(db, staff, expense({ category: "INTERNET", amount: "500", payStatus: "PARTIAL", paidNow: "200" }));

    // Last month's rent paid this month: it is THIS month's cash, but LAST month's expense.
    const rent = await db.generalExpense.findFirstOrThrow({ where: { category: "RENT" } });
    await payPayable(db, staff, "expense", pay(rent.id, "5000"));

    expect(await getExpenseTotals(db, owner, MONTH)).toEqual({ recorded: "2500.00", paid: "2200.00", remaining: "300.00" });
    expect(await getExpenseTotals(db, owner, PREV)).toEqual({ recorded: "5000.00", paid: "5000.00", remaining: "0.00" });
    expect((await getCashMovement(db, owner, MONTH)).paidForExpenses).toBe("7200.00");

    const listed = await listExpenses(db, owner, { ...MONTH, category: "INTERNET" });
    expect(listed.items.map((i) => [i.amount, i.paid, i.remaining])).toEqual([["500.00", "200.00", "300.00"]]);
    expect(listed.totals).toMatchObject({ recorded: "500.00", paid: "200.00", count: 1 });

    const dash = await getFinanceDashboard(db, owner);
    expect(dash).toMatchObject({ expensesThisMonth: "2500.00", expensesPaidThisMonth: "2200.00", paidOutThisMonth: "7200.00" });
  });

  it("a general expense is never counted as an order cost (and vice versa)", async () => {
    await recordExpense(db, staff, expense({ amount: "2000" }));
    await recordOrderCost(db, staff, cost({ amount: "3000", payStatus: "FULL" }));
    expect((await getOrderCosts(db, owner, orderId)).totals.costs).toBe("3000.00");
    expect((await getExpenseTotals(db, owner, MONTH)).recorded).toBe("2000.00");
  });

  // ─── Voiding & permissions ───

  it("owner voids payments, then the cost; voided records stay visible but stop counting; all audited", async () => {
    const r = await recordOrderCost(db, staff, cost({ amount: "3000", payStatus: "FULL", supplier: { mode: "new", name: "مطبعة" } }));
    const paymentId = (await db.outgoingPayment.findFirstOrThrow({ where: { orderCostId: r.costId } })).id;

    await expect(voidOutgoingPayment(db, staff, { id: paymentId, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(voidOrderCost(db, staff, { id: r.costId, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(voidOrderCost(db, owner, { id: r.costId, reason: "مكررة" })).rejects.toMatchObject({ code: "CONFLICT" });

    await voidOutgoingPayment(db, owner, { id: paymentId, reason: "اتسجلت مرتين" });
    let summary = await getOrderCosts(db, owner, orderId);
    expect(summary.totals).toEqual({ costs: "3000.00", paid: "0.00", outstanding: "3000.00" });
    expect(summary.entries[0]!.payments[0]!.voided).toMatchObject({ reason: "اتسجلت مرتين" });

    await voidOrderCost(db, owner, { id: r.costId, reason: "مكررة" });
    summary = await getOrderCosts(db, owner, orderId);
    expect(summary.totals).toEqual({ costs: "0.00", paid: "0.00", outstanding: "0.00" });
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0]!.voided).toMatchObject({ reason: "مكررة" });
    expect(await getSupplierOutstandingTotal(db, owner)).toBe("0.00");
    await expect(payPayable(db, staff, "cost", pay(r.costId, "1"))).rejects.toMatchObject({ code: "CONFLICT" });

    const actions = (await db.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["ORDER_COST_RECORDED", "OUTGOING_PAYMENT_RECORDED", "OUTGOING_PAYMENT_VOIDED", "ORDER_COST_VOIDED", "SUPPLIER_CREATED"]),
    );
  });

  it("owner voids an unpaid expense; staff cannot", async () => {
    const e = await recordExpense(db, staff, expense({ payStatus: "CREDIT" }));
    await expect(voidExpense(db, staff, { id: e.expenseId, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidExpense(db, owner, { id: e.expenseId, reason: "اتسجل غلط" });
    expect((await getExpenseTotals(db, owner, MONTH)).recorded).toBe("0.00");
    const listed = await listExpenses(db, owner, MONTH);
    expect(listed.items[0]).toMatchObject({ voided: true });
    expect(await db.auditLog.count({ where: { action: "EXPENSE_VOIDED" } })).toBe(1);
  });

  it("keeps company-wide money owner-only while staff can still record", async () => {
    // Staff can record a cost (with what was paid) and an expense…
    const r = await recordOrderCost(db, staff, cost({ payStatus: "PARTIAL", paidNow: "100", supplier: { mode: "new", name: "مورد" } }));
    await recordExpense(db, staff, expense());
    expect(r.created).toBe(true);
    // …and pick suppliers by name, but not see totals or balances.
    expect((await searchSuppliers(db, staff, "مورد")).length).toBe(1);
    const supplierId = (await db.supplier.findFirstOrThrow()).id;
    for (const read of [
      () => getOrderCosts(db, staff, orderId),
      () => listSuppliers(db, staff, {}),
      () => getSupplierDetails(db, staff, supplierId),
      () => listExpenses(db, staff, MONTH),
      () => getExpenseTotals(db, staff, MONTH),
      () => getCashMovement(db, staff, MONTH),
      () => getSupplierOutstandingTotal(db, staff),
      () => getFinanceDashboard(db, staff),
    ]) {
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("enforces permissions in services", async () => {
    const nobody = { id: staff.id, role: "UNKNOWN" } as unknown as Actor;
    await expect(recordOrderCost(db, nobody, cost())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordExpense(db, nobody, expense())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSupplier(db, nobody, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOrderCosts(db, nobody, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listExpenses(db, nobody, MONTH)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects payments dated in the future", async () => {
    const r = await recordOrderCost(db, staff, cost());
    await expect(payPayable(db, staff, "cost", pay(r.costId, "10", { paidAt: "2099-01-01" }))).rejects.toMatchObject({
      fieldErrors: { paidAt: expect.any(Array) },
    });
  });

  it("rolls back cost + new supplier when the initial payment fails", async () => {
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_outgoing() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END; $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_outgoing BEFORE INSERT ON outgoing_payments FOR EACH ROW EXECUTE FUNCTION test_fail_outgoing()`,
    );
    try {
      await expect(
        recordOrderCost(db, staff, cost({ supplier: { mode: "new", name: "مؤقت" }, payStatus: "FULL" })),
      ).rejects.toThrow();
      await expect(recordExpense(db, staff, expense())).rejects.toThrow();
      expect(await db.orderCost.count()).toBe(0);
      expect(await db.supplier.count()).toBe(0);
      expect(await db.generalExpense.count()).toBe(0);
      expect(await db.auditLog.count({ where: { action: { in: ["ORDER_COST_RECORDED", "EXPENSE_RECORDED", "SUPPLIER_CREATED"] } } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_outgoing ON outgoing_payments`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_outgoing()`);
    }
  });

  it("the database itself refuses a payment pointing at both a cost and an expense", async () => {
    const c = await recordOrderCost(db, staff, cost());
    const e = await recordExpense(db, staff, expense({ payStatus: "CREDIT" }));
    await expect(
      db.outgoingPayment.create({
        data: {
          orderCostId: c.costId,
          expenseId: e.expenseId,
          amount: "1",
          paidAt: new Date(`${TODAY}T00:00:00Z`),
          method: "CASH",
          idempotencyKey: randomUUID(),
          recordedById: staff.id,
        },
      }),
    ).rejects.toThrow();
  });
});
