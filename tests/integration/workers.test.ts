import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { monthRange, previousMonthRange, todayDateString } from "@/lib/dates";
import type { UpdateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import { createCustomer } from "@/server/services/customer-service";
import { getCashMovement } from "@/server/services/finance-summary-service";
import { getMonthlyWorkerSummary, getOrderLabor, getWorkerDetails } from "@/server/services/labor-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { voidOutgoingPayment } from "@/server/services/outgoing-payment-service";
import { recordWorkday, recordWorkLog, voidWorkday, voidWorkLog } from "@/server/services/work-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker, listWorkers, updateWorker } from "@/server/services/worker-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const MONTH = monthRange(TODAY);
const PREV = previousMonthRange(TODAY);
const prevDay = (n: number) => `${PREV.from.slice(0, 8)}${String(n).padStart(2, "0")}`;

describe.skipIf(!hasTestDatabase)("workers, wages & productivity (PostgreSQL)", () => {
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

  const youssef = (overrides: Record<string, unknown> = {}) =>
    createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300", dailyTarget: "300", targetUnit: "PRINT", ...overrides });

  async function order(customer: string, groups = [{ operations: ["DTF"], plain: false }], quantity = "200") {
    const c = await createCustomer(db, owner, { name: customer });
    return createOrder(db, owner, {
      idempotencyKey: randomUUID(),
      customer: { mode: "existing", id: c.id },
      title: `أوردر ${customer}`,
      productType: "تيشيرت",
      material: "قطن",
      quantity,
      unit: "PIECE",
      groups,
      totalPrice: "40000",
      advance: "0",
      receivedDate: TODAY,
      deliveryDate: "2099-01-15",
    });
  }
  const work = (workerId: string, extra: Record<string, unknown>) =>
    recordWorkLog(db, staff, { workerId, idempotencyKey: randomUUID(), workDate: TODAY, workType: "DTF", unit: "PRINT", quantity: "1", ...extra });
  const day = (workerId: string, workDate: string, extra: Record<string, unknown> = {}) =>
    recordWorkday(db, staff, { workerId, idempotencyKey: randomUUID(), workDate, worked: true, ...extra });
  const pay = (workerId: string, type: "WAGE" | "ADVANCE", amount: string, extra: Record<string, unknown> = {}) =>
    payWorker(db, owner, { workerId, idempotencyKey: randomUUID(), type, amount, paidAt: TODAY, method: "CASH", ...extra });

  // ─── Acceptance ───

  it("acceptance: Youssef 200 prints for Mahmoud + 100 for Ahmed = one 300 EGP wage split 200/100", async () => {
    const y = await youssef();
    const mahmoud = await order("محمود");
    const ahmed = await order("أحمد");

    const firstPayload = { workerId: y.id, idempotencyKey: randomUUID(), workDate: TODAY, workType: "DTF" as const, unit: "PRINT" as const, quantity: "200", orderId: mahmoud.orderId };
    const first = await recordWorkLog(db, staff, firstPayload);
    expect(first.createdWorkday).toBe(true); // recording work created the day's attendance
    // A repeated submit (double tap) returns the same log and still reports the auto-created day.
    expect(await recordWorkLog(db, staff, firstPayload)).toMatchObject({ workLogId: first.workLogId, created: false, createdWorkday: true });
    await work(y.id, { orderId: ahmed.orderId, quantity: "100" });

    const d = (await getWorkerDetails(db, owner, y.id))!;
    const today = d.days[0]!;
    expect(today.output).toEqual([{ unit: "PRINT", quantity: 300 }]);
    expect(today.achievement).toBe("100.00");
    expect(today.pay).toMatchObject({ wage: "300.00", costPerUnit: "1.00", basis: "QUANTITY", unallocated: "0.00" });

    expect((await getOrderLabor(db, owner, mahmoud.orderId)).total).toBe("200.00");
    expect((await getOrderLabor(db, owner, ahmed.orderId)).total).toBe("100.00");
    // The wage exists once: one workday, 300 earned.
    expect(await db.workerWorkday.count()).toBe(1);
    expect(d.pay).toMatchObject({ earnedTotal: "300.00", owed: "300.00" });

    // Logs never touch order production/delivery/status.
    const m = (await getOrderDetails(db, owner, mahmoud.orderId))!;
    expect(m.status).toBe("NEW");
    expect(m.quantity).toBe(200);
  });

  it("lower productivity: 250 prints → 83.33%, 1.20 EGP per print, full 300 EGP wage", async () => {
    const y = await youssef();
    const o = await order("محمود");
    await work(y.id, { orderId: o.orderId, quantity: "250" });
    const today = (await getWorkerDetails(db, owner, y.id))!.days[0]!;
    expect(today.achievement).toBe("83.33");
    expect(today.pay).toMatchObject({ wage: "300.00", costPerUnit: "1.20" });
    expect((await getOrderLabor(db, owner, o.orderId)).total).toBe("300.00");
  });

  it("monthly: 22 days × 300 = 6,600 earned; 2,000 paid → 4,600 still owed", async () => {
    const y = await youssef();
    for (let n = 1; n <= 22; n++) await day(y.id, prevDay(n));
    await pay(y.id, "WAGE", "2000");

    const d = (await getWorkerDetails(db, owner, y.id))!;
    expect(d.pay).toMatchObject({ earnedTotal: "6600.00", wagePaymentsTotal: "2000.00", owed: "4600.00", advanceOutstanding: "0.00" });

    // Expense by work date (last month) vs cash by payment date (this month).
    const last = await getMonthlyWorkerSummary(db, owner, PREV.from.slice(0, 7));
    expect(last.expense).toMatchObject({ workedDays: 22, wagesEarned: "6600.00", unallocatedLabor: "6600.00" });
    expect(last.cash.total).toBe("0.00");
    expect(last.balances.owedToWorkers).toBe("6600.00");

    const now = await getMonthlyWorkerSummary(db, owner, MONTH.from.slice(0, 7));
    expect(now.expense.wagesEarned).toBe("0.00"); // paying old wages is not a new wage expense
    expect(now.cash).toEqual({ wagePayments: "2000.00", advances: "0.00", total: "2000.00" });
    expect(now.balances.owedToWorkers).toBe("4600.00");
    expect(now.workers[0]).toMatchObject({ name: "يوسف", paidInMonth: "2000.00", balanceAtEnd: "4600.00" });
  });

  it("an advance is cash only: settled by later earned days, never a second wage expense", async () => {
    const y = await youssef();
    await pay(y.id, "ADVANCE", "1000");
    let d = (await getWorkerDetails(db, owner, y.id))!;
    expect(d.pay).toMatchObject({ earnedTotal: "0.00", advancesTotal: "1000.00", owed: "0.00", advanceOutstanding: "1000.00" });
    // Nothing is owed yet, so a wage payment is refused (it would be an advance).
    await expect(pay(y.id, "WAGE", "1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    for (let n = 1; n <= 5; n++) await day(y.id, prevDay(n));
    d = (await getWorkerDetails(db, owner, y.id))!;
    expect(d.pay).toMatchObject({ earnedTotal: "1500.00", owed: "500.00", advanceOutstanding: "0.00" });

    const summary = await getMonthlyWorkerSummary(db, owner, MONTH.from.slice(0, 7));
    expect(summary.expense.wagesEarned).toBe("0.00");
    expect(summary.cash).toEqual({ wagePayments: "0.00", advances: "1000.00", total: "1000.00" });
    expect((await getCashMovement(db, owner, MONTH)).paidToWorkers).toBe("1000.00");
  });

  // ─── Workdays ───

  it("snapshots the wage: changing the daily wage later does not change past days", async () => {
    const y = await youssef();
    await day(y.id, prevDay(1));
    await updateWorker(db, owner, y.id, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "350", dailyTarget: "300", targetUnit: "PRINT" });
    await day(y.id, prevDay(2));
    const wages = (await db.workerWorkday.findMany({ orderBy: { workDate: "asc" } })).map((w) => w.wage.toString());
    expect(wages).toEqual(["300", "350"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "WORKER_UPDATED" } });
    expect(log.metadata).toMatchObject({ changes: { dailyWage: { from: "300.00", to: "350.00" } } });
  });

  it("refuses a second record for the same worker and date (also under concurrency)", async () => {
    const y = await youssef();
    await day(y.id, prevDay(3));
    await expect(day(y.id, prevDay(3))).rejects.toMatchObject({ code: "CONFLICT" });
    const results = await Promise.allSettled([day(y.id, prevDay(4)), day(y.id, prevDay(4)), day(y.id, prevDay(4))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.workerWorkday.count({ where: { workDate: new Date(`${prevDay(4)}T00:00:00Z`) } })).toBe(1);
  });

  it("absence earns nothing; staff cannot set a wage; inactive workers cannot be recorded", async () => {
    const y = await youssef();
    await day(y.id, prevDay(5), { worked: false });
    expect((await getWorkerDetails(db, owner, y.id))!.pay!.earnedTotal).toBe("0.00");
    await expect(day(y.id, prevDay(6), { wage: "999" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await recordWorkday(db, owner, { workerId: y.id, idempotencyKey: randomUUID(), workDate: prevDay(6), worked: true, wage: "150" });
    expect((await getWorkerDetails(db, owner, y.id))!.pay!.earnedTotal).toBe("150.00");
    // Cannot log output on a day marked absent.
    await expect(work(y.id, { workDate: prevDay(5), quantity: "10" })).rejects.toMatchObject({ code: "CONFLICT" });

    await updateWorker(db, owner, y.id, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300", isActive: false });
    await expect(day(y.id, prevDay(7))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a worked day with no output stays as unallocated labour (no division by zero)", async () => {
    const y = await youssef();
    await day(y.id, TODAY);
    const today = (await getWorkerDetails(db, owner, y.id))!.days[0]!;
    expect(today.pay).toMatchObject({ wage: "300.00", costPerUnit: null, unallocated: "300.00", unallocatedReason: "NO_WORK" });
    expect(today.achievement).toBe("0.00");
    expect((await getMonthlyWorkerSummary(db, owner, MONTH.from.slice(0, 7))).expense.unallocatedLabor).toBe("300.00");
  });

  it("never adds different units: a second unit needs hours, and the wage is split by hours", async () => {
    const y = await youssef({ job: "GARMENT_MAKING", targetUnit: undefined, dailyTarget: undefined });
    const a = await order("أ");
    const b = await order("ب");
    await work(y.id, { orderId: a.orderId, workType: "CUTTING", unit: "METER", quantity: "50" });
    await expect(work(y.id, { orderId: b.orderId, workType: "SEWING", unit: "PIECE", quantity: "100" })).rejects.toMatchObject({
      fieldErrors: { hours: expect.any(Array) },
    });
    await work(y.id, { orderId: b.orderId, workType: "SEWING", unit: "PIECE", quantity: "100", hours: "2" });
    // The first log has no hours → the day can't be split: whole wage stays unallocated, units never summed.
    let today = (await getWorkerDetails(db, owner, y.id))!.days[0]!;
    expect(today.output).toEqual(expect.arrayContaining([{ unit: "METER", quantity: 50 }, { unit: "PIECE", quantity: 100 }]));
    expect(today.pay).toMatchObject({ basis: "NONE", unallocatedReason: "MIXED_UNITS_NO_HOURS", unallocated: "300.00", costPerUnit: null });

    // Owner corrects: void the first log and re-enter it with hours.
    const firstLog = (await db.workerWorkLog.findFirstOrThrow({ where: { unit: "METER" } })).id;
    await expect(voidWorkLog(db, staff, { id: firstLog, reason: "من غير ساعات" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidWorkLog(db, owner, { id: firstLog, reason: "من غير ساعات" });
    await work(y.id, { orderId: a.orderId, workType: "CUTTING", unit: "METER", quantity: "50", hours: "6" });
    today = (await getWorkerDetails(db, owner, y.id))!.days[0]!;
    expect(today.pay).toMatchObject({ basis: "HOURS", unallocated: "0.00" });
    expect((await getOrderLabor(db, owner, a.orderId)).total).toBe("225.00");
    expect((await getOrderLabor(db, owner, b.orderId)).total).toBe("75.00");
  });

  // ─── Payments ───

  it("pays wages without overpaying, also with simultaneous payments; duplicates are ignored", async () => {
    const y = await youssef();
    for (let n = 1; n <= 3; n++) await day(y.id, prevDay(n)); // 900 earned
    await expect(pay(y.id, "WAGE", "900.01")).rejects.toMatchObject({ fieldErrors: { amount: expect.any(Array) } });
    const results = await Promise.allSettled([pay(y.id, "WAGE", "600"), pay(y.id, "WAGE", "600")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const same = { workerId: y.id, idempotencyKey: randomUUID(), type: "WAGE" as const, amount: "100", paidAt: TODAY, method: "CASH" };
    const [a, b] = await Promise.all([payWorker(db, owner, same), payWorker(db, owner, same)]);
    expect(a.paymentId).toBe(b.paymentId);
    expect((await getWorkerDetails(db, owner, y.id))!.pay!.owed).toBe("200.00");
  });

  it("voids are owner-only, audited, and keep history", async () => {
    const y = await youssef();
    const o = await order("محمود");
    await work(y.id, { orderId: o.orderId, quantity: "300" });
    const p = await pay(y.id, "WAGE", "300");
    const workday = await db.workerWorkday.findFirstOrThrow();

    await expect(voidOutgoingPayment(db, staff, { id: p.paymentId, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(voidWorkday(db, staff, { id: workday.id, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await voidOutgoingPayment(db, owner, { id: p.paymentId, reason: "اتسجلت غلط" });
    expect((await getWorkerDetails(db, owner, y.id))!.pay!.owed).toBe("300.00");

    await voidWorkday(db, owner, { id: workday.id, reason: "مكانش موجود" });
    const d = (await getWorkerDetails(db, owner, y.id))!;
    expect(d.pay!.earnedTotal).toBe("0.00");
    expect(d.days[0]!.voided).toMatchObject({ reason: "مكانش موجود" });
    expect(await db.workerWorkLog.count({ where: { voidedAt: null } })).toBe(0);
    expect((await getOrderLabor(db, owner, o.orderId)).total).toBe("0.00");
    // The day can be recorded again after the correction.
    await day(y.id, TODAY);
    const actions = (await db.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["WORKDAY_VOIDED", "OUTGOING_PAYMENT_VOIDED", "WORKER_PAYMENT_RECORDED", "WORK_LOG_RECORDED"]));
  });

  // ─── Privacy ───

  it("staff record attendance and output but never see wages or labour money", async () => {
    const y = await youssef();
    const o = await order("محمود");
    await work(y.id, { orderId: o.orderId, quantity: "300" });

    const list = await listWorkers(db, staff);
    expect(list[0]).toMatchObject({ name: "يوسف", pay: null, today: { worked: true } });
    const d = (await getWorkerDetails(db, staff, y.id))!;
    expect(d.pay).toBeNull();
    expect(d.days[0]!.pay).toBeNull();
    expect(d.days[0]!.logs[0]!.share).toBeNull();
    expect(d.days[0]!.output).toEqual([{ unit: "PRINT", quantity: 300 }]);

    await expect(getMonthlyWorkerSummary(db, staff, MONTH.from.slice(0, 7))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOrderLabor(db, staff, o.orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payWorker(db, staff, { workerId: y.id, idempotencyKey: randomUUID(), type: "ADVANCE", amount: "1", paidAt: TODAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createWorker(db, staff, { name: "x", job: "OTHER", dailyWage: "1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listWorkers(db, owner))[0]!.pay).toMatchObject({ dailyWage: "300.00", owed: "300.00" });
  });

  // ─── Integrity ───

  it("rolls back the auto-created workday when saving the output fails", async () => {
    const y = await youssef();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_log() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated'; END; $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_log BEFORE INSERT ON worker_work_logs FOR EACH ROW EXECUTE FUNCTION test_fail_log()`);
    try {
      await expect(work(y.id, { quantity: "100" })).rejects.toThrow();
      expect(await db.workerWorkday.count()).toBe(0);
      expect(await db.auditLog.count({ where: { action: "WORKDAY_RECORDED" } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_log ON worker_work_logs`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_log()`);
    }
  });

  it("rejects a group that does not belong to the order", async () => {
    const y = await youssef();
    const a = await order("أ");
    const b = await order("ب");
    const groupOfB = (await getOrderDetails(db, owner, b.orderId))!.groups[0]!.id;
    await expect(work(y.id, { orderId: a.orderId, orderGroupId: groupOfB, quantity: "10" })).rejects.toMatchObject({
      fieldErrors: { orderGroupId: expect.any(Array) },
    });
  });

  // ─── Stable order-group ids ───

  it("editing an order keeps group ids; referenced groups can't be removed or cut below logged work; stale edits are refused", async () => {
    const y = await youssef({ job: "GARMENT_MAKING", targetUnit: "PIECE" });
    const o = await order("محمود", [
      { quantity: "120", operations: ["DTF"], plain: false },
      { quantity: "80", operations: ["EMBROIDERY"], plain: false },
    ] as never);
    let d = (await getOrderDetails(db, owner, o.orderId))!;
    const [g1, g2] = d.groups.map((g) => g.id);
    await work(y.id, { orderId: o.orderId, orderGroupId: g1, workType: "SEWING", unit: "PIECE", quantity: "100" });

    const base = (over: Partial<UpdateOrderPayload> = {}): UpdateOrderPayload => ({
      orderId: o.orderId,
      expectedUpdatedAt: d.updatedAt,
      customer: { mode: "existing" as const, id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      quantity: "200",
      unit: d.unit,
      totalPrice: "40000",
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: "NEW" as const,
      groups: [],
      ...over,
    });

    // Change operations/notes and add a third group: ids of existing groups survive.
    await updateOrder(db, owner, base({
      groups: [
        { id: g1, quantity: "100", operations: ["DTF", "EMBROIDERY"], plain: false, notes: "لوجو" },
        { id: g2, quantity: "60", operations: ["EMBROIDERY"], plain: false },
        { quantity: "40", operations: [], plain: true },
      ],
    }));
    d = (await getOrderDetails(db, owner, o.orderId))!;
    expect(d.groups.map((g) => g.id).slice(0, 2)).toEqual([g1, g2]);
    expect(d.groups[2]!.id).not.toBe(g1);
    expect(d.groups.map((g) => [g.quantity, g.description])).toEqual([[100, "DTF + تطريز"], [60, "تطريز"], [40, "بدون طباعة أو تطريز"]]);
    expect(await db.workerWorkLog.count({ where: { orderGroupId: g1, voidedAt: null } })).toBe(1);

    // Reordering keeps ids too.
    await updateOrder(db, owner, base({
      groups: [
        { id: d.groups[2]!.id, quantity: "40", operations: [], plain: true },
        { id: g1, quantity: "100", operations: ["DTF"], plain: false },
        { id: g2, quantity: "60", operations: ["EMBROIDERY"], plain: false },
      ],
    }));
    d = (await getOrderDetails(db, owner, o.orderId))!;
    expect(d.groups.map((g) => g.id)).toEqual([expect.any(String), g1, g2]);

    // Can't remove the group with logged work…
    await expect(updateOrder(db, owner, base({ groups: [{ id: g2, quantity: "200", operations: ["EMBROIDERY"], plain: false }] }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // …nor cut it below the 100 pieces already sewn.
    await expect(
      updateOrder(db, owner, base({
        groups: [
          { id: d.groups[0]!.id, quantity: "41", operations: [], plain: true },
          { id: g1, quantity: "99", operations: ["DTF"], plain: false },
          { id: g2, quantity: "60", operations: ["EMBROIDERY"], plain: false },
        ],
      })),
    ).rejects.toMatchObject({ fieldErrors: { "groups.1.quantity": expect.any(Array) } });

    // A screen opened before the last save can't overwrite it.
    const stale = "2000-01-01T00:00:00.000Z";
    await expect(updateOrder(db, owner, base({ expectedUpdatedAt: stale, groups: [{ id: g1, quantity: "200", operations: ["DTF"], plain: false }] }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // A group id from another order is refused.
    const other = await order("آخر");
    const foreign = (await getOrderDetails(db, owner, other.orderId))!.groups[0]!.id;
    await expect(
      updateOrder(db, owner, base({
        groups: [
          { id: foreign, quantity: "40", operations: [], plain: true },
          { id: g1, quantity: "100", operations: ["DTF"], plain: false },
          { id: g2, quantity: "60", operations: ["EMBROIDERY"], plain: false },
        ],
      })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
