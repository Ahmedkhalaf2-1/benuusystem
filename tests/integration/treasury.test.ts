import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import type { Actor } from "@/server/services/actor";
import { recordOrderCost } from "@/server/services/cost-service";
import { recordExpense } from "@/server/services/expense-service";
import { getCashMovement } from "@/server/services/finance-summary-service";
import { getOrderDetails } from "@/server/services/order-service";
import { payPayable, voidOutgoingPayment } from "@/server/services/outgoing-payment-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import {
  attributePayment,
  createAccount,
  getLedger,
  getTreasuryOverview,
  listAccountOptions,
  reconcileAccount,
  recordMovement,
  voidMovement,
} from "@/server/services/treasury-service";
import { payWorker } from "@/server/services/worker-payment-service";
import { createWorker } from "@/server/services/worker-service";
import { createSharedOrder, createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const daysAgo = (n: number) => dateToString(new Date(dateFromString(TODAY).getTime() - n * 86_400_000));
const CUTOVER = daysAgo(10);
const RANGE = { from: daysAgo(30), to: TODAY };

describe.skipIf(!hasTestDatabase)("treasury & cash accounts (PostgreSQL)", () => {
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
    staff = await createTestUser(db, "STAFF", undefined, ["orders:view", "orders:view-prices", "payments:view", "payments:record", "expenses:record", "payables:pay", "costs:record", "customers:view"]);
  });

  const open = async (name: string, type: "CASH" | "BANK" | "WALLET", openingBalance: string, openingDate = CUTOVER) =>
    (await createAccount(db, owner, { name, type, openingBalance, openingDate, confirmed: true })).id;
  const overview = () => getTreasuryOverview(db, owner, RANGE);
  const balance = async (id: string) => (await overview()).accounts.find((a) => a.id === id)!.balance;
  const order = async (extra: Record<string, unknown> = {}) =>
    (
      await createSharedOrder(db, owner, {
        idempotencyKey: randomUUID(),
        customer: { mode: "new", name: "محمود" },
        title: "تيشيرتات",
        productType: "تيشيرت",
        material: "قطن",
        quantity: "100",
        unit: "PIECE",
        groups: [{ operations: ["DTF"], plain: false }],
        totalPrice: "40000",
        advance: "0",
        advanceMethod: "CASH",
        receivedDate: TODAY,
        deliveryDate: "2099-01-01",
        ...extra,
      } as never)
    ).orderId;
  const pay = (orderId: string, amount: string, accountId?: string, extra: Record<string, unknown> = {}) =>
    recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount, paidAt: TODAY, method: "CASH", ...(accountId ? { accountId } : {}), ...extra });

  it("is honestly incomplete before setup — no fabricated zero", async () => {
    const o = await overview();
    expect(o).toMatchObject({ complete: false, total: null, accounts: [], issues: [{ kind: "NO_ACCOUNTS" }] });
    // Payments still work without an account before setup.
    const orderId = await order();
    await pay(orderId, "500");
    expect((await overview()).total).toBeNull();
  });

  it("EGP 40,000 unpaid order and EGP 1,000 unpaid electricity never move money; paid electricity reduces the chosen account", async () => {
    const cash = await open("خزنة المحل", "CASH", "5000");
    const bank = await open("بنك مصر", "BANK", "20000");
    expect((await overview()).total).toBe("25000.00");

    await order(); // 40,000 sold, nothing paid
    await recordExpense(db, staff, { idempotencyKey: randomUUID(), category: "ELECTRICITY", amount: "1000", expenseDate: TODAY, payStatus: "CREDIT" });
    let o = await overview();
    expect(o).toMatchObject({ total: "25000.00", complete: true, receivables: "40000.00" });

    await recordExpense(db, staff, { idempotencyKey: randomUUID(), category: "ELECTRICITY", amount: "1000", expenseDate: TODAY, payStatus: "FULL", method: "CASH", accountId: cash });
    o = await overview();
    expect(o.accounts.find((a) => a.id === cash)!.balance).toBe("4000.00");
    expect(o.accounts.find((a) => a.id === bank)!.balance).toBe("20000.00");
    expect(o.total).toBe("24000.00");
    expect(o.byType).toEqual({ CASH: "4000.00", BANK: "20000.00" });
  });

  it("customer advances and partial payments go into the chosen account exactly once — retries and races included", async () => {
    const cash = await open("خزنة", "CASH", "0");
    const bank = await open("بنك", "BANK", "0");
    const orderId = await order({ advance: "3000", advanceMethod: "BANK_TRANSFER", advanceAccountId: bank });
    expect(await balance(bank)).toBe("3000.00");

    const key = randomUUID();
    const body = { orderId, idempotencyKey: key, amount: "2000", paidAt: TODAY, method: "CASH", accountId: cash };
    await Promise.all([recordPayment(db, staff, body), recordPayment(db, staff, body), recordPayment(db, staff, body)]);
    await recordPayment(db, staff, body);
    expect(await balance(cash)).toBe("2000.00");
    expect((await getOrderDetails(db, owner, orderId))!.money).toMatchObject({ paid: "5000.00", outstanding: "35000.00" });
  });

  it("after setup an account is required; backdated payments before the cutover are already in the opening balance", async () => {
    const cash = await open("خزنة", "CASH", "1000");
    const orderId = await order();
    await expect(pay(orderId, "100")).rejects.toMatchObject({ fieldErrors: { accountId: expect.any(Array) } });
    // Dated before the cutover: no account (counted in the opening balance), and attributing it is refused.
    const old = await pay(orderId, "100", undefined, { paidAt: daysAgo(20) });
    await expect(pay(orderId, "100", cash, { paidAt: daysAgo(20) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await balance(cash)).toBe("1000.00");
    expect((await overview()).complete).toBe(true);
    await expect(attributePayment(db, owner, { side: "in", paymentId: old.paymentId, accountId: cash })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("voided payments drop out once; nothing is deleted", async () => {
    const cash = await open("خزنة", "CASH", "0");
    const orderId = await order();
    const p = await pay(orderId, "700", cash);
    expect(await balance(cash)).toBe("700.00");
    await voidPayment(db, owner, { paymentId: p.paymentId, reason: "اتسجلت غلط" });
    expect(await balance(cash)).toBe("0.00");
    expect(await db.orderPayment.count()).toBe(1);

    const e = await recordExpense(db, staff, { idempotencyKey: randomUUID(), category: "RENT", amount: "300", expenseDate: TODAY, payStatus: "FULL", method: "CASH", accountId: cash });
    expect(await balance(cash)).toBe("-300.00");
    const out = await db.outgoingPayment.findFirstOrThrow({ where: { expenseId: e.expenseId } });
    await voidOutgoingPayment(db, owner, { id: out.id, reason: "غلط" });
    expect(await balance(cash)).toBe("0.00");
  });

  it("wages, worker advances and supplier payments leave the chosen account; unpaid costs don't", async () => {
    const cash = await open("خزنة", "CASH", "10000");
    const orderId = await order();
    const { workerId } = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300", dailyTarget: "300", targetUnit: "PRINT" } as never).then((w) => ({ workerId: (w as { id: string }).id }));
    await payWorker(db, owner, { workerId, idempotencyKey: randomUUID(), type: "ADVANCE", amount: "500", paidAt: TODAY, method: "CASH", accountId: cash });
    const cost = await recordOrderCost(db, staff, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", description: "قماش", amount: "4000", costDate: TODAY, payStatus: "CREDIT" });
    expect(await balance(cash)).toBe("9500.00");
    await payPayable(db, staff, "cost", { targetId: cost.costId, idempotencyKey: randomUUID(), amount: "1500", paidAt: TODAY, method: "CASH", accountId: cash });
    expect(await balance(cash)).toBe("8000.00");
  });

  it("transfers keep total money unchanged and aren't counted as in/out in the combined ledger; capital and drawings are tracked separately", async () => {
    const cash = await open("خزنة", "CASH", "5000");
    const bank = await open("بنك", "BANK", "1000");
    const key = randomUUID();
    const t = { kind: "TRANSFER", accountId: cash, toAccountId: bank, amount: "2000", date: TODAY, idempotencyKey: key };
    await Promise.all([recordMovement(db, owner, t), recordMovement(db, owner, t)]);
    let o = await overview();
    expect(o.total).toBe("6000.00");
    expect(o.byType).toEqual({ CASH: "3000.00", BANK: "3000.00" });

    await recordMovement(db, owner, { kind: "CAPITAL_IN", accountId: bank, amount: "10000", date: TODAY, idempotencyKey: randomUUID() });
    await recordMovement(db, owner, { kind: "DRAWING", accountId: cash, amount: "1000", date: TODAY, idempotencyKey: randomUUID() });
    o = await overview();
    expect(o.total).toBe("15000.00");
    expect(o.period).toMatchObject({ capitalIn: "10000.00", drawings: "1000.00", receipts: "0.00", payments: "0.00", net: "0.00" });

    const combined = await getLedger(db, owner, { from: TODAY, to: TODAY });
    expect(combined).toMatchObject({ opening: "6000.00", totalIn: "10000.00", totalOut: "1000.00", closing: "15000.00" });
    expect(combined.rows.filter((r) => r.kind === "TRANSFER")).toHaveLength(1);
    const cashOnly = await getLedger(db, owner, { accountId: cash, from: TODAY, to: TODAY });
    expect(cashOnly).toMatchObject({ opening: "5000.00", totalOut: "3000.00", closing: "2000.00" });

    await expect(recordMovement(db, owner, { ...t, toAccountId: cash, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recordMovement(db, owner, { kind: "ADJUSTMENT", accountId: cash, direction: "IN", amount: "5", date: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ fieldErrors: { notes: expect.any(Array) } });
    // Voiding keeps the row and reverses its effect.
    const mv = await db.treasuryMovement.findFirstOrThrow({ where: { kind: "DRAWING" } });
    await voidMovement(db, owner, { id: mv.id, reason: "اتسجلت مرتين" });
    expect((await overview()).total).toBe("16000.00");
    expect(await db.treasuryMovement.count()).toBe(3);
  });

  it("ledger shows opening/closing per period and unknown before the opening date", async () => {
    const cash = await open("خزنة", "CASH", "1000", daysAgo(5));
    const before = await getLedger(db, owner, { accountId: cash, from: daysAgo(20), to: daysAgo(10) });
    expect(before).toMatchObject({ opening: null, closing: null });
    const spanning = await getLedger(db, owner, { accountId: cash, from: daysAgo(20), to: TODAY });
    expect(spanning.opening).toBeNull();
    expect(spanning.closing).toBe("1000.00");
    expect(spanning.rows[0]).toMatchObject({ reference: "رصيد افتتاحي (جرد مؤكد)", moneyIn: "1000.00", internal: true });
  });

  it("reconciliation records discrepancies against the system balance; optional audited adjustment", async () => {
    const cash = await open("خزنة", "CASH", "1000");
    const r1 = await reconcileAccount(db, owner, { accountId: cash, date: TODAY, counted: "950", idempotencyKey: randomUUID() });
    expect(r1).toMatchObject({ system: "1000.00", counted: "950.00", difference: "-50.00", adjustmentId: null });
    expect(await balance(cash)).toBe("1000.00"); // a count never silently rewrites the books
    await expect(reconcileAccount(db, owner, { accountId: cash, date: TODAY, counted: "950", adjust: true, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const r2 = await reconcileAccount(db, owner, { accountId: cash, date: TODAY, counted: "950", adjust: true, notes: "فكة ناقصة", idempotencyKey: randomUUID() });
    expect(r2.adjustmentId).not.toBeNull();
    expect(await balance(cash)).toBe("950.00");
    expect(await db.auditLog.count({ where: { action: "TREASURY_RECONCILED" } })).toBe(2);
  });

  it("negative balances are reported, never clamped", async () => {
    const cash = await open("خزنة", "CASH", "100");
    await recordMovement(db, owner, { kind: "DRAWING", accountId: cash, amount: "250", date: TODAY, idempotencyKey: randomUUID() });
    const o = await overview();
    expect(o.accounts[0]!.balance).toBe("-150.00");
    expect(o.issues).toContainEqual({ kind: "NEGATIVE", accountName: "خزنة" });
  });

  it("unattributed post-cutover payments make the treasury incomplete until the owner attributes them (audited)", async () => {
    const orderId = await order();
    const legacy = await pay(orderId, "800"); // recorded before the treasury existed, dated today
    const cash = await open("خزنة", "CASH", "1000");
    let o = await overview();
    expect(o.complete).toBe(false);
    expect(o.total).toBeNull();
    expect(o.unattributed.map((u) => u.id)).toEqual([legacy.paymentId]);

    await attributePayment(db, owner, { side: "in", paymentId: legacy.paymentId, accountId: cash });
    o = await overview();
    expect(o).toMatchObject({ complete: true, total: "1800.00" });
    // Moving it to another account needs a reason.
    const bank = await open("بنك", "BANK", "0");
    await expect(attributePayment(db, owner, { side: "in", paymentId: legacy.paymentId, accountId: bank })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await attributePayment(db, owner, { side: "in", paymentId: legacy.paymentId, accountId: bank, reason: "اتحولت على البنك" });
    expect(await db.auditLog.count({ where: { action: "PAYMENT_ACCOUNT_ATTRIBUTED" } })).toBe(2);
  });

  it("historical records and reports are preserved; attribution changes no amount", async () => {
    const orderId = await order();
    await pay(orderId, "1200");
    await recordExpense(db, staff, { idempotencyKey: randomUUID(), category: "RENT", amount: "500", expenseDate: TODAY, payStatus: "FULL", method: "CASH" });
    const before = await getCashMovement(db, owner, RANGE);
    const snapshot = JSON.stringify(await db.orderPayment.findMany({ select: { id: true, amount: true, paidAt: true, method: true, voidedAt: true }, orderBy: { id: "asc" } }));
    const cash = await open("خزنة", "CASH", "0", daysAgo(1));
    expect(await getCashMovement(db, owner, RANGE)).toEqual(before);
    expect(JSON.stringify(await db.orderPayment.findMany({ select: { id: true, amount: true, paidAt: true, method: true, voidedAt: true }, orderBy: { id: "asc" } }))).toBe(snapshot);
    expect(await db.orderPayment.count({ where: { accountId: { not: null } } })).toBe(0); // nothing auto-classified
    expect((await overview()).complete).toBe(false);
    for (const u of (await overview()).unattributed) await attributePayment(db, owner, { side: u.side, paymentId: u.id, accountId: cash });
    expect(await getCashMovement(db, owner, RANGE)).toEqual(before);
    expect((await overview()).total).toBe("700.00");
  });

  it("staff can't see or change any treasury value; payment forms get names only", async () => {
    await open("خزنة", "CASH", "123456");
    await expect(getTreasuryOverview(db, staff, RANGE)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getLedger(db, staff, RANGE)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAccount(db, staff, { name: "x", type: "CASH", openingBalance: "1", openingDate: TODAY, confirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordMovement(db, staff, { kind: "CAPITAL_IN", accountId: randomUUID(), amount: "1", date: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reconcileAccount(db, staff, { accountId: randomUUID(), date: TODAY, counted: "1", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const options = await listAccountOptions(db, staff);
    expect(options).toEqual([{ id: expect.any(String), name: "خزنة", type: "CASH" }]);
    expect(JSON.stringify(options)).not.toContain("123456");
    const orderId = await order();
    expect(JSON.stringify(await getOrderDetails(db, staff, orderId))).not.toContain("123456");
    const nobody = await createTestUser(db, "STAFF", undefined, ["orders:view"]);
    await expect(listAccountOptions(db, nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("opening balances are owner-confirmed initialization events, not revenue", async () => {
    await expect(createAccount(db, owner, { name: "خزنة", type: "CASH", openingBalance: "100", openingDate: TODAY, confirmed: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await open("خزنة", "CASH", "9999");
    expect((await overview()).period.receipts).toBe("0.00");
    expect((await getCashMovement(db, owner, RANGE)).customerPaymentsIn).toBe("0.00");
    expect(await db.auditLog.count({ where: { action: "TREASURY_ACCOUNT_CREATED" } })).toBe(1);
  });
});
