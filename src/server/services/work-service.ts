import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbTransaction } from "@/lib/db/prisma";
import { dateFromString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, type Cents } from "@/lib/money";
import { voidRecordSchema } from "@/lib/validations/finance";
import { toFieldErrors } from "@/lib/validations/utils";
import {
  recordWorkdaySchema,
  recordWorkLogSchema,
  type RecordWorkdayPayload,
  type RecordWorkLogPayload,
} from "@/lib/validations/workers";
import { WORK_TYPE_TO_OPERATION, WORK_UNIT_LABELS } from "@/lib/workers/labels";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import { lockOrder } from "@/server/repositories/order-repository";
import { lockWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { insertStageFromWorkLog } from "./production-service";

function invalid(error: { issues: unknown[] } & Parameters<typeof toFieldErrors>[0]): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(error) });
}

async function findValidWorkday(tx: DbTransaction, workerId: string, workDate: string) {
  return tx.workerWorkday.findFirst({
    where: { workerId, workDate: dateFromString(workDate), voidedAt: null },
    select: { id: true, worked: true },
  });
}

async function insertWorkday(
  tx: DbTransaction,
  actor: Actor,
  data: { workerId: string; workDate: string; worked: boolean; wage: Cents; notes?: string; idempotencyKey: string; auto?: boolean; createdAt?: Date },
) {
  const day = await tx.workerWorkday.create({
    data: {
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      workerId: data.workerId,
      workDate: dateFromString(data.workDate),
      worked: data.worked,
      wage: centsToDecimalString(data.worked ? data.wage : 0n),
      notes: data.notes,
      idempotencyKey: data.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.WORKDAY_RECORDED,
    entityType: "WorkerWorkday",
    entityId: day.id,
    metadata: {
      workerId: data.workerId,
      workDate: data.workDate,
      worked: data.worked,
      wage: centsToDecimalString(data.worked ? data.wage : 0n),
      ...(data.auto ? { createdWithWorkLog: true } : {}),
    },
  });
  return day;
}

/**
 * "تسجيل يومية": one record per worker per date. The day's wage is copied from
 * the worker's current daily wage (a snapshot), so later wage changes never
 * rewrite past earnings. Only the owner may set a different wage for a day.
 */
export async function recordWorkday(db: PrismaClient, actor: Actor, payload: RecordWorkdayPayload) {
  assertPermission(actor, "work:record");
  const parsed = recordWorkdaySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;
  if (input.wage !== undefined) assertPermission(actor, "workers:manage");

  const previous = await db.workerWorkday.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (previous) return { workdayId: previous.id, created: false };

  try {
    return await db.$transaction(async (tx) => {
      const worker = await lockWorker(tx, input.workerId);
      if (!worker) throw new AppError("NOT_FOUND", "العامل مش موجود");
      if (!worker.isActive) throw new AppError("CONFLICT", "العامل ده موقوف. فعّله الأول من صفحة التعديل.");
      if (await findValidWorkday(tx, input.workerId, input.workDate)) {
        throw new AppError("CONFLICT", "اليوم ده متسجل بالفعل للعامل ده. لو فيه غلط، المدير يقدر يلغيه ويسجله من جديد.");
      }
      const day = await insertWorkday(tx, actor, {
        workerId: input.workerId,
        workDate: input.workDate,
        worked: input.worked,
        wage: input.wage ?? worker.dailyWage,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
      });
      return { workdayId: day.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.workerWorkday.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (winner) return { workdayId: winner.id, created: false };
      throw new AppError("CONFLICT", "اليوم ده متسجل بالفعل للعامل ده.");
    }
    throw error;
  }
}

/**
 * "تسجيل شغل": what the worker produced, optionally for an order (and group).
 * If the day has no attendance yet it is created as a worked day (he worked,
 * so he came). These logs measure productivity and split the day's wage across
 * orders; they do NOT mark order production or delivery.
 */
export async function recordWorkLog(db: PrismaClient, actor: Actor, payload: RecordWorkLogPayload) {
  assertPermission(actor, "work:record");
  const parsed = recordWorkLogSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  const replay = async () => {
    const log = await db.workerWorkLog.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, workdayId: true, createdAt: true, workday: { select: { createdAt: true } } },
    });
    if (!log) return null;
    // A day auto-created together with this log is written with the log's exact
    // createdAt (see below), so equal timestamps mean "this log created the day".
    const createdWorkday = log.workday.createdAt.getTime() === log.createdAt.getTime();
    return { workLogId: log.id, workdayId: log.workdayId, created: false, createdWorkday };
  };
  const previous = await replay();
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const worker = await lockWorker(tx, input.workerId);
      if (!worker) throw new AppError("NOT_FOUND", "العامل مش موجود");

      if (input.orderGroupId && !input.orderId) {
        throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderId: ["اختار الأوردر"] } });
      }
      if (input.orderId) {
        // Order lock after the worker lock (same order as production writes); archived = missing.
        const order = (await lockOrder(tx, input.orderId)) ? await tx.order.findUnique({ where: { id: input.orderId }, select: { status: true } }) : null;
        if (!order) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderId: ["الأوردر مش موجود"] } });
        if (order.status === "CANCELLED") {
          throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderId: ["الأوردر ده ملغي"] } });
        }
        if (input.orderGroupId) {
          const group = await tx.orderGroup.findUnique({ where: { id: input.orderGroupId }, select: { orderId: true } });
          if (!group || group.orderId !== input.orderId) {
            throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderGroupId: ["البند ده مش تبع الأوردر ده"] } });
          }
        }
      }

      const now = new Date();
      let day = await findValidWorkday(tx, input.workerId, input.workDate);
      let createdWorkday = false;
      if (day && !day.worked) {
        throw new AppError("CONFLICT", "العامل متسجل غايب اليوم ده. المدير يقدر يصحح اليومية الأول.");
      }
      if (!day) {
        if (!worker.isActive) throw new AppError("CONFLICT", "العامل ده موقوف. فعّله الأول من صفحة التعديل.");
        const created = await insertWorkday(tx, actor, {
          workerId: input.workerId,
          workDate: input.workDate,
          worked: true,
          wage: worker.dailyWage,
          idempotencyKey: randomUUID(),
          auto: true,
          createdAt: now,
        });
        day = { id: created.id, worked: true };
        createdWorkday = true;
      }

      // Different units on one day can't be added up: the split then uses hours.
      const others = await tx.workerWorkLog.findMany({
        where: { workdayId: day.id, voidedAt: null, unit: { not: input.unit } },
        select: { unit: true },
        distinct: ["unit"],
      });
      if (others.length > 0 && input.hours === undefined) {
        throw new AppError("VALIDATION_ERROR", undefined, {
          fieldErrors: {
            hours: [
              `اتسجل له النهارده شغل بوحدة تانية (${others.map((o) => WORK_UNIT_LABELS[o.unit]).join("، ")}). اكتب عدد الساعات عشان اليومية تتقسم صح.`,
            ],
          },
        });
      }

      const log = await tx.workerWorkLog.create({
        data: {
          workdayId: day.id,
          workerId: input.workerId,
          orderId: input.orderId,
          orderGroupId: input.orderGroupId,
          workType: input.workType,
          quantity: input.quantity,
          unit: input.unit,
          hours: input.hours !== undefined ? centsToDecimalString(BigInt(input.hours)) : null,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.id,
          createdAt: now,
        },
        select: { id: true },
      });
      // Optional, explicit: "N physical pieces finished this step" (not inferred from prints).
      let stageProgressId: string | null = null;
      if (input.stageQuantity !== undefined) {
        const operation = WORK_TYPE_TO_OPERATION[input.workType];
        if (!input.orderId || !input.orderGroupId || !operation) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: { stageQuantity: ["الشغل ده مش مرحلة إنتاج متابعة في الأوردر — سيب الخانة دي فاضية"] },
          });
        }
        const stage = await insertStageFromWorkLog(tx, actor, {
          orderId: input.orderId,
          orderGroupId: input.orderGroupId,
          operation,
          quantity: input.stageQuantity,
          workDate: input.workDate,
          workLogId: log.id,
        }).catch((error: unknown) => {
          // Show stage-quantity problems on the stage field of this form.
          if (error instanceof AppError && error.fieldErrors) {
            const { quantity, operation: op, ...rest } = error.fieldErrors;
            throw new AppError(error.code, error.message, { fieldErrors: { ...rest, ...(quantity || op ? { stageQuantity: [...(quantity ?? []), ...(op ?? [])] } : {}) } });
          }
          throw error;
        });
        stageProgressId = stage.id;
      }
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.WORK_LOG_RECORDED,
        entityType: "WorkerWorkLog",
        entityId: log.id,
        metadata: {
          workerId: input.workerId,
          workDate: input.workDate,
          orderId: input.orderId ?? null,
          orderGroupId: input.orderGroupId ?? null,
          workType: input.workType,
          quantity: input.quantity,
          unit: input.unit,
          stageProgressId,
        },
      });
      return { workLogId: log.id, workdayId: day.id, created: true, createdWorkday };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await replay();
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Owner-only correction of attendance: voids the day (its wage stops counting)
 * and its output records. Nothing is deleted; the day can then be re-recorded.
 */
