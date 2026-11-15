import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { WorkerJob, WorkUnit } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents } from "@/lib/money";
import { workerInputSchema, type WorkerFormValues, type WorkerInput } from "@/lib/validations/workers";
import { toFieldErrors } from "@/lib/validations/utils";
import { balancesByWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

function parseWorker(raw: WorkerFormValues): WorkerInput {
  const parsed = workerInputSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  return parsed.data;
}

function workerData(input: WorkerInput) {
  return {
    name: input.name,
    phone: input.phone ?? null,
    job: input.job,
    jobTitle: input.jobTitle ?? null,
    dailyWage: centsToDecimalString(input.dailyWage),
    dailyTarget: input.dailyTarget ?? null,
    targetUnit: input.targetUnit ?? null,
    isActive: input.isActive,
    notes: input.notes ?? null,
  };
}

export async function createWorker(db: PrismaClient, actor: Actor, raw: WorkerFormValues) {
  assertPermission(actor, "workers:manage");
  const input = parseWorker(raw);
  return db.$transaction(async (tx) => {
    const worker = await tx.worker.create({ data: { ...workerData(input), createdById: actor.id }, select: { id: true, name: true } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.WORKER_CREATED,
      entityType: "Worker",
      entityId: worker.id,
      metadata: { name: input.name, job: input.job, dailyWage: centsToDecimalString(input.dailyWage) },
    });
    return worker;
  });
}

/**
 * Edits a worker. Changing the daily wage only affects days recorded AFTER the
 * change: every workday keeps its own wage snapshot.
 */
export async function updateWorker(db: PrismaClient, actor: Actor, workerId: string, raw: WorkerFormValues) {
  assertPermission(actor, "workers:manage");
  const input = parseWorker(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.worker.findUnique({ where: { id: workerId } });
    if (!before) throw new AppError("NOT_FOUND", "العامل مش موجود");
    const after = workerData(input);
    const beforeComparable: Record<string, unknown> = {
      ...before,
      dailyWage: centsToDecimalString(toCents(before.dailyWage)),
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(after)) {
      if (beforeComparable[key] !== value) changes[key] = { from: beforeComparable[key] ?? null, to: value };
    }
    await tx.worker.update({ where: { id: workerId }, data: after });
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.WORKER_UPDATED,
        entityType: "Worker",
        entityId: workerId,
        metadata: { changes } as Prisma.InputJsonValue,
      });
    }
    return { id: workerId };
  });
}

export type WorkerListItem = {
  id: string;
  name: string;
  job: WorkerJob;
  jobTitle: string | null;
  isActive: boolean;
  dailyTarget: number | null;
  targetUnit: WorkUnit | null;
  /** Today's attendance: null = not recorded yet. */
  today: null | { worked: boolean };
  /** Only for users allowed to see pay. */
  pay: null | { dailyWage: string; owed: string; advanceOutstanding: string };
};

export async function listWorkers(db: DbClient, actor: Actor, options: { includeInactive?: boolean } = {}) {
  assertPermission(actor, "workers:view");
  const workers = await db.worker.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, job: true, jobTitle: true, isActive: true, dailyTarget: true, targetUnit: true, dailyWage: true },
  });
  const ids = workers.map((w) => w.id);
  const today = await db.workerWorkday.findMany({
    where: { workerId: { in: ids }, voidedAt: null, workDate: dateFromString(todayDateString()) },
    select: { workerId: true, worked: true },
  });
  const todayMap = new Map(today.map((d) => [d.workerId, d.worked]));
  const canSeePay = hasPermission(actor, "workers:view-pay");
  const balances = canSeePay ? await balancesByWorker(db, ids) : null;

  return workers.map((w): WorkerListItem => {
    const b = balances?.get(w.id);
    const net = b ? b.earned - b.paid : 0n;
    return {
      id: w.id,
      name: w.name,
      job: w.job,
      jobTitle: w.jobTitle,
      isActive: w.isActive,
      dailyTarget: w.dailyTarget,
      targetUnit: w.targetUnit,
      today: todayMap.has(w.id) ? { worked: todayMap.get(w.id)! } : null,
      pay: canSeePay
        ? {
            dailyWage: centsToDecimalString(toCents(w.dailyWage)),
            owed: centsToDecimalString(net > 0n ? net : 0n),
            advanceOutstanding: centsToDecimalString(net < 0n ? -net : 0n),
          }
        : null,
    };
  });
}

/** For the edit form (owner). */
export async function getWorkerForEdit(db: DbClient, actor: Actor, workerId: string) {
  assertPermission(actor, "workers:manage");
  const w = await db.worker.findUnique({ where: { id: workerId } });
  return w ? { ...w, dailyWage: centsToDecimalString(toCents(w.dailyWage)) } : null;
}
