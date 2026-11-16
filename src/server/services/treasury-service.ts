import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FinancialAccountType, MoneyDirection, OpeningBasis, TreasuryMovementKind } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, isValidDateString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, MAX_CENTS, parseMoney, toCents, type Cents } from "@/lib/money";
import type { AccountOption } from "@/lib/treasury/labels";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Treasury («الخزنة والحسابات») — owner only ("treasury:manage").
 *
 * An account's balance is NEVER stored. It is always:
 *   opening balance (counted and confirmed by the owner as of its opening date)
 *   + customer payments attributed to it, dated on/after the opening date
 *   − outgoing payments (costs, expenses, wages, advances) attributed to it
 *   ± treasury movements (owner capital, drawings, transfers, corrections)
 * counting only valid (non-voided) rows. Voiding a payment therefore removes
 * it from the balance exactly once; nothing is double-counted.
 *
 * Order prices, receivables and recorded-but-unpaid expenses never touch a
 * balance: only money that actually moved does. Payments recorded before the
 * treasury existed are NOT attributed automatically; after the cutover date
 * an unattributed payment makes the treasury "incomplete" until the owner
 * attributes it. Before the cutover, the opening balance already covers them.
 */

const MONEY_IN_KINDS = new Set<TreasuryMovementKind>(["CAPITAL_IN"]);
export const ACCOUNT_TYPES = ["CASH", "BANK", "WALLET"] as const satisfies readonly FinancialAccountType[];

function guard(actor: Actor) {
  assertPermission(actor, "treasury:manage");
}

function bad(field: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", message, { fieldErrors: { [field]: [message] } });
}

function money(field: string, raw: unknown, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): Cents {
  const text = typeof raw === "string" ? raw.trim() : "";
  const negative = opts.allowNegative && text.startsWith("-");
  const cents = parseMoney(negative ? text.slice(1) : text);
  if (cents === null) bad(field, "اكتب المبلغ بالأرقام");
  if (cents > MAX_CENTS) bad(field, "المبلغ كبير جدًا");
  if (cents === 0n && !opts.allowZero) bad(field, "اكتب المبلغ");
  return negative ? -cents : cents;
}

function pastDate(field: string, raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!isValidDateString(v)) bad(field, "اختار التاريخ");
  if (v > todayDateString()) bad(field, "التاريخ مينفعش يكون في المستقبل");
  return v;
}

function addDays(day: string, n: number): string {
  return dateToString(new Date(dateFromString(day).getTime() + n * 86_400_000));
}

function text(raw: unknown, max: number): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v.slice(0, max) : null;
}

// ───────────────────────────── Accounts ─────────────────────────────

/**
 * Account names for payment forms (no balances). Anyone allowed to record
 * money in or out may pick where it went; only the owner sees balances.
 */
export async function listAccountOptions(db: DbClient, actor: Actor): Promise<AccountOption[]> {
  if (!["payments:record", "payables:pay", "workers:pay", "costs:record", "expenses:record", "orders:create"].some((p) => hasPermission(actor, p as never))) {
    throw new AppError("FORBIDDEN");
  }
  return db.financialAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } });
}

/**
 * Validates the account picked for a payment: it must exist, be active, and
 * the payment must not be dated before the account's opening balance (that
 * money is already inside the counted opening balance).
 */
export async function resolvePaymentAccount(tx: DbClient, accountId: string | undefined, paidAt: string, field = "accountId"): Promise<string | null> {
  if (!accountId) return null;
  const a = await tx.financialAccount.findUnique({ where: { id: accountId }, select: { isActive: true, openingDate: true, openingCountDate: true, openingBasis: true } });
  if (!a || !a.isActive) bad(field, "الحساب ده مش موجود أو متوقف");
  if (paidAt < dateToString(a.openingDate)) {
    bad(
      field,
      a.openingBasis === "END_OF_DAY" && paidAt === dateToString(a.openingCountDate)
        ? "الدفعة دي في يوم الجرد، والجرد اتعمل آخر اليوم — يعني هي جوّه الرصيد الافتتاحي ومش هتتحسب تاني. سجّلها من غير حساب."
        : `تاريخ الدفعة قبل بداية حساب الخزنة (${dateToString(a.openingDate)}) — هي جوّه الرصيد الافتتاحي. سجّلها من غير حساب.`,
    );
  }
  return accountId;
}

/**
 * The account to store on a NEW money movement (customer payment, advance,
 * cost/expense payment, wage/advance), inside the caller's transaction.
 *
 * - Before the treasury is set up (no active account): optional.
 * - After setup: required for money dated on/after the cutover (the earliest
 *   opening date). Money dated before the cutover is already inside the
 *   counted opening balance, so it is NOT attributed — that would count it twice.
 */
