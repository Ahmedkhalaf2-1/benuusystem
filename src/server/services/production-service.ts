import { createHash, randomUUID } from "node:crypto";
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
 * Per group — and, for groups with a size breakdown, per size — always computed
 * from valid (non-voided) records:
 *   stage(op) ≤ quantity · ready ≤ min(stage of every required op) and ≤ quantity
 *   delivered ≤ ready · readyNotDelivered = ready − delivered · remaining = quantity − ready
 * A sized group's records each name their size, so its totals are exactly the
 * sum of its sizes (nothing counted twice). Every write locks the order row first.
 */

function invalid(error: Parameters<typeof toFieldErrors>[0]): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(error) });
}

type Counters = {
  quantity: number;
  stage: Partial<Record<PrintOperation, number>>;
  ready: number;
  delivered: number;
  /** Upper bound for "ready": the least-finished required step (or quantity). */
  maxReady: number;
};

export type SizeProgress = Counters & { id: string; label: string };

export type GroupProgress = Counters & {
  id: string;
  position: number;
  operations: PrintOperation[];
  description: string;
  /** Empty for groups without a size breakdown. */
  sizes: SizeProgress[];
};

function maxReadyOf(c: { quantity: number; stage: Counters["stage"] }, operations: PrintOperation[]) {
  return operations.length === 0 ? c.quantity : Math.min(c.quantity, ...operations.map((op) => c.stage[op] ?? 0));
}

/** Valid progress of every group (and size) of an order. Pass a transaction to read under the lock. */
export async function loadGroupProgress(db: DbClient, orderId: string): Promise<GroupProgress[]> {
  const [groups, stages, ready, delivered] = await Promise.all([
    db.orderGroup.findMany({
      where: { orderId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        quantity: true,
        operations: { select: { operation: true } },
        sizes: { orderBy: { position: "asc" }, select: { id: true, label: true, quantity: true } },
      },
    }),
    db.productionStageProgress.groupBy({ by: ["orderGroupId", "orderGroupSizeId", "operation"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.productionReady.groupBy({ by: ["orderGroupId", "orderGroupSizeId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.delivery.groupBy({ by: ["orderGroupId", "orderGroupSizeId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
  ]);
  return groups.map((g) => {
    const operations = PRINT_OPERATIONS.filter((op) => g.operations.some((o) => o.operation === op));
    const counters = (quantity: number, match: (row: { orderGroupId: string; orderGroupSizeId: string | null }) => boolean): Counters => {
      const stage: Counters["stage"] = {};
      for (const op of operations) stage[op] = 0;
      for (const s of stages) if (match(s)) stage[s.operation] = (stage[s.operation] ?? 0) + (s._sum.quantity ?? 0);
      const r = ready.filter(match).reduce((sum, x) => sum + (x._sum.quantity ?? 0), 0);
      const d = delivered.filter(match).reduce((sum, x) => sum + (x._sum.quantity ?? 0), 0);
      const c = { quantity, stage, ready: r, delivered: d, maxReady: 0 };
      c.maxReady = maxReadyOf(c, operations);
      return c;
    };
    return {
      id: g.id,
      position: g.position,
      operations,
      description: describeOperations(operations),
      ...counters(g.quantity, (row) => row.orderGroupId === g.id),
      sizes: g.sizes.map((size) => ({
        id: size.id,
        label: size.label,
        ...counters(size.quantity, (row) => row.orderGroupId === g.id && row.orderGroupSizeId === size.id),
      })),
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

/** Field name used for a per-size error, so the form can show it beside that size. */
const sizeField = (sizeId: string) => `size:${sizeId}`;

type Line = { sizeId?: string; quantity: number };

/**
 * Turns a submission into one line per unit of tracking: one line for an
 * unsized group, one per entered size for a sized group (sizes required there).
 */
function linesFor(g: GroupProgress, input: { quantity?: number; sizes?: { sizeId: string; quantity: number }[] }, quantityField = "quantity"): Line[] {
  if (g.sizes.length === 0) {
    if (input.sizes && input.sizes.length > 0) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [quantityField]: ["المجموعة دي من غير مقاسات — اكتب العدد بس"] } });
    }
    if (input.quantity === undefined) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [quantityField]: ["اكتب العدد"] } });
    }
    return [{ quantity: input.quantity }];
  }
  const lines = (input.sizes ?? []).filter((l) => l.quantity > 0);
  if (lines.length === 0) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { sizes: ["اكتب العدد قدام المقاسات اللي اتعملت"] } });
  }
  const seen = new Set<string>();
  for (const l of lines) {
    if (!g.sizes.some((s) => s.id === l.sizeId) || seen.has(l.sizeId)) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { sizes: ["في مقاس مش تبع المجموعة دي — افتح الصفحة من جديد"] } });
    }
    seen.add(l.sizeId);
  }
  return lines.map((l) => ({ sizeId: l.sizeId, quantity: l.quantity }));
}

