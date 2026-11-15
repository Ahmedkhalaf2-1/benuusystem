import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import { dateFromString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney } from "@/lib/money";
import { toFieldErrors } from "@/lib/validations/utils";
import { payWorkerSchema, type PayWorkerPayload } from "@/lib/validations/workers";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import { lockWorker, sumEarned, sumPaidToWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Pays a worker. Both kinds are CASH ONLY (outgoing_payments) — the labour
 * expense is the worked days themselves, so nothing is counted twice:
 *  - WAGE ("دفع يومية / مستحقات"): pays wages already earned; may not exceed
 *    what is currently owed (earned − everything paid so far);
 *  - ADVANCE ("سلفة"): money before it is earned; it is settled automatically
 *    as future days are earned (balance = earned − paid).
 * The worker row is locked so concurrent payments cannot overpay.
 */
export async function payWorker(db: PrismaClient, actor: Actor, payload: PayWorkerPayload) {
  assertPermission(actor, "workers:pay");
  const parsed = payWorkerSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  const input = parsed.data;

  const findExisting = async () => {
    const p = await db.outgoingPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, workerId: true } });
    if (p && p.workerId !== input.workerId) throw new AppError("CONFLICT", "الطلب ده اتسجل قبل كده لعامل تاني");
    return p ? { paymentId: p.id, created: false } : null;
  };
  const previous = await findExisting();
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const worker = await lockWorker(tx, input.workerId);
      if (!worker) throw new AppError("NOT_FOUND", "العامل مش موجود");

      if (input.type === "WAGE") {
        const owed = (await sumEarned(tx, input.workerId)) - (await sumPaidToWorker(tx, input.workerId));
        if (input.amount > owed) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: {
              amount: [
                owed > 0n
                  ? `المبلغ أكبر من المتبقي له (${formatMoney(owed)}). لو بتديله فلوس قبل ما يشتغلها سجّلها «سلفة».`
                  : "مفيش له فلوس مستحقة دلوقتي. لو بتديله فلوس مقدمًا سجّلها «سلفة».",
            ],
          },
        });
        }
      }

      const payment = await tx.outgoingPayment.create({
        data: {
          workerId: input.workerId,
          workerPaymentType: input.type,
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
        action: AUDIT_ACTIONS.WORKER_PAYMENT_RECORDED,
        entityType: "OutgoingPayment",
        entityId: payment.id,
        metadata: {
          workerId: input.workerId,
          type: input.type,
          amount: centsToDecimalString(input.amount),
          method: input.method,
          paidAt: input.paidAt,
        },
      });
      return { paymentId: payment.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findExisting();
      if (winner) return winner;
    }
    throw error;
  }
}
