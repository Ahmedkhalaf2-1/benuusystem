import type { PrismaClient } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbTransaction } from "@/lib/db/prisma";
import { dateFromString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney, toCents, type Cents } from "@/lib/money";
import { payPayableSchema, voidRecordSchema } from "@/lib/validations/finance";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockPayable, sumPaidFor, type PayableKind } from "@/server/repositories/payable-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import { lockWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";
import { accountForNewPayment } from "./treasury-service";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Money paid OUT, always against one order cost or one general expense.
 * It reduces what is still owed; it is never a new cost.
 */

type InsertPayment = {
  kind: PayableKind;
  targetId: string;
  amount: Cents;
  paidAt: string;
  method: PaymentMethod;
  notes?: string;
  idempotencyKey: string;
  /** Treasury account the money left (validated against the treasury rules here). */
  accountId?: string;
};

/** Inserts the payment + audit entry. Caller must hold the target's row lock. */
export async function insertOutgoingPayment(tx: DbTransaction, actor: Actor, input: InsertPayment) {
  const accountId = await accountForNewPayment(tx, input.accountId, input.paidAt);
  const payment = await tx.outgoingPayment.create({
    data: {
      accountId,
      ...(input.kind === "cost" ? { orderCostId: input.targetId } : { expenseId: input.targetId }),
      amount: centsToDecimalString(input.amount),
      paidAt: dateFromString(input.paidAt),
      method: input.method,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.OUTGOING_PAYMENT_RECORDED,
    entityType: "OutgoingPayment",
    entityId: payment.id,
    metadata: {
      [input.kind === "cost" ? "orderCostId" : "expenseId"]: input.targetId,
      amount: centsToDecimalString(input.amount),
      method: input.method,
      paidAt: input.paidAt,
      accountId,
    },
  });
  return payment;
}

export type PayResult = { paymentId: string; targetId: string; created: boolean };

async function findByKey(db: PrismaClient, kind: PayableKind, key: string, targetId: string): Promise<PayResult | null> {
  const existing = await db.outgoingPayment.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, orderCostId: true, expenseId: true },
  });
  if (!existing) return null;
  const existingTarget = kind === "cost" ? existing.orderCostId : existing.expenseId;
  if (existingTarget !== targetId) throw new AppError("CONFLICT", "الطلب ده اتسجل قبل كده على حاجة تانية");
  return { paymentId: existing.id, targetId, created: false };
}

/**
 * Pays (part of) a cost or expense. The target row is locked, so two payments
 * at once can never together pay more than is owed. Idempotent per request key.
 */
export async function payPayable(
  db: PrismaClient,
  actor: Actor,
  kind: PayableKind,
  payload: Record<string, unknown>,
): Promise<PayResult> {
  assertPermission(actor, "payables:pay");
  const parsed = payPayableSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  const input = parsed.data;

  const previous = await findByKey(db, kind, input.idempotencyKey, input.targetId);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const target = await lockPayable(tx, kind, input.targetId);
      if (!target) throw new AppError("NOT_FOUND", kind === "cost" ? "التكلفة مش موجودة" : "المصروف مش موجود");
      if (target.voided) throw new AppError("CONFLICT", "ده ملغي ومينفعش يتدفع عليه");

      const paid = await sumPaidFor(tx, kind, input.targetId);
      const remaining = target.amount - paid;
      if (input.amount > remaining) {
        throw new AppError("VALIDATION_ERROR", undefined, {
          fieldErrors: {
            amount: [remaining > 0n ? `المبلغ أكبر من الباقي (${formatMoney(remaining)})` : "ده متدفع بالكامل"],
          },
        });
      }

      const payment = await insertOutgoingPayment(tx, actor, {
        kind,
        targetId: input.targetId,
        amount: input.amount,
        paidAt: input.paidAt,
        method: input.method,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        accountId: input.accountId,
      });
      return { paymentId: payment.id, targetId: input.targetId, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findByKey(db, kind, input.idempotencyKey, input.targetId);
      if (winner) return winner;
    }
    throw error;
  }
}

/** Owner-only: void a payment out. It stays visible and stops counting. */
export async function voidOutgoingPayment(
  db: PrismaClient,
  actor: Actor,
  payload: { id?: unknown; reason?: unknown },
): Promise<{ orderCostId: string | null; expenseId: string | null; workerId: string | null }> {
  assertPermission(actor, "finance:void");
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  const { id, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const payment = await tx.outgoingPayment.findUnique({
      where: { id },
      select: { orderCostId: true, expenseId: true, workerId: true, amount: true },
    });
    if (!payment) throw new AppError("NOT_FOUND", "الدفعة مش موجودة");
    if (payment.orderCostId) await lockPayable(tx, "cost", payment.orderCostId);
    if (payment.expenseId) await lockPayable(tx, "expense", payment.expenseId);
    if (payment.workerId) await lockWorker(tx, payment.workerId);

    const updated = await tx.outgoingPayment.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", "الدفعة دي ملغية بالفعل");

    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.OUTGOING_PAYMENT_VOIDED,
      entityType: "OutgoingPayment",
      entityId: id,
      metadata: {
        orderCostId: payment.orderCostId,
        expenseId: payment.expenseId,
        workerId: payment.workerId,
        amount: centsToDecimalString(toCents(payment.amount)),
        reason,
      },
    });
    return { orderCostId: payment.orderCostId, expenseId: payment.expenseId, workerId: payment.workerId };
  });
}
