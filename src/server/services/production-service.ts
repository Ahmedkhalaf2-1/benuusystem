import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OrderStatus, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, monthRange, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatNumber } from "@/lib/numbers";
import { describeOperations, designLabel, itemLabel, OPERATION_LABELS, PRINT_OPERATIONS, UNIT_LABELS } from "@/lib/orders/labels";
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
import { canAccessOrder, orderScopeSql } from "./order-access";
import { requireDepartment } from "./department-access";

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
  /** Pieces done per design (items with designs). */
  design: Record<string, number>;
  ready: number;
  delivered: number;
  /** Upper bound for "ready": the least-finished required step (or quantity). */
  maxReady: number;
};

export type SizeProgress = Counters & { id: string; label: string };

export type DesignInfo = {
  id: string;
  position: number;
  name: string | null;
  label: string;
  operation: PrintOperation;
  placements: string[];
  customPlacements: string[];
  /** Pieces of the item that need this design (≤ item quantity). */
  quantity: number;
  pressesPerUnit: number | null;
};

export type GroupProgress = Counters & {
  id: string;
  position: number;
  /** The item's department («القسم»). */
  departmentId: string | null;
  name: string | null;
  /** «اسم البند» or «البند N». */
  label: string;
  operations: PrintOperation[];
  description: string;
  /** Empty for items without designs (older items: progress per operation). */
  designs: DesignInfo[];
  /** Empty for groups without a size breakdown. */
  sizes: SizeProgress[];
  /**
   * Physical pieces already worked on: the most advanced single step, design,
   * ready or delivered count — never a sum of steps or designs (they are on
   * the same pieces).
   */
  worked: number;
};

/**
 * Most pieces that can be "ready" now.
 * - Item-level steps (older items): every required operation must be done.
 * - Designs: a design on every piece caps ready at its done count; a design on
 *   only part of the item caps the ITEM total at done + pieces that don't need
 *   it. Per size, only designs on every piece are known per size, so partial
 *   designs are enforced on the item total (checked separately) and the
 *   recorder must confirm the same pieces finished all their designs.
 */
