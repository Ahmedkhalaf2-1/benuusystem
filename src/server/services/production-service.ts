import type { PrismaClient } from "@/generated/prisma/client";
import type { OrderStatus, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, monthRange, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatNumber } from "@/lib/numbers";
import { describeOperations, OPERATION_LABELS, PRINT_OPERATIONS, UNIT_LABELS } from "@/lib/orders/labels";
import { voidRecordSchema } from "@/lib/validations/finance";
import {
  recordDeliverySchema,
  recordReadySchema,
  recordStageSchema,
  type RecordDeliveryPayload,
  type RecordReadyPayload,
  type RecordStagePayload,
} from "@/lib/validations/production";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockOrder } from "@/server/repositories/order-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Production & delivery in PHYSICAL units of the order (never worker prints).
 * Per group, always computed from valid (non-voided) records:
 *   stage(op) ≤ quantity · ready ≤ min(stage of every required op) and ≤ quantity
 *   delivered ≤ ready · readyNotDelivered = ready − delivered · remaining = quantity − ready
 * Every write locks the order row first, so the rules hold under concurrency.
 */

function invalid(error: Parameters<typeof toFieldErrors>[0]): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(error) });
}

export type GroupProgress = {
  id: string;
  position: number;
  quantity: number;
  operations: PrintOperation[];
  description: string;
  stage: Partial<Record<PrintOperation, number>>;
  ready: number;
  delivered: number;
  /** Upper bound for "ready": the least-finished required step (or quantity). */
  maxReady: number;
};

/** Valid progress of every group of an order (pass a transaction to read under the lock). */
export async function loadGroupProgress(db: DbClient, orderId: string): Promise<GroupProgress[]> {
  const [groups, stages, ready, delivered] = await Promise.all([
    db.orderGroup.findMany({
      where: { orderId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, quantity: true, operations: { select: { operation: true } } },
    }),
    db.productionStageProgress.groupBy({ by: ["orderGroupId", "operation"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.productionReady.groupBy({ by: ["orderGroupId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.delivery.groupBy({ by: ["orderGroupId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
  ]);
  return groups.map((g) => {
    const operations = PRINT_OPERATIONS.filter((op) => g.operations.some((o) => o.operation === op));
    const stage: GroupProgress["stage"] = {};
    for (const op of operations) stage[op] = 0;
    for (const s of stages) if (s.orderGroupId === g.id) stage[s.operation] = s._sum.quantity ?? 0;
    const r = ready.find((x) => x.orderGroupId === g.id)?._sum.quantity ?? 0;
    const d = delivered.find((x) => x.orderGroupId === g.id)?._sum.quantity ?? 0;
    const maxReady = operations.length === 0 ? g.quantity : Math.min(g.quantity, ...operations.map((op) => stage[op] ?? 0));
    return {
      id: g.id,
      position: g.position,
      quantity: g.quantity,
      operations,
      description: describeOperations(operations),
      stage,
      ready: r,
      delivered: d,
      maxReady,
    };
  });
}

export function totalsOf(groups: GroupProgress[]) {
  const required = groups.reduce((s, g) => s + g.quantity, 0);
  const ready = groups.reduce((s, g) => s + g.ready, 0);
  const delivered = groups.reduce((s, g) => s + g.delivered, 0);
  return { required, ready, delivered, readyNotDelivered: ready - delivered, remaining: required - ready };
}

/**
 * Status from real records: completed only when every piece of every group was
 * delivered; in progress once anything was recorded. Cancelled orders are left alone.
 */
export async function refreshOrderStatus(tx: DbTransaction, actor: Actor, orderId: string): Promise<OrderStatus> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, number: true } });
  if (order.status === "CANCELLED") return order.status;
  const groups = await loadGroupProgress(tx, orderId);
  const complete = groups.length > 0 && groups.every((g) => g.delivered >= g.quantity);
  const anyProgress = groups.some((g) => g.ready > 0 || g.delivered > 0 || Object.values(g.stage).some((v) => (v ?? 0) > 0));

  let next: OrderStatus = order.status;
  if (complete) next = "COMPLETED";
  else if (order.status === "COMPLETED") next = anyProgress ? "IN_PROGRESS" : "NEW";
  else if (order.status === "NEW" && anyProgress) next = "IN_PROGRESS";

  if (next !== order.status) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: next, completedAt: next === "COMPLETED" ? new Date() : null },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_STATUS_AUTO,
      entityType: "Order",
      entityId: orderId,
      metadata: { number: order.number, from: order.status, to: next },
    });
  }
  return next;
}

