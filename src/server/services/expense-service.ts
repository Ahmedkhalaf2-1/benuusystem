import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ExpenseCategory, PaymentMethod } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, dateToString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { settlementStatus, type SettlementStatus } from "@/lib/finance/labels";
import { centsToDecimalString, toCents } from "@/lib/money";
import { recordExpenseSchema, voidRecordSchema, type RecordExpensePayload } from "@/lib/validations/finance";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockPayable, paidByExpenseIds, sumPaidFor } from "@/server/repositories/payable-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { insertOutgoingPayment } from "./outgoing-payment-service";

export type RecordExpenseResult = { expenseId: string; created: boolean };

async function findByKey(db: DbClient, key: string): Promise<RecordExpenseResult | null> {
  const existing = await db.generalExpense.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  return existing ? { expenseId: existing.id, created: false } : null;
}

/** Records a general expense (+ the part paid now) in one transaction. Idempotent. */
export async function recordExpense(
  db: PrismaClient,
  actor: Actor,
  payload: RecordExpensePayload,
): Promise<RecordExpenseResult> {
  assertPermission(actor, "expenses:record");
  const parsed = recordExpenseSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  const input = parsed.data;
  if (input.initialPayment > 0n) assertPermission(actor, "payables:pay");

  const previous = await findByKey(db, input.idempotencyKey);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const expense = await tx.generalExpense.create({
        data: {
          category: input.category,
          description: input.description,
          amount: centsToDecimalString(input.amount),
          expenseDate: dateFromString(input.expenseDate),
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.EXPENSE_RECORDED,
        entityType: "GeneralExpense",
        entityId: expense.id,
        metadata: {
          category: input.category,
          amount: centsToDecimalString(input.amount),
          expenseDate: input.expenseDate,
          paidNow: centsToDecimalString(input.initialPayment),
        },
      });
      if (input.initialPayment > 0n) {
        await insertOutgoingPayment(tx, actor, {
          kind: "expense",
          targetId: expense.id,
          amount: input.initialPayment,
          paidAt: input.expenseDate,
          method: input.method,
          idempotencyKey: randomUUID(),
        });
      }
      return { expenseId: expense.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findByKey(db, input.idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

/** Owner-only. Refused while valid payments exist (void those first). */
export async function voidExpense(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "finance:void");
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  const { id, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const expense = await lockPayable(tx, "expense", id);
    if (!expense) throw new AppError("NOT_FOUND", "المصروف مش موجود");
    if (expense.voided) throw new AppError("CONFLICT", "المصروف ده ملغي بالفعل");
    if ((await sumPaidFor(tx, "expense", id)) > 0n) {
      throw new AppError("CONFLICT", "المصروف ده عليه مدفوعات. ألغِ المدفوعات الأول لو كانت غلط.");
    }
    await tx.generalExpense.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.EXPENSE_VOIDED,
      entityType: "GeneralExpense",
      entityId: id,
      metadata: { amount: centsToDecimalString(expense.amount), reason },
    });
    return { expenseId: id };
  });
}

export type ExpenseView = {
  id: string;
  category: ExpenseCategory;
  description: string | null;
  amount: string;
  paid: string;
  remaining: string;
  status: SettlementStatus;
  expenseDate: string;
  voided: boolean;
};

export type ExpenseFilter = { from: string; to: string; category?: ExpenseCategory };
export const EXPENSES_PAGE_SIZE = 30;

/**
 * Expenses dated within [from, to]. Totals cover ALL valid expenses in the
 * period (not just the page). "paid" here = paid toward those expenses.
 */
export async function listExpenses(db: DbClient, actor: Actor, filter: ExpenseFilter & { page?: number }) {
  assertPermission(actor, "expenses:view");
  const where: Prisma.GeneralExpenseWhereInput = {
    expenseDate: { gte: dateFromString(filter.from), lte: dateFromString(filter.to) },
    ...(filter.category ? { category: filter.category } : {}),
  };

  const valid = await db.generalExpense.findMany({ where: { ...where, voidedAt: null }, select: { id: true, amount: true } });
  const validPaid = await paidByExpenseIds(db, valid.map((e) => e.id));
  let recorded = 0n;
  let paid = 0n;
  for (const e of valid) {
    recorded += toCents(e.amount);
    paid += validPaid.get(e.id) ?? 0n;
  }

  const total = await db.generalExpense.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE));
  const page = Math.min(Math.max(1, filter.page ?? 1), pageCount);
  const rows = await db.generalExpense.findMany({
    where,
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * EXPENSES_PAGE_SIZE,
    take: EXPENSES_PAGE_SIZE,
    select: { id: true, category: true, description: true, amount: true, expenseDate: true, voidedAt: true },
  });
  const pagePaid = await paidByExpenseIds(db, rows.map((r) => r.id));

  return {
    totals: {
      recorded: centsToDecimalString(recorded),
      paid: centsToDecimalString(paid),
      remaining: centsToDecimalString(recorded - paid),
      count: valid.length,
    },
    items: rows.map((r): ExpenseView => {
      const amount = toCents(r.amount);
      const p = pagePaid.get(r.id) ?? 0n;
      const voided = r.voidedAt !== null;
      return {
        id: r.id,
        category: r.category,
        description: r.description,
        amount: centsToDecimalString(amount),
        paid: centsToDecimalString(p),
        remaining: centsToDecimalString(voided ? 0n : amount - p),
        status: settlementStatus(amount, p),
        expenseDate: dateToString(r.expenseDate),
        voided,
      };
    }),
    total,
    page,
    pageCount,
  };
}

export type ExpenseDetails = ExpenseView & {
  recordedByName: string;
  createdAt: Date;
  voidInfo: null | { byName: string; reason: string };
  payments: {
    id: string;
    amount: string;
    paidAt: string;
    method: PaymentMethod;
    notes: string | null;
    recordedByName: string;
    voided: null | { byName: string; reason: string };
  }[];
};

export async function getExpenseDetails(db: DbClient, actor: Actor, id: string): Promise<ExpenseDetails | null> {
  assertPermission(actor, "expenses:view");
  const e = await db.generalExpense.findUnique({
    where: { id },
    select: {
      id: true,
      category: true,
      description: true,
      amount: true,
      expenseDate: true,
      createdAt: true,
      voidedAt: true,
      voidReason: true,
      recordedBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      payments: {
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          notes: true,
          voidedAt: true,
          voidReason: true,
          recordedBy: { select: { name: true } },
          voidedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!e) return null;
  const amount = toCents(e.amount);
  const paid = e.payments.filter((p) => !p.voidedAt).reduce((s, p) => s + toCents(p.amount), 0n);
  const voided = e.voidedAt !== null;
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    amount: centsToDecimalString(amount),
    paid: centsToDecimalString(paid),
    remaining: centsToDecimalString(voided ? 0n : amount - paid),
    status: settlementStatus(amount, paid),
    expenseDate: dateToString(e.expenseDate),
    voided,
    recordedByName: e.recordedBy.name,
    createdAt: e.createdAt,
    voidInfo: voided && e.voidReason ? { byName: e.voidedBy?.name ?? "", reason: e.voidReason } : null,
    payments: e.payments.map((p) => ({
      id: p.id,
      amount: centsToDecimalString(toCents(p.amount)),
      paidAt: dateToString(p.paidAt),
      method: p.method,
      notes: p.notes,
      recordedByName: p.recordedBy.name,
      voided: p.voidedAt && p.voidReason ? { byName: p.voidedBy?.name ?? "", reason: p.voidReason } : null,
    })),
  };
}