function maxReadyOf(c: Pick<Counters, "quantity" | "stage" | "design">, g: { quantity: number; operations: PrintOperation[]; designs: DesignInfo[] }, isSize: boolean) {
  if (g.designs.length > 0) {
    const bounds = g.designs.map((d) => {
      const done = c.design[d.id] ?? 0;
      if (d.quantity >= g.quantity) return done;
      return isSize ? c.quantity : done + (c.quantity - d.quantity);
    });
    return Math.max(0, Math.min(c.quantity, ...bounds));
  }
  return g.operations.length === 0 ? c.quantity : Math.min(c.quantity, ...g.operations.map((op) => c.stage[op] ?? 0));
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
        name: true,
        departmentId: true,
        operations: { select: { operation: true } },
        sizes: { orderBy: { position: "asc" }, select: { id: true, label: true, quantity: true } },
        designs: {
          orderBy: { position: "asc" },
          select: { id: true, position: true, name: true, operation: true, placements: true, customPlacements: true, quantity: true, pressesPerUnit: true },
        },
      },
    }),
    db.productionStageProgress.groupBy({ by: ["orderGroupId", "orderGroupSizeId", "operation", "designId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.productionReady.groupBy({ by: ["orderGroupId", "orderGroupSizeId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
    db.delivery.groupBy({ by: ["orderGroupId", "orderGroupSizeId"], where: { orderId, voidedAt: null }, _sum: { quantity: true } }),
  ]);
  return groups.map((g) => {
    const operations = PRINT_OPERATIONS.filter((op) => g.operations.some((o) => o.operation === op));
    const designs: DesignInfo[] = g.designs.map((d) => ({ ...d, label: designLabel(d.position, d.name) }));
    const shape = { quantity: g.quantity, operations, designs };
    const counters = (quantity: number, isSize: boolean, match: (row: { orderGroupId: string; orderGroupSizeId: string | null }) => boolean): Counters => {
      const stage: Counters["stage"] = {};
      const design: Counters["design"] = {};
      for (const op of operations) stage[op] = 0;
      for (const d of designs) design[d.id] = 0;
      for (const s of stages) {
        if (!match(s)) continue;
        stage[s.operation] = (stage[s.operation] ?? 0) + (s._sum.quantity ?? 0);
        if (s.designId) design[s.designId] = (design[s.designId] ?? 0) + (s._sum.quantity ?? 0);
      }
      const r = ready.filter(match).reduce((sum, x) => sum + (x._sum.quantity ?? 0), 0);
      const d = delivered.filter(match).reduce((sum, x) => sum + (x._sum.quantity ?? 0), 0);
      const c = { quantity, stage, design, ready: r, delivered: d, maxReady: 0 };
      c.maxReady = maxReadyOf(c, shape, isSize);
      return c;
    };
    const whole = counters(g.quantity, false, (row) => row.orderGroupId === g.id);
    const steps = designs.length > 0 ? Object.values(whole.design) : Object.values(whole.stage).map((v) => v ?? 0);
    return {
      id: g.id,
      position: g.position,
      departmentId: g.departmentId,
      name: g.name,
      label: itemLabel(g.position, g.name),
      operations,
      description: describeOperations(operations),
      designs,
      ...whole,
      worked: Math.max(whole.ready, whole.delivered, 0, ...steps),
      sizes: g.sizes.map((size) => ({
        id: size.id,
        label: size.label,
        ...counters(size.quantity, true, (row) => row.orderGroupId === g.id && row.orderGroupSizeId === size.id),
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
/**
 * Locks the order, then checks the actor may see it — under the same lock that
 * visibility changes take, so a revoked assignment can't race a write. A hidden
 * order is reported exactly like a missing one (nothing about it leaks).
 */
/**
 * A write made from a DEPARTMENT view («شغل القسم»): authorized by department
 * membership (with «تسجيل إنتاج» switched on) instead of order permissions,
 * and limited to that department's items.
 */
export type DepartmentWriteScope = { departmentId: string };

type WriteCtx = { unit: QuantityUnit; groups: GroupProgress[]; auditMeta?: Record<string, unknown> };

async function openOrderForWrite(tx: DbTransaction, actor: Actor, orderId: string, scope?: DepartmentWriteScope): Promise<WriteCtx> {
  if (scope) {
    // Re-checked under the order lock, so a revoked membership can't race a write.
    if (!(await lockOrder(tx, orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    const grant = await requireDepartment(tx, actor, scope.departmentId, "record");
    const order = await tx.order.findFirst({
      where: { id: orderId, archivedAt: null, ...(grant.includeHidden ? {} : { hiddenFromDepartments: false }), groups: { some: { departmentId: scope.departmentId } } },
      select: { status: true, unit: true },
    });
    if (!order) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    if (order.status === "CANCELLED") throw new AppError("CONFLICT", "الأوردر ده ملغي ومينفعش يتسجل عليه إنتاج");
    // Only the department's own items are writable (others look like they don't exist).
    const groups = (await loadGroupProgress(tx, orderId)).filter((g) => g.departmentId === scope.departmentId);
    return { unit: order.unit, groups, auditMeta: { departmentId: scope.departmentId, via: "department" } };
  }
  if (!(await lockOrder(tx, orderId)) || !(await canAccessOrder(tx, actor, orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, unit: true } });
  if (order.status === "CANCELLED") throw new AppError("CONFLICT", "الأوردر ده ملغي ومينفعش يتسجل عليه إنتاج أو تسليم");
  return { unit: order.unit, groups: await loadGroupProgress(tx, orderId) };
}

function findGroup(groups: GroupProgress[], groupId: string) {
  const g = groups.find((x) => x.id === groupId);
  if (!g) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { orderGroupId: ["البند ده مش تبع الأوردر ده"] } });
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
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [quantityField]: ["البند ده من غير مقاسات — اكتب العدد بس"] } });
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
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { sizes: ["في مقاس مش تبع البند ده — افتح الصفحة من جديد"] } });
    }
    seen.add(l.sizeId);
  }
  return lines.map((l) => ({ sizeId: l.sizeId, quantity: l.quantity }));
}

/** The counters a line is checked against: its size, or the whole (unsized) group. */
function targetOf(g: GroupProgress, sizeId?: string): Counters & { label?: string } {
  // `label` here means the SIZE label (for messages); the whole item has none.
  return sizeId ? g.sizes.find((s) => s.id === sizeId)! : { ...g, label: undefined };
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
  g.maxReady = maxReadyOf(g, g, false);
  if (sizeId) {
    const s = g.sizes.find((x) => x.id === sizeId)!;
    apply(s);
    s.maxReady = maxReadyOf(s, g, true);
  }
}

/**
 * Inserts "N pieces (of one size) finished step X" after checking it against
 * the group/size. Caller must hold the order lock (openOrderForWrite) and refresh status.
 */
export async function insertStageProgress(
  tx: DbTransaction,
  actor: Actor,
  ctx: WriteCtx,
  input: { orderId: string; orderGroupId: string; orderGroupSizeId?: string; designId?: string; operation: PrintOperation; quantity: number; workDate: string; notes?: string; idempotencyKey: string; workLogId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  if (!g.operations.includes(input.operation)) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { operation: [`البند ده مش محتاج ${OPERATION_LABELS[input.operation]}`] },
    });
  }
  const t = targetOf(g, input.orderGroupSizeId);

  // Items with designs: work is recorded per design (two designs may share an
  // operation, e.g. chest DTF + back DTF on the same pieces).
  const design = g.designs.length > 0 ? g.designs.find((d) => d.id === input.designId) : undefined;
  if (g.designs.length > 0 && !design) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { designId: ["اختار الرسمة اللي اتعملت"] } });
  }
  if (g.designs.length === 0 && input.designId) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { designId: ["البند ده من غير رسومات"] } });
  }
  if (design && design.operation !== input.operation) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { operation: [`${design.label} شغلها ${OPERATION_LABELS[design.operation]}`] } });
  }
  if (design) {
    const who = t.label ? `مقاس ${t.label}: ` : "";
    const doneHere = t.design[design.id] ?? 0;
    const doneAll = g.design[design.id] ?? 0;
    // Per size: no more than the size; overall: no more than the design's pieces.
    const capHere = input.orderGroupSizeId ? Math.min(t.quantity, design.quantity) : design.quantity;
    if (doneHere + input.quantity > capHere || doneAll + input.quantity > design.quantity) {
      const left = Math.max(0, Math.min(capHere - doneHere, design.quantity - doneAll));
      throw new AppError("VALIDATION_ERROR", undefined, {
        fieldErrors: {
          [input.orderGroupSizeId ? sizeField(input.orderGroupSizeId) : "quantity"]: [
            `${who}${design.label} فاضل فيها ${n(left, ctx.unit)} بس (اتعمل ${n(doneAll, ctx.unit)} من ${n(design.quantity, ctx.unit)})`,
          ],
        },
      });
    }
  }
  const done = t.stage[input.operation] ?? 0;
  if (!design && done + input.quantity > t.quantity) {
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
      designId: design?.id,
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
    if (design) c.design[design.id] = (c.design[design.id] ?? 0) + input.quantity;
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
      designId: design?.id ?? null,
      quantity: input.quantity,
      workLogId: input.workLogId ?? null,
      ...ctx.auditMeta,
    },
  });
  return row;
}