/** Locks the order and returns its progress; refuses cancelled orders. */
async function openOrderForWrite(tx: DbTransaction, orderId: string) {
  if (!(await lockOrder(tx, orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, unit: true } });
  if (order.status === "CANCELLED") throw new AppError("CONFLICT", "الأوردر ده ملغي ومينفعش يتسجل عليه إنتاج أو تسليم");
  return { unit: order.unit, groups: await loadGroupProgress(tx, orderId) };
}

function findGroup(groups: GroupProgress[], groupId: string) {
  const g = groups.find((x) => x.id === groupId);
  if (!g) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderGroupId: ["المجموعة دي مش تبع الأوردر ده"] } });
  return g;
}

const n = (value: number, unit: QuantityUnit) => `${formatNumber(value)} ${UNIT_LABELS[unit]}`;

/**
 * Inserts "N pieces finished step X" after checking it against the group.
 * Caller must hold the order lock (openOrderForWrite) and refresh status.
 */
export async function insertStageProgress(
  tx: DbTransaction,
  actor: Actor,
  ctx: { unit: QuantityUnit; groups: GroupProgress[] },
  input: { orderId: string; orderGroupId: string; operation: PrintOperation; quantity: number; workDate: string; notes?: string; idempotencyKey: string; workLogId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  if (!g.operations.includes(input.operation)) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { operation: [`المجموعة دي مش محتاجة ${OPERATION_LABELS[input.operation]}`] },
    });
  }
  const done = g.stage[input.operation] ?? 0;
  if (done + input.quantity > g.quantity) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: {
        quantity: [`مرحلة ${OPERATION_LABELS[input.operation]} فاضل فيها ${n(g.quantity - done, ctx.unit)} بس (اتعمل ${n(done, ctx.unit)} من ${n(g.quantity, ctx.unit)})`],
      },
    });
  }
  const row = await tx.productionStageProgress.create({
    data: {
      orderId: input.orderId,
      orderGroupId: input.orderGroupId,
      operation: input.operation,
      quantity: input.quantity,
      workDate: dateFromString(input.workDate),
      notes: input.notes,
      workLogId: input.workLogId,
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  g.stage[input.operation] = done + input.quantity;
  g.maxReady = g.operations.length === 0 ? g.quantity : Math.min(g.quantity, ...g.operations.map((op) => g.stage[op] ?? 0));
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.PRODUCTION_STAGE_RECORDED,
    entityType: "ProductionStageProgress",
    entityId: row.id,
    metadata: { orderId: input.orderId, orderGroupId: input.orderGroupId, operation: input.operation, quantity: input.quantity, workLogId: input.workLogId ?? null },
  });
  return row;
}

async function insertReady(
  tx: DbTransaction,
  actor: Actor,
  ctx: { unit: QuantityUnit; groups: GroupProgress[] },
  input: { orderId: string; orderGroupId: string; quantity: number; readyDate: string; notes?: string; idempotencyKey: string; stageProgressId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  if (g.ready + input.quantity > g.maxReady) {
    const msg =
      g.operations.length === 0
        ? `فاضل ${n(g.quantity - g.ready, ctx.unit)} بس`
        : `أقصى عدد ممكن يبقى جاهز دلوقتي ${n(Math.max(0, g.maxReady - g.ready), ctx.unit)} — لازم القطع تخلص كل الشغل (${g.description}) الأول. اتسجل جاهز قبل كده ${n(g.ready, ctx.unit)}.`;
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { quantity: [msg] } });
  }
  const row = await tx.productionReady.create({
    data: {
      orderId: input.orderId,
      orderGroupId: input.orderGroupId,
      quantity: input.quantity,
      readyDate: dateFromString(input.readyDate),
      notes: input.notes,
      stageProgressId: input.stageProgressId,
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  g.ready += input.quantity;
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.PRODUCTION_READY_RECORDED,
    entityType: "ProductionReady",
    entityId: row.id,
    metadata: { orderId: input.orderId, orderGroupId: input.orderGroupId, quantity: input.quantity },
  });
  return row;
}