export async function voidWorkday(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "workers:correct");
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const { id, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const day = await tx.workerWorkday.findUnique({ where: { id }, select: { workerId: true, voidedAt: true, wage: true, workDate: true } });
    if (!day) throw new AppError("NOT_FOUND", "اليومية مش موجودة");
    await lockWorker(tx, day.workerId);
    const now = new Date();
    const updated = await tx.workerWorkday.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: now, voidedById: actor.id, voidReason: reason },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", "اليومية دي ملغية بالفعل");
    const logs = await tx.workerWorkLog.findMany({ where: { workdayId: id, voidedAt: null }, select: { id: true } });
    if (logs.length > 0) {
      await tx.workerWorkLog.updateMany({
        where: { id: { in: logs.map((l) => l.id) } },
        data: { voidedAt: now, voidedById: actor.id, voidReason: `مع إلغاء اليومية: ${reason}` },
      });
    }
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.WORKDAY_VOIDED,
      entityType: "WorkerWorkday",
      entityId: id,
      metadata: { workerId: day.workerId, wage: day.wage.toString(), reason, voidedWorkLogs: logs.map((l) => l.id) },
    });
    return { workerId: day.workerId };
  });
}

/** Owner-only correction of one output record (the day's wage is re-split). */
export async function voidWorkLog(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "workers:correct");
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const { id, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const log = await tx.workerWorkLog.findUnique({ where: { id }, select: { workerId: true } });
    if (!log) throw new AppError("NOT_FOUND", "الشغل ده مش موجود");
    await lockWorker(tx, log.workerId);
    const updated = await tx.workerWorkLog.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
    });
    if (updated.count === 0) throw new AppError("CONFLICT", "الشغل ده ملغي بالفعل");
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.WORK_LOG_VOIDED,
      entityType: "WorkerWorkLog",
      entityId: id,
      metadata: { workerId: log.workerId, reason },
    });
    return { workerId: log.workerId };
  });
}