async function insertReady(
  tx: DbTransaction,
  actor: Actor,
  ctx: WriteCtx,
  input: { orderId: string; orderGroupId: string; orderGroupSizeId?: string; quantity: number; readyDate: string; notes?: string; idempotencyKey: string; stageProgressId?: string },
) {
  const g = findGroup(ctx.groups, input.orderGroupId);
  const t = targetOf(g, input.orderGroupSizeId);
  // Designs on only part of a sized item are enforced on the item total.
  if (input.orderGroupSizeId && g.designs.length > 0 && g.ready + input.quantity > g.maxReady) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: {
        [sizeField(input.orderGroupSizeId)]: [`أقصى عدد ممكن يبقى جاهز في البند كله دلوقتي ${n(Math.max(0, g.maxReady - g.ready), ctx.unit)} — حسب الرسومات اللي خلصت.`],
      },
    });
  }
  if (t.ready + input.quantity > t.maxReady) {
    const who = t.label ? `مقاس ${t.label}: ` : "";
    const msg =
      g.operations.length === 0 && g.designs.length === 0
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
    metadata: { orderId: input.orderId, orderGroupId: input.orderGroupId, orderGroupSizeId: input.orderGroupSizeId ?? null, size: t.label ?? null, quantity: input.quantity, ...ctx.auditMeta },
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
  const ctx = await openOrderForWrite(tx, actor, input.orderId);
  const g = findGroup(ctx.groups, input.orderGroupId);
  if (g.sizes.length > 0) {
    throw new AppError("VALIDATION_ERROR", undefined, {
      fieldErrors: { quantity: ["البند ده بمقاسات — سجّل القطع بالمقاسات من صفحة الأوردر («تسجيل إنتاج»)."] },
    });
  }
  // Items with designs: only when exactly one design has this operation is it
  // clear which design the worker did; otherwise record it from the order page.
  let designId: string | undefined;
  if (g.designs.length > 0) {
    const matching = g.designs.filter((d) => d.operation === input.operation);
    if (matching.length !== 1) {
      throw new AppError("VALIDATION_ERROR", undefined, {
        fieldErrors: { quantity: [`البند ده فيه ${matching.length === 0 ? "مفيش" : "أكتر من"} رسمة ${OPERATION_LABELS[input.operation]} — سجّل الإنتاج لكل رسمة من صفحة الأوردر.`] },
      });
    }
    designId = matching[0]!.id;
  }
  const row = await insertStageProgress(tx, actor, ctx, { ...input, designId, idempotencyKey: randomUUID() });
  await refreshOrderStatus(tx, actor, input.orderId);
  return row;
}