export async function accountForNewPayment(tx: DbClient, accountId: string | undefined, paidAt: string, field = "accountId"): Promise<string | null> {
  if (accountId) return resolvePaymentAccount(tx, accountId, paidAt, field);
  const first = await tx.financialAccount.findFirst({ where: { isActive: true }, orderBy: { openingDate: "asc" }, select: { openingDate: true } });
  if (first && paidAt >= dateToString(first.openingDate)) bad(field, "اختار الحساب اللي الفلوس دخلت فيه / خرجت منه");
  return null;
}

/** Whether new payments must name an account (treasury set up). Names only — no balances. */
export async function treasuryRequiresAccount(db: DbClient): Promise<{ required: boolean; cutover: string | null }> {
  const first = await db.financialAccount.findFirst({ where: { isActive: true }, orderBy: { openingDate: "asc" }, select: { openingDate: true } });
  return { required: first !== null, cutover: first ? dateToString(first.openingDate) : null };
}

export async function createAccount(
  db: PrismaClient,
  actor: Actor,
  payload: { name: unknown; type: unknown; openingBalance: unknown; countDate: unknown; basis: unknown; notes?: unknown; confirmed: unknown },
) {
  guard(actor);
  const name = text(payload.name, 80);
  if (!name) bad("name", "اكتب اسم الحساب");
  if (!(ACCOUNT_TYPES as readonly unknown[]).includes(payload.type)) bad("type", "اختار نوع الحساب");
  const opening = money("openingBalance", payload.openingBalance, { allowZero: true, allowNegative: true });
  const countDate = pastDate("countDate", payload.countDate);
  if (payload.basis !== "START_OF_DAY" && payload.basis !== "END_OF_DAY") bad("basis", "اختار الجرد كان بداية اليوم ولا آخره");
  const basis = payload.basis as OpeningBasis;
  // START: that day's payments come after the count. END: they are inside it, so counting starts the next day.
  const openingDate = basis === "START_OF_DAY" ? countDate : addDays(countDate, 1);
  if (payload.confirmed !== true) bad("confirmed", "أكّد إنك عدّيت الفلوس أو راجعت الرصيد فعلًا");
  try {
    return await db.$transaction(async (tx) => {
      const account = await tx.financialAccount.create({
        data: {
          name,
          type: payload.type as FinancialAccountType,
          openingBalance: centsToDecimalString(opening),
          openingCountDate: dateFromString(countDate),
          openingBasis: basis,
          openingDate: dateFromString(openingDate),
          notes: text(payload.notes, 300),
          createdById: actor.id,
        },
        select: { id: true },
      });
      // The opening balance is an initialization event, not revenue.
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.TREASURY_ACCOUNT_CREATED,
        entityType: "FinancialAccount",
        entityId: account.id,
        metadata: { name, type: payload.type as string, openingBalance: centsToDecimalString(opening), countDate, basis, firstCountedDay: openingDate, confirmedByOwner: true },
      });
      return account;
    });
  } catch (error) {
    if (isUniqueViolation(error)) bad("name", "في حساب بنفس الاسم");
    throw error;
  }
}

export async function setAccountActive(db: PrismaClient, actor: Actor, payload: { accountId: unknown; active: unknown }) {
  guard(actor);
  const id = z.uuid().safeParse(payload.accountId);
  if (!id.success || typeof payload.active !== "boolean") throw new AppError("VALIDATION_ERROR");
  const active = payload.active;
  return db.$transaction(async (tx) => {
    const a = await tx.financialAccount.findUnique({ where: { id: id.data }, select: { isActive: true } });
    if (!a) throw new AppError("NOT_FOUND");
    if (a.isActive === active) return;
    await tx.financialAccount.update({ where: { id: id.data }, data: { isActive: active } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.TREASURY_ACCOUNT_UPDATED, entityType: "FinancialAccount", entityId: id.data, metadata: { isActive: active } });
  });
}

// ───────────────────────────── Movements ─────────────────────────────

/** Locks the given accounts (in id order, so concurrent writers never deadlock). */
async function lockAccounts(tx: DbTransaction, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  const rows: { id: string; is_active: boolean; opening_date: Date }[] = [];
  for (const id of sorted) {
    const r = await tx.$queryRaw<{ id: string; is_active: boolean; opening_date: Date }[]>`
      SELECT id, is_active, opening_date FROM financial_accounts WHERE id = ${id}::uuid FOR UPDATE`;
    if (r[0]) rows.push(r[0]);
  }
  return rows;
}

export type MovementPayload = {
  kind: unknown;
  accountId: unknown;
  toAccountId?: unknown;
  direction?: unknown;
  amount: unknown;
  date: unknown;
  notes?: unknown;
  idempotencyKey: unknown;
};