/** The counters a line is checked against: its size, or the whole (unsized) group. */
function targetOf(g: GroupProgress, sizeId?: string): Counters & { label?: string } {
  return sizeId ? g.sizes.find((s) => s.id === sizeId)! : g;
}

/**
 * One deterministic key per row of a multi-size submission, so a retried
 * submission maps to the same rows (and the unique index rejects duplicates).
 */
function rowKey(idempotencyKey: string, sizeId?: string): string {
  if (!sizeId) return idempotencyKey;
  const h = createHash("sha256").update(`${idempotencyKey}:${sizeId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const firstRowKey = (input: { idempotencyKey: string; sizes?: { sizeId: string }[] }) => rowKey(input.idempotencyKey, input.sizes?.find(Boolean)?.sizeId);

function bump(g: GroupProgress, sizeId: string | undefined, apply: (c: Counters) => void) {
  apply(g);
  g.maxReady = maxReadyOf(g, g.operations);
  if (sizeId) {
    const s = g.sizes.find((x) => x.id === sizeId)!;
    apply(s);
    s.maxReady = maxReadyOf(s, g.operations);
  }
}

/**
 * Inserts "N pieces (of one size) finished step X" after checking it against
 * the group/size. Caller must hold the order lock (openOrderForWrite) and refresh status.
 */
export async function insertStageProgress(
  tx: DbTransaction,
  actor: Actor,
  ctx: { unit: QuantityUnit; groups: GroupProgress[] },
  input: { orderId: string; orderGroupId: string; orderGroupSizeId?: string; operation: PrintOperation; quantity: number; workDate: string; notes?: string; idempotencyKey: string; workLogId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  if (!g.operations.includes(input.operation)) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { operation: [`المجموعة دي مش محتاجة ${OPERATION_LABELS[input.operation]}`] },
    });
  }
  const t = targetOf(g, input.orderGroupSizeId);
  const done = t.stage[input.operation] ?? 0;
  if (done + input.quantity > t.quantity) {
    const who = t.label ? `مقاس ${t.label}: ` : "";
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: {
        [input.orderGroupSizeId ? sizeField(input.orderGroupSizeId) : "quantity"]: [
          `${who}مرحلة ${OPERATION_LABELS[input.operation]} فاضل فيها ${n(t.quantity - done, ctx.unit)} بس (اتعمل ${n(done, ctx.unit)} من ${n(t.quantity, ctx.unit)})`,
        ],
      },
    });
  }
  const row = await tx.productionStageProgress.create({
    data: {
      orderId: input.orderId,
      orderGroupId: input.orderGroupId,
      orderGroupSizeId: input.orderGroupSizeId,
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
  bump(g, input.orderGroupSizeId, (c) => {
    c.stage[input.operation] = (c.stage[input.operation] ?? 0) + input.quantity;
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.PRODUCTION_STAGE_RECORDED,
    entityType: "ProductionStageProgress",
    entityId: row.id,
    metadata: {
      orderId: input.orderId,
      orderGroupId: input.orderGroupId,
      orderGroupSizeId: input.orderGroupSizeId ?? null,
      size: t.label ?? null,
      operation: input.operation,
      quantity: input.quantity,
      workLogId: input.workLogId ?? null,
    },
  });
  return row;
}

async function insertReady(
  tx: DbTransaction,
  actor: Actor,
  ctx: { unit: QuantityUnit; groups: GroupProgress[] },
  input: { orderId: string; orderGroupId: string; orderGroupSizeId?: string; quantity: number; readyDate: string; notes?: string; idempotencyKey: string; stageProgressId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  const t = targetOf(g, input.orderGroupSizeId);
  if (t.ready + input.quantity > t.maxReady) {
    const who = t.label ? `مقاس ${t.label}: ` : "";
    const msg =
      g.operations.length === 0
        ? `${who}فاضل ${n(t.quantity - t.ready, ctx.unit)} بس`
        : `${who}أقصى عدد ممكن يبقى جاهز دلوقتي ${n(Math.max(0, t.maxReady - t.ready), ctx.unit)} — لازم القطع تخلص كل الشغل (${g.description}) الأول. اتسجل جاهز قبل كده ${n(t.ready, ctx.unit)}.`;
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [input.orderGroupSizeId ? sizeField(input.orderGroupSizeId) : "quantity"]: [msg] } });
  }
  const row = await tx.productionReady.create({
    data: {
      orderId: input.orderId,
      orderGroupId: input.orderGroupId,
      orderGroupSizeId: input.orderGroupSizeId,
      quantity: input.quantity,
      readyDate: dateFromString(input.readyDate),
      notes: input.notes,
      stageProgressId: input.stageProgressId,
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  bump(g, input.orderGroupSizeId, (c) => {
    c.ready += input.quantity;
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.PRODUCTION_READY_RECORDED,
    entityType: "ProductionReady",
    entityId: row.id,
    metadata: { orderId: input.orderId, orderGroupId: input.orderGroupId, orderGroupSizeId: input.orderGroupSizeId ?? null, size: t.label ?? null, quantity: input.quantity },
  });
  return row;
}

type Created = { id: string; created: boolean };

/**
 * Runs an idempotent write: replays return the first result instead of a
 * duplicate. `write` re-checks under the order lock (a twin request that waited
 * on the lock finds the winner's row there, before re-validating stock) and
 * returns `replayed` when it did.
 */
async function idempotent(find: () => Promise<{ id: string } | null>, write: () => Promise<{ id: string; replayed?: boolean }>): Promise<Created> {
  const previous = await find();
  if (previous) return { id: previous.id, created: false };
  try {
    const result = await write();
    return { id: result.id, created: !result.replayed };
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
 * Groups with a size breakdown are recorded per size from the order page.
 */
export async function insertStageFromWorkLog(
  tx: DbTransaction,
  actor: Actor,
  input: { orderId: string; orderGroupId: string; operation: PrintOperation; quantity: number; workDate: string; workLogId: string },
) {
  assertPermission(actor, "production:record");
  const ctx = await openOrderForWrite(tx, input.orderId);
  if (findGroup(ctx.groups, input.orderGroupId).sizes.length > 0) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { quantity: ["المجموعة دي بمقاسات — سجّل القطع بالمقاسات من صفحة الأوردر («تسجيل إنتاج»)."] },
    });
  }
  const row = await insertStageProgress(tx, actor, ctx, { ...input, idempotencyKey: randomUUID() });
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
    () => db.productionStageProgress.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const twin = await tx.productionStageProgress.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } });
        if (twin) return { id: twin.id, replayed: true };
        const g = findGroup(ctx.groups, input.orderGroupId);
        if (input.alsoReady && g.operations.length !== 1) {
          throw new AppError("VALIDATION_ERROR", "المجموعة دي فيها أكتر من مرحلة. أكّد الجاهز من «جاهز للتسليم» لما القطع تخلص كل الشغل.");
        }
        let first: { id: string } | null = null;
        for (const line of linesFor(g, input)) {
          const stage = await insertStageProgress(tx, actor, ctx, {
            orderId: input.orderId,
            orderGroupId: g.id,
            orderGroupSizeId: line.sizeId,
            operation: input.operation,
            quantity: line.quantity,
            workDate: input.workDate,
            notes: input.notes,
            idempotencyKey: rowKey(input.idempotencyKey, line.sizeId),
          });
          first ??= stage;
          if (input.alsoReady) {
            await insertReady(tx, actor, ctx, {
              orderId: input.orderId,
              orderGroupId: g.id,
              orderGroupSizeId: line.sizeId,
              quantity: line.quantity,
              readyDate: input.workDate,
              notes: input.notes,
              idempotencyKey: randomUUID(),
              stageProgressId: stage.id,
            });
          }
        }
        await refreshOrderStatus(tx, actor, input.orderId);
        return first!;
      }),
  );
}

/** "جاهز للتسليم": pieces that finished every required step of their group (per size when sized). */
export async function recordReady(db: PrismaClient, actor: Actor, payload: RecordReadyPayload): Promise<Created> {
  assertPermission(actor, "production:record");
  const parsed = recordReadySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.productionReady.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const twin = await tx.productionReady.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } });
        if (twin) return { id: twin.id, replayed: true };
        const g = findGroup(ctx.groups, input.orderGroupId);
        if (g.operations.length > 1 && !input.confirmAllOperations) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: { confirmAllOperations: [`أكّد إن نفس القطع خلصت كل الشغل (${g.description})`] },
          });
        }
        let first: { id: string } | null = null;
        for (const line of linesFor(g, input)) {
          const row = await insertReady(tx, actor, ctx, {
            orderId: input.orderId,
            orderGroupId: g.id,
            orderGroupSizeId: line.sizeId,
            quantity: line.quantity,
            readyDate: input.readyDate,
            notes: input.notes,
            idempotencyKey: rowKey(input.idempotencyKey, line.sizeId),
          });
          first ??= row;
        }
        await refreshOrderStatus(tx, actor, input.orderId);
        return first!;
      }),
  );
}

/** "تسليم قطع": never more than what is ready and not yet delivered (per size when sized). */
export async function recordDelivery(db: PrismaClient, actor: Actor, payload: RecordDeliveryPayload): Promise<Created> {
  assertPermission(actor, "deliveries:record");
  const parsed = recordDeliverySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.delivery.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, input.orderId);
        const twin = await tx.delivery.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } });
        if (twin) return { id: twin.id, replayed: true };
        const g = findGroup(ctx.groups, input.orderGroupId);
        let first: { id: string } | null = null;
        for (const line of linesFor(g, input)) {
          const t = targetOf(g, line.sizeId);
          const available = t.ready - t.delivered;
          if (line.quantity > available) {
            const who = t.label ? `مقاس ${t.label}: ` : "";
            throw new AppError("VALIDATION_ERROR", undefined, {
              fieldErrors: {
                [line.sizeId ? sizeField(line.sizeId) : "quantity"]: [
                  available > 0 ? `${who}الجاهز اللي لسه متسلمش ${n(available, ctx.unit)} بس` : `${who}مفيش قطع جاهزة لسه متسلمتش`,
                ],
              },
            });
          }
          const row = await tx.delivery.create({
            data: {
              orderId: input.orderId,
              orderGroupId: g.id,
              orderGroupSizeId: line.sizeId,
              quantity: line.quantity,
              deliveredAt: dateFromString(input.deliveredAt),
              notes: input.notes,
              idempotencyKey: rowKey(input.idempotencyKey, line.sizeId),
              recordedById: actor.id,
            },
            select: { id: true },
          });
          bump(g, line.sizeId, (c) => {
            c.delivered += line.quantity;
          });
          await recordAudit(tx, {
            userId: actor.id,
            action: AUDIT_ACTIONS.DELIVERY_RECORDED,
            entityType: "Delivery",
            entityId: row.id,
            metadata: { orderId: input.orderId, orderGroupId: g.id, orderGroupSizeId: line.sizeId ?? null, size: t.label ?? null, quantity: line.quantity, deliveredAt: input.deliveredAt },
          });
          first ??= row;
        }
        await refreshOrderStatus(tx, actor, input.orderId);
        return first!;
      }),
  );
}

// ───────────────────────────── Owner corrections ─────────────────────────────

function parseVoid(payload: { id?: unknown; reason?: unknown }) {
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  return parsed.data;
}

/** Void "N pieces finished step X" — refused if ready pieces (of that size) depend on it. */
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
    const t = targetOf(g, rec.orderGroupSizeId ?? undefined);
    const after = (t.stage[rec.operation] ?? 0) - rec.quantity;
    if (after < t.ready) {
      const who = t.label ? ` (مقاس ${t.label})` : "";
      throw new AppError("CONFLICT", `مينفعش: اتسجل ${formatNumber(t.ready)} قطعة جاهزة${who}، و${OPERATION_LABELS[rec.operation]} هيبقى ${formatNumber(after)} بس. ألغِ سجل الجاهز الأول.`);
    }
    await tx.productionStageProgress.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PRODUCTION_STAGE_VOIDED,
      entityType: "ProductionStageProgress",
      entityId: id,
      metadata: { orderId: rec.orderId, operation: rec.operation, quantity: rec.quantity, size: t.label ?? null, reason },
    });
    await refreshOrderStatus(tx, actor, rec.orderId);
    return { orderId: rec.orderId };
  });
}

/** Void a "ready" record — refused if delivered pieces (of that size) depend on it. */
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
    const t = targetOf(g, rec.orderGroupSizeId ?? undefined);
    if (t.ready - rec.quantity < t.delivered) {
      const who = t.label ? ` (مقاس ${t.label})` : "";
      throw new AppError("CONFLICT", `مينفعش: اتسلم ${formatNumber(t.delivered)} قطعة${who}، والجاهز هيبقى ${formatNumber(t.ready - rec.quantity)} بس. ألغِ التسليم الأول لو كان غلط.`);
    }
    await tx.productionReady.update({ where: { id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PRODUCTION_READY_VOIDED,
      entityType: "ProductionReady",
      entityId: id,
      metadata: { orderId: rec.orderId, quantity: rec.quantity, size: t.label ?? null, reason },
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
    const rec = await tx.delivery.findUniqueOrThrow({ where: { id }, select: { orderId: true, quantity: true, orderGroupSize: { select: { label: true } } } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.DELIVERY_VOIDED,
      entityType: "Delivery",
      entityId: id,
      metadata: { orderId: rec.orderId, quantity: rec.quantity, size: rec.orderGroupSize?.label ?? null, reason },
    });
    await refreshOrderStatus(tx, actor, rec.orderId);
    return { orderId: rec.orderId };
  });
}

// ───────────────────────────── Read ─────────────────────────────

type HistoryBase = {
  id: string;
  date: string;
  groupPosition: number;
  sizeLabel: string | null;
  quantity: number;
  notes: string | null;
  recordedByName: string;
  createdAt: Date;
  voided: null | { byName: string; reason: string };
};

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
  const by = {
    recordedBy: { select: { name: true } },
    voidedBy: { select: { name: true } },
    orderGroup: { select: { position: true } },
    orderGroupSize: { select: { label: true } },
  } as const;
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
  const common = (
    r: {
      id: string;
      quantity: number;
      notes: string | null;
      createdAt: Date;
      voidedAt: Date | null;
      voidReason: string | null;
      recordedBy: { name: string };
      voidedBy: { name: string } | null;
      orderGroup: { position: number };
      orderGroupSize: { label: string } | null;
    },
    date: Date,
  ): HistoryBase => ({
    id: r.id,
    date: dateToString(date),
    groupPosition: r.orderGroup.position,
    sizeLabel: r.orderGroupSize?.label ?? null,
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