/**
 * "تسجيل إنتاج" for one step; single-step groups may mark the same pieces ready.
 * With `scope`, it is a department member's write (membership-authorized,
 * that department's items only).
 */
export async function recordStageProgress(db: PrismaClient, actor: Actor, payload: RecordStagePayload, scope?: DepartmentWriteScope): Promise<Created> {
  if (scope) await requireDepartment(db, actor, scope.departmentId, "record");
  else assertPermission(actor, "production:record");
  const parsed = recordStageSchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.productionStageProgress.findFirst({ where: { idempotencyKey: firstRowKey(input), ...(scope ? { orderGroupId: input.orderGroupId, orderGroup: { departmentId: scope.departmentId } } : {}) }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, actor, input.orderId, scope);
        const twin = await tx.productionStageProgress.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } });
        if (twin) return { id: twin.id, replayed: true };
        const g = findGroup(ctx.groups, input.orderGroupId);
        const singleStep = g.designs.length > 0 ? g.designs.length === 1 && g.designs[0]!.quantity >= g.quantity : g.operations.length === 1;
        if (input.alsoReady && !singleStep) {
          throw new AppError("VALIDATION_ERROR", "البند ده فيه أكتر من مرحلة أو رسمة. أكّد الجاهز من «جاهز للتسليم» لما القطع تخلص كل الشغل.");
        }
        let first: { id: string } | null = null;
        for (const line of linesFor(g, input)) {
          const stage = await insertStageProgress(tx, actor, ctx, {
            orderId: input.orderId,
            orderGroupId: g.id,
            orderGroupSizeId: line.sizeId,
            designId: input.designId,
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

/** "جاهز للتسليم": pieces that finished every required step of their group (per size when sized). `scope`: see recordStageProgress. */
export async function recordReady(db: PrismaClient, actor: Actor, payload: RecordReadyPayload, scope?: DepartmentWriteScope): Promise<Created> {
  if (scope) await requireDepartment(db, actor, scope.departmentId, "record");
  else assertPermission(actor, "production:record");
  const parsed = recordReadySchema.safeParse(payload);
  if (!parsed.success) invalid(parsed.error);
  const input = parsed.data;

  return idempotent(
    () => db.productionReady.findFirst({ where: { idempotencyKey: firstRowKey(input), ...(scope ? { orderGroupId: input.orderGroupId, orderGroup: { departmentId: scope.departmentId } } : {}) }, select: { id: true } }),
    () =>
      db.$transaction(async (tx) => {
        const ctx = await openOrderForWrite(tx, actor, input.orderId, scope);
        const twin = await tx.productionReady.findUnique({ where: { idempotencyKey: firstRowKey(input) }, select: { id: true } });
        if (twin) return { id: twin.id, replayed: true };
        const g = findGroup(ctx.groups, input.orderGroupId);
        // Several steps or designs (or a design on only some pieces): the
        // recorder confirms these exact pieces finished everything they need.
        const needsConfirm = g.designs.length > 0 ? g.designs.length > 1 || g.designs.some((d) => d.quantity < g.quantity) : g.operations.length > 1;
        if (needsConfirm && !input.confirmAllOperations) {
          const what = g.designs.length > 0 ? g.designs.map((d) => d.label).join(" + ") : g.description;
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: { confirmAllOperations: [`أكّد إن نفس القطع خلصت كل الشغل المطلوب لها (${what})`] },
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
        const ctx = await openOrderForWrite(tx, actor, input.orderId);
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
  /** «اسم البند» or «البند N». */
  groupLabel: string;
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
  stageHistory: (HistoryBase & { operation: PrintOperation; fromWorker: string | null; designLabel: string | null })[];
  readyHistory: HistoryBase[];
  deliveryHistory: HistoryBase[];
};

/**
 * Production view of one order. Needs "production:view" or "deliveries:view"
 * plus access to the order. Totals (physical pieces) come with either; the
 * step/ready history needs production:view and the delivery history needs
 * deliveries:view — the other history is not even queried.
 */
export async function getOrderProduction(db: DbClient, actor: Actor, orderId: string): Promise<OrderProduction | null> {
  const seeProduction = hasPermission(actor, "production:view");
  const seeDeliveries = hasPermission(actor, "deliveries:view");
  if (!seeProduction && !seeDeliveries) assertPermission(actor, "production:view");
  if (!(await canAccessOrder(db, actor, orderId, { includeArchived: true }))) return null;
  const order = await db.order.findUnique({ where: { id: orderId }, select: { unit: true } });
  if (!order) return null;
  const by = {
    recordedBy: { select: { name: true } },
    voidedBy: { select: { name: true } },
    orderGroup: { select: { position: true, name: true } },
    orderGroupSize: { select: { label: true } },
  } as const;
  const [groups, stages, ready, deliveries] = await Promise.all([
    loadGroupProgress(db, orderId),
    db.productionStageProgress.findMany({
      where: seeProduction ? { orderId } : { orderId, id: { in: [] } },
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      include: { ...by, workLog: { select: { worker: { select: { name: true } } } }, design: { select: { position: true, name: true } } },
    }),
    db.productionReady.findMany({ where: seeProduction ? { orderId } : { orderId, id: { in: [] } }, orderBy: [{ readyDate: "desc" }, { createdAt: "desc" }], include: by }),
    db.delivery.findMany({ where: seeDeliveries ? { orderId } : { orderId, id: { in: [] } }, orderBy: [{ deliveredAt: "desc" }, { createdAt: "desc" }], include: by }),
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
      orderGroup: { position: number; name: string | null };
      orderGroupSize: { label: string } | null;
    },
    date: Date,
  ): HistoryBase => ({
    id: r.id,
    date: dateToString(date),
    groupPosition: r.orderGroup.position,
    groupLabel: itemLabel(r.orderGroup.position, r.orderGroup.name),
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
    stageHistory: stages.map((s) => ({
      ...common(s, s.workDate),
      operation: s.operation,
      fromWorker: s.workLog?.worker.name ?? null,
      designLabel: s.design ? designLabel(s.design.position, s.design.name) : null,
    })),
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
/** Production numbers for the dashboard, over the orders the actor may see only. */
export async function getProductionDashboard(db: DbClient, actor: Actor) {
  assertPermission(actor, "orders:view");
  const scope = orderScopeSql(actor, "o");
  const today = todayDateString();
  const month = monthRange(today);
  const [completed, deliveriesToday, deliveredByUnit] = await Promise.all([
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders o
      WHERE o.status = 'COMPLETED' AND ${scope}
        AND (o.completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN ${month.from}::date AND ${month.to}::date`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.voided_at IS NULL AND d.delivered_at = ${today}::date AND ${scope}`,
    db.$queryRaw<{ unit: QuantityUnit; qty: number }[]>`
      SELECT o.unit AS unit, SUM(d.quantity)::int AS qty
      FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.voided_at IS NULL AND d.delivered_at BETWEEN ${month.from}::date AND ${month.to}::date AND ${scope}
      GROUP BY o.unit ORDER BY o.unit`,
  ]);
  return { completedThisMonth: completed[0]?.n ?? 0, deliveriesToday: deliveriesToday[0]?.n ?? 0, deliveredThisMonth: deliveredByUnit };
}