/**
 * Owner capital in, drawings, transfers between accounts and audited
 * corrections. A transfer is one row: it leaves one account and enters the
 * other in the same transaction, and is never revenue or expense.
 */
export async function recordMovement(db: PrismaClient, actor: Actor, payload: MovementPayload): Promise<{ id: string; created: boolean }> {
  guard(actor);
  const kinds = ["CAPITAL_IN", "DRAWING", "TRANSFER", "ADJUSTMENT"] as const;
  if (!(kinds as readonly unknown[]).includes(payload.kind)) bad("kind", "اختار نوع الحركة");
  const kind = payload.kind as TreasuryMovementKind;
  const key = z.uuid().safeParse(payload.idempotencyKey);
  if (!key.success) throw new AppError("VALIDATION_ERROR", "صيغة البيانات المرسلة غير صحيحة");
  const accountId = z.uuid().safeParse(payload.accountId);
  if (!accountId.success) bad("accountId", "اختار الحساب");
  const toAccountId = kind === "TRANSFER" ? z.uuid().safeParse(payload.toAccountId) : null;
  if (toAccountId && !toAccountId.success) bad("toAccountId", "اختار الحساب اللي هتحوّل له");
  if (toAccountId?.success && toAccountId.data === accountId.data) bad("toAccountId", "اختار حساب تاني غير اللي هتحوّل منه");
  const direction = kind === "ADJUSTMENT" ? (payload.direction === "IN" || payload.direction === "OUT" ? (payload.direction as MoneyDirection) : bad("direction", "اختار زيادة ولا نقص")) : null;
  const amount = money("amount", payload.amount);
  const date = pastDate("date", payload.date);
  const notes = text(payload.notes, 500);
  if (kind === "ADJUSTMENT" && (!notes || notes.length < 3)) bad("notes", "اكتب سبب التصحيح");

  const replay = await db.treasuryMovement.findUnique({ where: { idempotencyKey: key.data }, select: { id: true } });
  if (replay) return { id: replay.id, created: false };

  try {
    return await db.$transaction(async (tx) => {
      const ids = [accountId.data, ...(toAccountId?.success ? [toAccountId.data] : [])];
      const accounts = await lockAccounts(tx, ids);
      if (accounts.length !== ids.length || accounts.some((a) => !a.is_active)) bad("accountId", "الحساب مش موجود أو متوقف");
      for (const a of accounts) {
        if (date < dateToString(a.opening_date)) bad("date", `التاريخ قبل الرصيد الافتتاحي (${dateToString(a.opening_date)})`);
      }
      const row = await tx.treasuryMovement.create({
        data: {
          kind,
          accountId: accountId.data,
          toAccountId: toAccountId?.success ? toAccountId.data : null,
          direction,
          amount: centsToDecimalString(amount),
          movementDate: dateFromString(date),
          notes,
          idempotencyKey: key.data,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.TREASURY_MOVEMENT_RECORDED,
        entityType: "TreasuryMovement",
        entityId: row.id,
        metadata: { kind, accountId: accountId.data, toAccountId: toAccountId?.success ? toAccountId.data : null, direction, amount: centsToDecimalString(amount), date, notes },
      });
      return { id: row.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.treasuryMovement.findUnique({ where: { idempotencyKey: key.data }, select: { id: true } });
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}

/** Movements are never edited or deleted: a wrong one is voided with a reason (audited). */
export async function voidMovement(db: PrismaClient, actor: Actor, payload: { id: unknown; reason: unknown }) {
  guard(actor);
  const id = z.uuid().safeParse(payload.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const reason = text(payload.reason, 300);
  if (!reason || reason.length < 3) bad("reason", "اكتب سبب الإلغاء");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ voided_at: Date | null }[]>`SELECT voided_at FROM treasury_movements WHERE id = ${id.data}::uuid FOR UPDATE`;
    if (!rows[0]) throw new AppError("NOT_FOUND");
    if (rows[0].voided_at) return { voided: false };
    await tx.treasuryMovement.update({ where: { id: id.data }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.TREASURY_MOVEMENT_VOIDED, entityType: "TreasuryMovement", entityId: id.data, metadata: { reason } });
    return { voided: true };
  });
}

/**
 * Attributes an existing payment to the account it actually went into / out
 * of. First attribution of an unattributed payment needs no reason; moving an
 * already-attributed payment to another account needs one. Always audited.
 */
export async function attributePayment(db: PrismaClient, actor: Actor, payload: { side: unknown; paymentId: unknown; accountId: unknown; reason?: unknown }) {
  guard(actor);
  const side = payload.side === "in" || payload.side === "out" ? payload.side : bad("side", "نوع الدفعة غير معروف");
  const paymentId = z.uuid().safeParse(payload.paymentId);
  const accountId = z.uuid().safeParse(payload.accountId);
  if (!paymentId.success) throw new AppError("NOT_FOUND");
  if (!accountId.success) bad("accountId", "اختار الحساب");
  const reason = text(payload.reason, 300);
  return db.$transaction(async (tx) => {
    const table = side === "in" ? "order_payments" : "outgoing_payments";
    const rows = await tx.$queryRawUnsafe<{ account_id: string | null; paid_at: Date; voided_at: Date | null }[]>(
      `SELECT account_id, paid_at, voided_at FROM ${table} WHERE id = $1::uuid FOR UPDATE`,
      paymentId.data,
    );
    const p = rows[0];
    if (!p) throw new AppError("NOT_FOUND");
    if (p.account_id === accountId.data) return { changed: false };
    if (p.account_id && (!reason || reason.length < 3)) bad("reason", "الدفعة متسجلة على حساب تاني — اكتب سبب النقل");
    await resolvePaymentAccount(tx, accountId.data, dateToString(p.paid_at));
    if (side === "in") await tx.orderPayment.update({ where: { id: paymentId.data }, data: { accountId: accountId.data } });
    else await tx.outgoingPayment.update({ where: { id: paymentId.data }, data: { accountId: accountId.data } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PAYMENT_ACCOUNT_ATTRIBUTED,
      entityType: side === "in" ? "OrderPayment" : "OutgoingPayment",
      entityId: paymentId.data,
      metadata: { from: p.account_id, to: accountId.data, reason },
    });
    return { changed: true };
  });
}

// ───────────────────────────── Balances & ledger ─────────────────────────────

export type LedgerEntry = {
  key: string;
  date: string;
  createdAt: Date;
  accountId: string;
  /** Transfers only: the other account. */
  otherAccountId: string | null;
  kind: "CUSTOMER_PAYMENT" | "SUPPLIER_OR_COST" | "EXPENSE" | "WAGE" | TreasuryMovementKind;
  /** Money in / out of THIS account (piasters). */
  moneyIn: Cents;
  moneyOut: Cents;
  reference: string;
  /** Link target in the app, if any. */
  href: string | null;
  recordedBy: string;
  notes: string | null;
  movementId: string | null;
};

/**
 * `openingDate`: first day whose movements count after the opening balance.
 * `knownFrom`: the balance is known at the END of this day (= openingDate − 1;
 * the end of one day is the start of the next).
 */
type AccountRow = { id: string; name: string; type: FinancialAccountType; openingBalance: Cents; openingDate: string; knownFrom: string; countDate: string; basis: OpeningBasis; isActive: boolean };

async function loadAccounts(db: DbClient): Promise<AccountRow[]> {
  const rows = await db.financialAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    openingBalance: toCents(a.openingBalance),
    openingDate: dateToString(a.openingDate),
    knownFrom: addDays(dateToString(a.openingDate), -1),
    countDate: dateToString(a.openingCountDate),
    basis: a.openingBasis,
    isActive: a.isActive,
  }));
}

