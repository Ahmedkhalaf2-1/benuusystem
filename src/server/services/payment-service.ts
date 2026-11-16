import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import { dateFromString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import {
  recordPaymentSchema,
  voidPaymentSchema,
  type RecordPaymentInput,
} from "@/lib/validations/order";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockOrder, sumValidPayments } from "@/server/repositories/order-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { accountForNewPayment } from "./treasury-service";
import { canAccessOrder } from "./order-access";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

export type RecordPaymentResult = { paymentId: string; orderId: string; created: boolean };

type RecordPaymentPayload = { [K in keyof RecordPaymentInput]?: unknown };

async function findPaymentByKey(db: PrismaClient, key: string, orderId: string) {
  const existing = await db.orderPayment.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, orderId: true },
  });
  if (!existing) return null;
  if (existing.orderId !== orderId) throw new AppError("CONFLICT", "الطلب ده اتسجل قبل كده لأوردر تاني");
  return { paymentId: existing.id, orderId: existing.orderId, created: false };
}

/**
 * Records a customer payment.
 * - The order row is locked, so two payments at once cannot together overpay.
 * - Paid + new amount may not exceed the agreed price.
 * - Retrying with the same idempotency key returns the first payment.
 */
export async function recordPayment(
  db: PrismaClient,
  actor: Actor,
  payload: RecordPaymentPayload,
): Promise<RecordPaymentResult> {
  assertPermission(actor, "payments:record");
  const parsed = recordPaymentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "راجع بيانات الدفعة", { fieldErrors: toFieldErrors(parsed.error) });
  }
  const input = parsed.data;

  const previous = await findPaymentByKey(db, input.idempotencyKey, input.orderId);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      if (!(await lockOrder(tx, input.orderId)) || !(await canAccessOrder(tx, actor, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        select: { number: true, status: true, totalPrice: true },
      });
      if (order.status === "CANCELLED") {
        throw new AppError("CONFLICT", "الأوردر ده ملغي ومينفعش تتسجل عليه دفعات");
      }

      const paid = await sumValidPayments(tx, input.orderId);
      const remaining = toCents(order.totalPrice) - paid;
      if (input.amount > remaining) {
        throw new AppError("VALIDATION_ERROR", undefined, {
          fieldErrors: {
            amount: [
              remaining > 0n
                ? `المبلغ أكبر من المتبقي على الأوردر (${formatMoney(remaining)})`
                : "الأوردر ده متدفع بالكامل",
            ],
          },
        });
      }

      const accountId = await accountForNewPayment(tx, input.accountId, input.paidAt);
      const payment = await tx.orderPayment.create({
        data: {
          orderId: input.orderId,
          amount: centsToDecimalString(input.amount),
          paidAt: dateFromString(input.paidAt),
          method: input.method,
          accountId,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.id,
        },
        select: { id: true },
      });

      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.PAYMENT_RECORDED,
        entityType: "OrderPayment",
        entityId: payment.id,
        metadata: {
          orderId: input.orderId,
          orderNumber: order.number,
          amount: centsToDecimalString(input.amount),
          method: input.method,
          accountId,
          paidAt: input.paidAt,
          paidBefore: centsToDecimalString(paid),
        },
      });

      return { paymentId: payment.id, orderId: input.orderId, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findPaymentByKey(db, input.idempotencyKey, input.orderId);
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Voids a payment (owner only). The payment row is kept with who/when/why,
 * and stops counting toward "paid". Nothing is ever deleted.
 */
export async function voidPayment(
  db: PrismaClient,
  actor: Actor,
  payload: { paymentId?: unknown; reason?: unknown },
): Promise<{ orderId: string }> {
  assertPermission(actor, "payments:void");
  const parsed = voidPaymentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  const { paymentId, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const payment = await tx.orderPayment.findUnique({
      where: { id: paymentId },
      select: { id: true, orderId: true, amount: true, voidedAt: true },
    });
    if (!payment) throw new AppError("NOT_FOUND", "الدفعة مش موجودة");
    await lockOrder(tx, payment.orderId);

    // Re-check under the lock: a concurrent void may have won.
    const updated = await tx.orderPayment.updateMany({
      where: { id: paymentId, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", "الدفعة دي ملغية بالفعل");

    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PAYMENT_VOIDED,
      entityType: "OrderPayment",
      entityId: paymentId,
      metadata: {
        orderId: payment.orderId,
        amount: centsToDecimalString(toCents(payment.amount)),
        reason,
      },
    });
    return { orderId: payment.orderId };
  });
}