type Created = { id: string; created: boolean };

/** Runs an idempotent write: replays return the first result instead of a duplicate. */
async function idempotent(find: () => Promise<{ id: string } | null>, write: () => Promise<{ id: string }>): Promise<Created> {
  const previous = await find();
  if (previous) return { id: previous.id, created: false };
  try {
    return { id: (await write()).id, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await find();
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}

/**
 * Called from "تسجيل شغل" (same transaction as the worker's output record):
 * confirms N physical pieces finished the matching step. Never marks pieces
 * ready and never touches wages. Locks the order (after the worker lock).
 */
export async function insertStageFromWorkLog(
  tx: DbTransaction,
  actor: Actor,
  input: { orderId: string; orderGroupId: string; operation: PrintOperation; quantity: number; workDate: string; workLogId: string },
) {
  assertPermission(actor, "production:record");
  const ctx = await openOrderForWrite(tx, input.orderId);
  const row = await insertStageProgress(tx, actor, ctx, { ...input, idempotencyKey: crypto.randomUUID() });
  await refreshOrderStatus(tx, actor, input.orderId);
  return row;
}

/** "تسجيل إنتاج" for one step; single-step groups may mark the same pieces ready. */
export async function recordStageProgress(db: PrismaClient, actor: Actor, payload: RecordStagePayload): Promise<Created> {
  assertPermission(actor, "production:record");
  const parsed = recordStageSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.productionStageProgress.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const stage = await insertStageProgress(tx, actor, ctx, input);
        if (input.alsoReady) {
          const g = findGroup(ctx.groups, input.orderGroupId);
          if (g.operations.length !== 1) {
            throw new AppError("VALIDATION_ERROR", "المجموعة دي فيها أكتر من مرحلة. أكّد الجاهز من «جاهز للتسليم» لما القطع تخلص كل الشغل.");
          }
          await insertReady(tx, actor, ctx, {
            orderId: input.orderId,
            orderGroupId: input.orderGroupId,
            quantity: input.quantity,
            readyDate: input.workDate,
            notes: input.notes,
            idempotencyKey: crypto.randomUUID(),
            stageProgressId: stage.id,
          });
        }
        await refreshOrderStatus(tx, actor, input.orderId);
        return stage;
      }),
  );
}

/** "جاهز للتسليم": pieces that finished every required step of their group. */
export async function recordReady(db: PrismaClient, actor: Actor, payload: RecordReadyPayload): Promise<Created> {
  assertPermission(actor, "production:record");
  const parsed = recordReadySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.productionReady.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const g = findGroup(ctx.groups, input.orderGroupId);
        if (g.operations.length > 1 && !input.confirmAllOperations) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: { confirmAllOperations: [`أكّد إن نفس القطع خلصت كل الشغل (${g.description})`] },
          });
        }
        const row = await insertReady(tx, actor, ctx, { ...input, orderGroupId: g.id });
        await refreshOrderStatus(tx, actor, input.orderId);
        return row;
      }),
  );
}

/** "تسليم قطع": never more than what is ready and not yet delivered. */
export async function recordDelivery(db: PrismaClient, actor: Actor, payload: RecordDeliveryPayload): Promise<Created> {
  assertPermission(actor, "deliveries:record");
  const parsed = recordDeliverySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.delivery.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const g = findGroup(ctx.groups, input.orderGroupId);
        const available = g.ready - g.delivered;
        if (input.quantity > available) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: {
              quantity: [available > 0 ? `الجاهز اللي لسه متسلمش ${n(available, ctx.unit)} بس` : "مفيش قطع جاهزة لسه متسلمتش في المجموعة دي"],
            },
          });
        }
        const row = await tx.delivery.create({
          data: {
            orderId: input.orderId,
            orderGroupId: g.id,
            quantity: input.quantity,
            deliveredAt: dateFromString(input.deliveredAt),
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            recordedById: actor.id,
          },
          select: { id: true },
        });
        await recordAudit(tx, {
          userId: actor.id,
          action: AUDIT_ACTIONS.DELIVERY_RECORDED,
          entityType: "Delivery",
          entityId: row.id,
          metadata: { orderId: input.orderId, orderGroupId: g.id, quantity: input.quantity, deliveredAt: input.deliveredAt },
        });
        await refreshOrderStatus(tx, actor, input.orderId);
        return row;
      }),
  );
}