/** Every valid attributed money movement up to `to` (inclusive), one entry per account side. */
async function loadEntries(db: DbClient, accounts: AccountRow[], to: string): Promise<LedgerEntry[]> {
  const toDate = dateFromString(to);
  const opening = new Map(accounts.map((a) => [a.id, a.openingDate]));
  const [incoming, outgoing, movements] = await Promise.all([
    db.orderPayment.findMany({
      where: { accountId: { not: null }, voidedAt: null, paidAt: { lte: toDate } },
      select: { id: true, accountId: true, amount: true, paidAt: true, createdAt: true, notes: true, method: true, recordedBy: { select: { name: true } }, order: { select: { id: true, number: true, customer: { select: { name: true } } } } },
    }),
    db.outgoingPayment.findMany({
      where: { accountId: { not: null }, voidedAt: null, paidAt: { lte: toDate } },
      select: {
        id: true,
        accountId: true,
        amount: true,
        paidAt: true,
        createdAt: true,
        notes: true,
        workerPaymentType: true,
        recordedBy: { select: { name: true } },
        orderCost: { select: { description: true, orderId: true, order: { select: { number: true } } } },
        expense: { select: { id: true, description: true } },
        worker: { select: { id: true, name: true } },
      },
    }),
    db.treasuryMovement.findMany({ where: { voidedAt: null, movementDate: { lte: toDate } }, include: { recordedBy: { select: { name: true } } } }),
  ]);
  const out: LedgerEntry[] = [];
  const counts = (accountId: string, date: string) => opening.has(accountId) && date >= opening.get(accountId)!;
  for (const p of incoming) {
    const date = dateToString(p.paidAt);
    if (!counts(p.accountId!, date)) continue;
    out.push({
      key: `in:${p.id}`,
      date,
      createdAt: p.createdAt,
      accountId: p.accountId!,
      otherAccountId: null,
      kind: "CUSTOMER_PAYMENT",
      moneyIn: toCents(p.amount),
      moneyOut: 0n,
      reference: `دفعة من ${p.order.customer.name} — أوردر #${String(p.order.number).padStart(4, "0")}`,
      href: `/orders/${p.order.id}`,
      recordedBy: p.recordedBy.name,
      notes: p.notes,
      movementId: null,
    });
  }
  for (const p of outgoing) {
    const date = dateToString(p.paidAt);
    if (!counts(p.accountId!, date)) continue;
    const kind = p.worker ? "WAGE" : p.expense ? "EXPENSE" : "SUPPLIER_OR_COST";
    const reference = p.worker
      ? `${p.workerPaymentType === "ADVANCE" ? "سلفة" : "يومية/حساب"} ${p.worker.name}`
      : p.expense
        ? `مصروف: ${p.expense.description}`
        : `تكلفة أوردر #${String(p.orderCost?.order.number ?? 0).padStart(4, "0")}: ${p.orderCost?.description ?? ""}`;
    const href = p.worker ? `/workers/${p.worker.id}` : p.expense ? `/expenses/${p.expense.id}` : p.orderCost ? `/orders/${p.orderCost.orderId}` : null;
    out.push({ key: `out:${p.id}`, date, createdAt: p.createdAt, accountId: p.accountId!, otherAccountId: null, kind, moneyIn: 0n, moneyOut: toCents(p.amount), reference, href, recordedBy: p.recordedBy.name, notes: p.notes, movementId: null });
  }
  const LABEL: Record<TreasuryMovementKind, string> = { CAPITAL_IN: "إيداع من صاحب الشغل", DRAWING: "مسحوبات صاحب الشغل", TRANSFER: "تحويل بين الحسابات", ADJUSTMENT: "تصحيح بعد الجرد" };
  for (const m of movements) {
    const date = dateToString(m.movementDate);
    const amount = toCents(m.amount);
    const base = { date, createdAt: m.createdAt, kind: m.kind, reference: LABEL[m.kind], href: null, recordedBy: m.recordedBy.name, notes: m.notes, movementId: m.id };
    if (m.kind === "TRANSFER") {
      if (counts(m.accountId, date)) out.push({ ...base, key: `mv:${m.id}:out`, accountId: m.accountId, otherAccountId: m.toAccountId, moneyIn: 0n, moneyOut: amount });
      if (counts(m.toAccountId!, date)) out.push({ ...base, key: `mv:${m.id}:in`, accountId: m.toAccountId!, otherAccountId: m.accountId, moneyIn: amount, moneyOut: 0n });
      continue;
    }
    if (!counts(m.accountId, date)) continue;
    const isIn = MONEY_IN_KINDS.has(m.kind) || (m.kind === "ADJUSTMENT" && m.direction === "IN");
    out.push({ ...base, key: `mv:${m.id}`, accountId: m.accountId, otherAccountId: null, moneyIn: isIn ? amount : 0n, moneyOut: isIn ? 0n : amount });
  }
  out.sort((a, b) => (a.date === b.date ? a.createdAt.getTime() - b.createdAt.getTime() : a.date < b.date ? -1 : 1));
  return out;
}

/**
 * Balance of an account at the END of `date`; null before the count (unknown
 * — never shown as zero).
 */
function balanceAt(account: AccountRow, entries: LedgerEntry[], date: string): Cents | null {
  if (date < account.knownFrom) return null;
  let b = account.openingBalance;
  for (const e of entries) if (e.accountId === account.id && e.date <= date) b += e.moneyIn - e.moneyOut;
  return b;
}

export type TreasuryIssue = { kind: "NO_ACCOUNTS" } | { kind: "UNATTRIBUTED"; count: number; since: string } | { kind: "NEGATIVE"; accountName: string };

/** Valid payments dated on/after the cutover that are not attributed to an account. */
async function unattributedSince(db: DbClient, since: string) {
  const d = dateFromString(since);
  const [inc, out] = await Promise.all([
    db.orderPayment.findMany({ where: { accountId: null, voidedAt: null, paidAt: { gte: d } }, orderBy: { paidAt: "asc" }, select: { id: true, amount: true, paidAt: true, method: true, order: { select: { id: true, number: true, customer: { select: { name: true } } } } } }),
    db.outgoingPayment.findMany({
      where: { accountId: null, voidedAt: null, paidAt: { gte: d } },
      orderBy: { paidAt: "asc" },
      select: { id: true, amount: true, paidAt: true, method: true, worker: { select: { name: true } }, expense: { select: { description: true } }, orderCost: { select: { description: true } } },
    }),
  ]);
  return [
    ...inc.map((p) => ({ side: "in" as const, id: p.id, amount: centsToDecimalString(toCents(p.amount)), date: dateToString(p.paidAt), method: p.method, label: `دفعة من ${p.order.customer.name} — #${String(p.order.number).padStart(4, "0")}` })),
    ...out.map((p) => ({
      side: "out" as const,
      id: p.id,
      amount: centsToDecimalString(toCents(p.amount)),
      date: dateToString(p.paidAt),
      method: p.method,
      label: p.worker ? `للعامل ${p.worker.name}` : p.expense ? `مصروف: ${p.expense.description}` : `تكلفة: ${p.orderCost?.description ?? ""}`,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type TreasuryOverview = {
  accounts: { id: string; name: string; type: FinancialAccountType; isActive: boolean; openingBalance: string; openingDate: string; countDate: string; basis: OpeningBasis; balance: string }[];
  /** Sum of account balances. Null when the treasury is incomplete (never a fabricated number). */
  total: string | null;
  /** Sum of the accounts' balances by type (only when complete). */
  byType: Partial<Record<FinancialAccountType, string>>;
  complete: boolean;
  issues: TreasuryIssue[];
  /** Earliest opening date: payments on/after it must be attributed. */
  cutover: string | null;
  period: {
    from: string;
    to: string;
    /** All valid customer payments in the period (from records, attributed or not). */
    receipts: string;
    /** All valid outgoing payments in the period. */
    payments: string;
    /** receipts − payments: NOT a balance. */
    net: string;
    /** Owner capital in / drawings in the period (not revenue / expenses). */
    capitalIn: string;
    drawings: string;
  };
  /** Customer receivables (owed to us) — NOT cash. */
  receivables: string;
  unattributed: Awaited<ReturnType<typeof unattributedSince>>;
};

export async function getTreasuryOverview(db: DbClient, actor: Actor, range: { from: string; to: string }): Promise<TreasuryOverview> {
  guard(actor);
  const today = todayDateString();
  const accounts = await loadAccounts(db);
  const entries = await loadEntries(db, accounts, today);
  const cutover = accounts.length > 0 ? accounts.map((a) => a.openingDate).sort()[0]! : null;
  const unattributed = cutover ? await unattributedSince(db, cutover) : [];

  const balances = accounts.map((a) => ({ a, b: balanceAt(a, entries, today)! }));
  const issues: TreasuryIssue[] = [];
  if (accounts.length === 0) issues.push({ kind: "NO_ACCOUNTS" });
  if (unattributed.length > 0) issues.push({ kind: "UNATTRIBUTED", count: unattributed.length, since: cutover! });
  for (const { a, b } of balances) if (b < 0n) issues.push({ kind: "NEGATIVE", accountName: a.name });
  const complete = accounts.length > 0 && unattributed.length === 0;

  const byType: Partial<Record<FinancialAccountType, Cents>> = {};
  for (const { a, b } of balances) byType[a.type] = (byType[a.type] ?? 0n) + b;

  const between = { gte: dateFromString(range.from), lte: dateFromString(range.to) };
  const [rin, rout, caps, receivable] = await Promise.all([
    db.orderPayment.aggregate({ where: { voidedAt: null, paidAt: between }, _sum: { amount: true } }),
    db.outgoingPayment.aggregate({ where: { voidedAt: null, paidAt: between }, _sum: { amount: true } }),
    db.treasuryMovement.groupBy({ by: ["kind"], where: { voidedAt: null, movementDate: between, kind: { in: ["CAPITAL_IN", "DRAWING"] } }, _sum: { amount: true } }),
    db.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(GREATEST(o.total_price - COALESCE((SELECT SUM(p.amount) FROM order_payments p WHERE p.order_id = o.id AND p.voided_at IS NULL), 0), 0))::text AS total
      FROM orders o WHERE o.archived_at IS NULL AND o.status <> 'CANCELLED'`,
  ]);
  const receipts = toCents(rin._sum.amount);
  const payments = toCents(rout._sum.amount);
  const capSum = (k: TreasuryMovementKind) => toCents(caps.find((c) => c.kind === k)?._sum.amount);

  return {
    accounts: balances.map(({ a, b }) => ({ id: a.id, name: a.name, type: a.type, isActive: a.isActive, openingBalance: centsToDecimalString(a.openingBalance), openingDate: a.openingDate, countDate: a.countDate, basis: a.basis, balance: centsToDecimalString(b) })),
    total: complete ? centsToDecimalString(balances.reduce((s, x) => s + x.b, 0n)) : null,
    byType: complete ? Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, centsToDecimalString(v!)])) : {},
    complete,
    issues,
    cutover,
    period: {
      ...range,
      receipts: centsToDecimalString(receipts),
      payments: centsToDecimalString(payments),
      net: centsToDecimalString(receipts - payments),
      capitalIn: centsToDecimalString(capSum("CAPITAL_IN")),
      drawings: centsToDecimalString(capSum("DRAWING")),
    },
    receivables: centsToDecimalString(toCents(receivable[0]?.total ?? "0")),
    unattributed,
  };
}

export type Ledger = {
  from: string;
  to: string;
  accountId: string | null;
  /** Null when unknown (period starts before an account's opening date). */
  opening: string | null;
  closing: string | null;
  totalIn: string;
  totalOut: string;
  rows: (Omit<LedgerEntry, "moneyIn" | "moneyOut"> & { accountName: string; otherAccountName: string | null; moneyIn: string; moneyOut: string; balance: string | null; internal: boolean })[];
};

/**
 * Ledger for one account, or all accounts combined. Combined: a transfer is
 * shown once as internal and counted in neither total (money only moved
 * between the business's own accounts).
 */
export async function getLedger(db: DbClient, actor: Actor, filter: { accountId?: string | null; from: string; to: string }): Promise<Ledger> {
  guard(actor);
  const accounts = await loadAccounts(db);
  const scope = filter.accountId ? accounts.filter((a) => a.id === filter.accountId) : accounts;
  if (filter.accountId && scope.length === 0) throw new AppError("NOT_FOUND");
  const entries = await loadEntries(db, accounts, filter.to);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const ids = new Set(scope.map((a) => a.id));
  const dayBefore = dateToString(new Date(dateFromString(filter.from).getTime() - 86_400_000));

  // Known part of the balance before the period; accounts not yet opened are
  // "unknown" until their (counted) opening balance appears in the period.
  let known = 0n;
  let unknown = 0;
  for (const a of scope) {
    const b = balanceAt(a, entries, dayBefore);
    if (b === null) unknown += 1;
    else known += b;
  }
  const opening = scope.length > 0 && unknown === 0 ? known : null;

  type Item = { date: string; order: number; createdAt: number; opening?: AccountRow; entry?: LedgerEntry };
  const items: Item[] = [
    // The opening balance becomes known inside the period: placed at the start of
    // the first counted day (start-of-day count) or the end of the count day.
    ...scope
      .filter((a) => a.knownFrom > dayBefore && a.knownFrom <= filter.to)
      .map((a) => (a.basis === "START_OF_DAY" ? { date: a.openingDate, order: 0, createdAt: 0, opening: a } : { date: a.countDate, order: 2, createdAt: 0, opening: a })),
    ...entries.filter((e) => ids.has(e.accountId) && e.date >= filter.from && e.date <= filter.to).map((e) => ({ date: e.date, order: 1, createdAt: e.createdAt.getTime(), entry: e })),
  ].sort((x, y) => (x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.order - y.order || x.createdAt - y.createdAt));

  const rows: Ledger["rows"] = [];
  let tin = 0n;
  let tout = 0n;
  const shown = () => (unknown === 0 ? centsToDecimalString(known) : null);
  const seenTransfer = new Set<string>();
  for (const it of items) {
    if (it.opening) {
      const a = it.opening;
      known += a.openingBalance;
      unknown -= 1;
      rows.push({
        key: `open:${a.id}`, date: a.countDate, createdAt: new Date(0), accountId: a.id, otherAccountId: null, kind: "ADJUSTMENT",
        reference: a.basis === "START_OF_DAY" ? "رصيد افتتاحي — جرد بداية اليوم" : "رصيد افتتاحي — جرد آخر اليوم", href: null, recordedBy: "", notes: null, movementId: null,
        accountName: a.name, otherAccountName: null, moneyIn: centsToDecimalString(a.openingBalance), moneyOut: "0.00", balance: shown(), internal: true,
      });
      continue;
    }
    const e = it.entry!;
    // Combined view: a transfer between two in-scope accounts is internal — shown once, counted in neither total.
    if (!filter.accountId && e.kind === "TRANSFER" && e.otherAccountId && ids.has(e.otherAccountId)) {
      if (seenTransfer.has(e.movementId!)) continue;
      seenTransfer.add(e.movementId!);
      const from = e.moneyOut > 0n ? e.accountId : e.otherAccountId;
      const to = e.moneyOut > 0n ? e.otherAccountId : e.accountId;
      const amt = centsToDecimalString(e.moneyOut > 0n ? e.moneyOut : e.moneyIn);
      rows.push({ ...e, accountId: from, otherAccountId: to, accountName: names.get(from)!, otherAccountName: names.get(to) ?? null, moneyIn: amt, moneyOut: amt, balance: shown(), internal: true });
      continue;
    }
    known += e.moneyIn - e.moneyOut;
    tin += e.moneyIn;
    tout += e.moneyOut;
    rows.push({ ...e, accountName: names.get(e.accountId)!, otherAccountName: e.otherAccountId ? (names.get(e.otherAccountId) ?? null) : null, moneyIn: centsToDecimalString(e.moneyIn), moneyOut: centsToDecimalString(e.moneyOut), balance: shown(), internal: false });
  }
  return {
    from: filter.from,
    to: filter.to,
    accountId: filter.accountId ?? null,
    opening: opening === null ? null : centsToDecimalString(opening),
    closing: scope.length > 0 ? shown() : null,
    totalIn: centsToDecimalString(tin),
    totalOut: centsToDecimalString(tout),
    rows,
  };
}

// ───────────────────────────── Reconciliation ─────────────────────────────

/**
 * Owner counts an account. The system balance at that date is stored next to
 * the count, so a discrepancy is recorded — never silently overwritten. With
 * `adjust`, an audited ADJUSTMENT movement brings the books in line.
 */
export async function reconcileAccount(
  db: PrismaClient,
  actor: Actor,
  payload: { accountId: unknown; date: unknown; counted: unknown; notes?: unknown; adjust?: unknown; idempotencyKey: unknown },
) {
  guard(actor);
  const accountId = z.uuid().safeParse(payload.accountId);
  if (!accountId.success) bad("accountId", "اختار الحساب");
  const key = z.uuid().safeParse(payload.idempotencyKey);
  if (!key.success) throw new AppError("VALIDATION_ERROR");
  const date = pastDate("date", payload.date);
  const counted = money("counted", payload.counted, { allowZero: true, allowNegative: true });
  const notes = text(payload.notes, 500);
  const adjust = payload.adjust === true;
  if (adjust && (!notes || notes.length < 3)) bad("notes", "اكتب سبب الفرق قبل التصحيح");

  return db.$transaction(async (tx) => {
    await lockAccounts(tx, [accountId.data]);
    const accounts = await loadAccounts(tx);
    const account = accounts.find((a) => a.id === accountId.data);
    if (!account) throw new AppError("NOT_FOUND");
    const system = balanceAt(account, await loadEntries(tx, accounts, date), date);
    if (system === null) bad("date", "التاريخ قبل الرصيد الافتتاحي للحساب");
    const difference = counted - system;
    const rec = await tx.treasuryReconciliation.create({
      data: { accountId: account.id, countDate: dateFromString(date), countedAmount: centsToDecimalString(counted), systemBalance: centsToDecimalString(system), notes, recordedById: actor.id },
      select: { id: true },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.TREASURY_RECONCILED,
      entityType: "FinancialAccount",
      entityId: account.id,
      metadata: { reconciliationId: rec.id, date, counted: centsToDecimalString(counted), system: centsToDecimalString(system), difference: centsToDecimalString(difference), adjusted: adjust && difference !== 0n },
    });
    let adjustmentId: string | null = null;
    if (adjust && difference !== 0n) {
      const amount = difference < 0n ? -difference : difference;
      const mv = await tx.treasuryMovement.create({
        data: {
          kind: "ADJUSTMENT",
          accountId: account.id,
          direction: difference > 0n ? "IN" : "OUT",
          amount: centsToDecimalString(amount),
          movementDate: dateFromString(date),
          notes: `تصحيح جرد: ${notes}`,
          idempotencyKey: key.data,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      adjustmentId = mv.id;
      await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.TREASURY_MOVEMENT_RECORDED, entityType: "TreasuryMovement", entityId: mv.id, metadata: { kind: "ADJUSTMENT", reconciliationId: rec.id, amount: centsToDecimalString(amount), direction: difference > 0n ? "IN" : "OUT", date } });
    }
    return { reconciliationId: rec.id, system: centsToDecimalString(system), counted: centsToDecimalString(counted), difference: centsToDecimalString(difference), adjustmentId };
  });
}

export async function listReconciliations(db: DbClient, actor: Actor, limit = 20) {
  guard(actor);
  const rows = await db.treasuryReconciliation.findMany({ orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], take: limit, include: { account: { select: { name: true } }, recordedBy: { select: { name: true } } } });
  return rows.map((r) => {
    const counted = toCents(r.countedAmount);
    const system = toCents(r.systemBalance);
    return { id: r.id, accountName: r.account.name, date: dateToString(r.countDate), counted: centsToDecimalString(counted), system: centsToDecimalString(system), difference: centsToDecimalString(counted - system), notes: r.notes, recordedBy: r.recordedBy.name };
  });
}