// ───────────────────────────── Owner corrections ─────────────────────────────

function parseVoid(payload: { id?: unknown; reason?: unknown }) {
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  return parsed.data;
}

/** Void "N pieces finished step X" — refused if ready pieces depend on it. */
export async function voidStageProgress(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "production:correct");
  const { id, reason } = parseVoid(payload);
  const row = await db.productionStageProgress.findUnique({ where: { id }, select: { orderId: true } });
  if (!row) throw new AppError("NOT_FOUND", "السجل مش موجود");
  return db.$transaction(async (tx) => {
    await lockOrder(tx, row.orderId);
    const rec = await tx.productionStageProgress.findUniqueOrThrow({ where: { id } });
    if (rec.voidedAt) throw new AppError("CONFLICT", "السجل ده ملغي بالفعل");
    const g = findGroup(await loadGroupProgress(tx, rec.orderId), rec.orderGroupId);
    const after = (g.stage[rec.operation] ?? 0) - rec.quantity;
    if (after < g.ready) {
      throw new AppError("CONFLICT", `مينفعش: اتسجل ${formatNumber(g.ready)} قطعة جاهزة، و${OPERATION_LABELS[rec.operation]} هيبقى ${formatNumber(after)} بس. ألغِ سجل الجاهز الأول.`);
    }
    await tx.productionStageProgress.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PRODUCTION_STAGE_VOIDED,
      entityType: "ProductionStageProgress",
      entityId: id,
      metadata: { orderId: rec.orderId, operation: rec.operation, quantity: rec.quantity, reason },
    });
    await refreshOrderStatus(tx, actor, rec.orderId);
    return { orderId: rec.orderId };
  });
}

/** Void a "ready" record — refused if delivered pieces depend on it. */
export async function voidReady(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "production:correct");
  const { id, reason } = parseVoid(payload);
  const row = await db.productionReady.findUnique({ where: { id }, select: { orderId: true } });
  if (!row) throw new AppError("NOT_FOUND", "السجل مش موجود");
  return db.$transaction(async (tx) => {
    await lockOrder(tx, row.orderId);
    const rec = await tx.productionReady.findUniqueOrThrow({ where: { id } });
    if (rec.voidedAt) throw new AppError("CONFLICT", "السجل ده ملغي بالفعل");
    const g = findGroup(await loadGroupProgress(tx, rec.orderId), rec.orderGroupId);
    if (g.ready - rec.quantity < g.delivered) {
      throw new AppError("CONFLICT", `مينفعش: اتسلم ${formatNumber(g.delivered)} قطعة، والجاهز هيبقى ${formatNumber(g.ready - rec.quantity)} بس. ألغِ التسليم الأول لو كان غلط.`);
    }
    await tx.productionReady.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PRODUCTION_READY_VOIDED,
      entityType: "ProductionReady",
      entityId: id,
      metadata: { orderId: rec.orderId, quantity: rec.quantity, reason },
    });
    await refreshOrderStatus(tx, actor, rec.orderId);
    return { orderId: rec.orderId };
  });
}

export async function voidDelivery(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "production:correct");
  const { id, reason } = parseVoid(payload);
  const row = await db.delivery.findUnique({ where: { id }, select: { orderId: true } });
  if (!row) throw new AppError("NOT_FOUND", "التسليم مش موجود");
  return db.$transaction(async (tx) => {
    await lockOrder(tx, row.orderId);
    const updated = await tx.delivery.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    if (updated.count === 0) throw new AppError("CONFLICT", "التسليم ده ملغي بالفعل");
    const rec = await tx.delivery.findUniqueOrThrow({ where: { id }, select: { orderId: true, quantity: true } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.DELIVERY_VOIDED,
      entityType: "Delivery",
      entityId: id,
      metadata: { orderId: rec.orderId, quantity: rec.quantity, reason },
    });
    await refreshOrderStatus(tx, actor, rec.orderId);
    return { orderId: rec.orderId };
  });
}

// ───────────────────────────── Read ─────────────────────────────

type HistoryBase = { id: string; date: string; groupPosition: number; quantity: number; notes: string | null; recordedByName: string; createdAt: Date; voided: null | { byName: string; reason: string } };

export type OrderProduction = {
  unit: QuantityUnit;
  totals: ReturnType<typeof totalsOf>;
  groups: GroupProgress[];
  stageHistory: (HistoryBase & { operation: PrintOperation; fromWorker: string | null })[];
  readyHistory: HistoryBase[];
  deliveryHistory: HistoryBase[];
};

export async function getOrderProduction(db: DbClient, actor: Actor, orderId: string): Promise<OrderProduction | null> {
  assertPermission(actor, "orders:view");
  const order = await db.order.findUnique({ where: { id: orderId }, select: { unit: true } });
  if (!order) return null;
  const by = { recordedBy: { select: { name: true } }, voidedBy: { select: { name: true } }, orderGroup: { select: { position: true } } } as const;
  const [groups, stages, ready, deliveries] = await Promise.all([
    loadGroupProgress(db, orderId),
    db.productionStageProgress.findMany({
      where: { orderId },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      include: { ...by, workLog: { select: { worker: { select: { name: true } } } } },
    }),
    db.productionReady.findMany({ where: { orderId }, orderBy: [{ readyDate: "desc" }, { createdAt: "desc" }], include: by }),
    db.delivery.findMany({ where: { orderId }, orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }], include: by }),
  ]);
  const common = (r: { id: string; quantity: number; notes: string | null; createdAt: Date; voidedAt: Date | null; voidReason: string | null; recordedBy: { name: string }; voidedBy: { name: string } | null; orderGroup: { position: number } }, date: Date): HistoryBase => ({
    id: r.id,
    date: dateToString(date),
    groupPosition: r.orderGroup.position,
    quantity: r.quantity,
    notes: r.notes,
    recordedByName: r.recordedBy.name,
    createdAt: r.createdAt,
    voided: r.voidedAt && r.voidReason ? { byName: r.voidedBy?.name ?? "", reason: r.voidReason } : null,
  });
  return {
    unit: order.unit,
    totals: totalsOf(groups),
    groups,
    stageHistory: stages.map((s) => ({ ...common(s, s.workDate), operation: s.operation, fromWorker: s.workLog?.worker.name ?? null })),
    readyHistory: ready.map((r) => common(r, r.readyDate)),
    deliveryHistory: deliveries.map((d) => common(d, d.deliveredAt)),
  };
}

/** Required / ready / delivered per order, for list cards (one query per table). */
export async function productionTotalsByOrder(db: DbClient, orderIds: string[]) {
  const result = new Map<string, { ready: number; delivered: number }>();
  if (orderIds.length === 0) return result;
  const [ready, delivered] = await Promise.all([
    db.productionReady.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, voidedAt: null }, _sum: { quantity: true } }),
    db.delivery.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, voidedAt: null }, _sum: { quantity: true } }),
  ]);
  for (const id of orderIds) result.set(id, { ready: 0, delivered: 0 });
  for (const r of ready) result.get(r.orderId)!.ready = r._sum.quantity ?? 0;
  for (const d of delivered) result.get(d.orderId)!.delivered = d._sum.quantity ?? 0;
  return result;
}

/** Production numbers for the dashboard. Quantities are per unit — never added across units. */
export async function getProductionDashboard(db: DbClient, actor: Actor) {
  assertPermission(actor, "orders:view");
  const today = todayDateString();
  const month = monthRange(today);
  const [completed, deliveriesToday, deliveredByUnit] = await Promise.all([
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders
      WHERE status = 'COMPLETED'
        AND (completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN ${month.from}::date AND ${month.to}::date`,
    db.delivery.count({ where: { voidedAt: null, deliveredAt: dateFromString(today) } }),
    db.$queryRaw<{ unit: QuantityUnit; qty: number }[]>`
      SELECT o.unit AS unit, SUM(d.quantity)::int AS qty
      FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.voided_at IS NULL AND d.delivered_at BETWEEN ${month.from}::date AND ${month.to}::date
      GROUP BY o.unit ORDER BY o.unit`,
  ]);
  return { completedThisMonth: completed[0]?.n ?? 0, deliveriesToday, deliveredThisMonth: deliveredByUnit };
}
