import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OrderStatus, PaymentMethod, PrintOperation, QuantityUnit, WorkUnit } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import { normalizeDigits } from "@/lib/numbers";
import { OPEN_ORDER_STATUSES, OPERATION_LABELS, describeOperations } from "@/lib/orders/labels";
import {
  createOrderSchema,
  updateOrderSchema,
  type CreateOrderInput,
  type CreateOrderPayload,
  type UpdateOrderInput,
  type UpdateOrderPayload,
} from "@/lib/validations/order";
import { toFieldErrors } from "@/lib/validations/utils";
import {
  lockOrder,
  nextOrderNumber,
  paidByOrderIds,
  sumValidPayments,
} from "@/server/repositories/order-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { insertCustomer } from "./customer-service";
import { loadGroupProgress, productionTotalsByOrder, refreshOrderStatus } from "./production-service";
import { ORDER_SUMMARY_SELECT, isOverdue, toOrderSummary, type OrderSummary } from "./order-dto";

// ───────────────────────────── Create ─────────────────────────────

export type CreateOrderResult = { orderId: string; number: number; created: boolean };

export function parseCreateOrder(payload: CreateOrderPayload): CreateOrderInput {
  const parsed = createOrderSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "راجع البيانات المكتوبة", {
      fieldErrors: toFieldErrors(parsed.error),
    });
  }
  return parsed.data;
}

async function findByIdempotencyKey(db: DbClient, key: string): Promise<CreateOrderResult | null> {
  const existing = await db.order.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, number: true },
  });
  return existing ? { orderId: existing.id, number: existing.number, created: false } : null;
}

async function resolveCustomerId(
  tx: DbTransaction,
  actor: Actor,
  choice: CreateOrderInput["customer"],
): Promise<string> {
  if (choice.mode === "new") {
    assertPermission(actor, "customers:manage");
    const customer = await insertCustomer(tx, actor, { name: choice.name, phone: choice.phone, notes: undefined });
    return customer.id;
  }
  const exists = await tx.customer.findUnique({ where: { id: choice.id }, select: { id: true } });
  if (!exists) {
    throw new AppError("VALIDATION_ERROR", "العميل ده مش موجود", {
      fieldErrors: { customer: ["العميل ده مش موجود، اختاره تاني"] },
    });
  }
  return choice.id;
}

function groupsCreateData(groups: CreateOrderInput["groups"]) {
  return groups.map((group, index) => ({
    position: index + 1,
    quantity: group.quantity,
    material: group.material,
    notes: group.notes,
    operations: { create: group.operations.map((operation) => ({ operation })) },
    sizes: { create: group.sizes.map((size, i) => ({ label: size.label, quantity: size.quantity, position: i + 1 })) },
  }));
}

/**
 * Applies an edited size breakdown to an existing group IN PLACE (matched by
 * label, so "M" keeps its identity when its quantity changes). Refuses edits
 * that would rewrite history: splitting a group into sizes after unsized
 * production/deliveries exist, removing a size with records, or cutting a size
 * below what was already produced or made ready for it.
 */
async function applySizeChanges(
  tx: DbTransaction,
  groupId: string,
  index: number,
  sizes: UpdateOrderInput["groups"][number]["sizes"],
) {
  const fail = (message: string): never => {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [`groups.${index}.sizes`]: [message] } });
  };
  const current = await tx.orderGroupSize.findMany({ where: { orderGroupId: groupId }, select: { id: true, label: true } });
  const anyWhere = { orderGroupId: groupId };
  const [unsizedStage, unsizedReady, unsizedDelivered] = await Promise.all([
    tx.productionStageProgress.count({ where: { ...anyWhere, orderGroupSizeId: null } }),
    tx.productionReady.count({ where: { ...anyWhere, orderGroupSizeId: null } }),
    tx.delivery.count({ where: { ...anyWhere, orderGroupSizeId: null } }),
  ]);
  if (sizes.length > 0 && current.length === 0 && unsizedStage + unsizedReady + unsizedDelivered > 0) {
    fail("المجموعة دي اتسجل عليها إنتاج أو تسليم من غير مقاسات، فمينفعش نقسّمها على مقاسات دلوقتي (مش هنخترع أرقام قديمة).");
  }

  // Sizes referenced by any record (voided too: their rows still point here).
  const referenced = new Set(
    (
      await Promise.all([
        tx.productionStageProgress.findMany({ where: { ...anyWhere, orderGroupSizeId: { not: null } }, select: { orderGroupSizeId: true }, distinct: ["orderGroupSizeId"] }),
        tx.productionReady.findMany({ where: { ...anyWhere, orderGroupSizeId: { not: null } }, select: { orderGroupSizeId: true }, distinct: ["orderGroupSizeId"] }),
        tx.delivery.findMany({ where: { ...anyWhere, orderGroupSizeId: { not: null } }, select: { orderGroupSizeId: true }, distinct: ["orderGroupSizeId"] }),
      ])
    )
      .flat()
      .map((r) => r.orderGroupSizeId!),
  );
  // Already produced per size: the most any one step or "ready" reached.
  const [stageRows, readyRows] = await Promise.all([
    tx.productionStageProgress.groupBy({ by: ["orderGroupSizeId", "operation"], where: { ...anyWhere, voidedAt: null, orderGroupSizeId: { not: null } }, _sum: { quantity: true } }),
    tx.productionReady.groupBy({ by: ["orderGroupSizeId"], where: { ...anyWhere, voidedAt: null, orderGroupSizeId: { not: null } }, _sum: { quantity: true } }),
  ]);
  const produced = new Map<string, number>();
  for (const row of [...stageRows, ...readyRows]) {
    const id = row.orderGroupSizeId!;
    produced.set(id, Math.max(produced.get(id) ?? 0, row._sum.quantity ?? 0));
  }

  const byLabel = new Map(current.map((c) => [c.label, c]));
  const keptLabels = new Set(sizes.map((x) => x.label));
  for (const old of current) {
    if (!keptLabels.has(old.label) && referenced.has(old.id)) {
      fail(`المقاس ${old.label} عليه إنتاج أو تسليم متسجل ومينفعش يتشال.`);
    }
  }
  for (const size of sizes) {
    const existing = byLabel.get(size.label);
    const done = existing ? (produced.get(existing.id) ?? 0) : 0;
    if (size.quantity < done) fail(`المقاس ${size.label} اتعمل منه ${done} بالفعل — الكمية مينفعش تقل عن كده.`);
  }

  const removed = current.filter((c) => !keptLabels.has(c.label));
  if (removed.length > 0) await tx.orderGroupSize.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
  for (const [i, size] of sizes.entries()) {
    const existing = byLabel.get(size.label);
    if (existing) {
      await tx.orderGroupSize.update({ where: { id: existing.id }, data: { quantity: size.quantity, position: i + 1 } });
    } else {
      await tx.orderGroupSize.create({ data: { orderGroupId: groupId, label: size.label, quantity: size.quantity, position: i + 1 } });
    }
  }
}

/**
 * Creates an order with its groups, an optional inline new customer and the
 * advance payment — all in ONE transaction. Safe to retry: the same
 * idempotency key always returns the same order instead of a duplicate.
 */
export async function createOrder(
  db: PrismaClient,
  actor: Actor,
  payload: CreateOrderPayload,
): Promise<CreateOrderResult> {
  assertPermission(actor, "orders:create");
  const input = parseCreateOrder(payload);

  const previous = await findByIdempotencyKey(db, input.idempotencyKey);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      const customerId = await resolveCustomerId(tx, actor, input.customer);
      const number = await nextOrderNumber(tx);

      const order = await tx.order.create({
        data: {
          number,
          customerId,
          title: input.title,
          productType: input.productType,
          material: input.material,
          quantity: input.quantity,
          unit: input.unit,
          totalPrice: centsToDecimalString(input.totalPrice),
          receivedDate: dateFromString(input.receivedDate),
          deliveryDate: dateFromString(input.deliveryDate),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: actor.id,
          groups: { create: groupsCreateData(input.groups) },
        },
        select: { id: true, number: true },
      });

      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.ORDER_CREATED,
        entityType: "Order",
        entityId: order.id,
        metadata: {
          number: order.number,
          customerId,
          quantity: input.quantity,
          totalPrice: centsToDecimalString(input.totalPrice),
          groups: input.groups.map((g) => ({ quantity: g.quantity, operations: g.operations })),
        },
      });

      if (input.advance > 0n) {
        const payment = await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: centsToDecimalString(input.advance),
            paidAt: dateFromString(input.receivedDate),
            method: input.advanceMethod,
            isAdvance: true,
            idempotencyKey: randomUUID(),
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
            orderId: order.id,
            amount: centsToDecimalString(input.advance),
            method: input.advanceMethod,
            advance: true,
          },
        });
      }

      return { orderId: order.id, number: order.number, created: true };
    });
  } catch (error) {
    // Two identical submits raced: the loser returns the winner's order.
    if (isUniqueViolation(error)) {
      const winner = await findByIdempotencyKey(db, input.idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

// ───────────────────────────── Update ─────────────────────────────

export function parseUpdateOrder(payload: UpdateOrderPayload): UpdateOrderInput {
  const parsed = updateOrderSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "راجع البيانات المكتوبة", {
      fieldErrors: toFieldErrors(parsed.error),
    });
  }
  return parsed.data;
}

type GroupSnapshot = { id: string | null; quantity: number; material: string; notes: string | null; operations: PrintOperation[]; sizes: string[] };

function snapshotGroups(
  groups: { id?: string | null; quantity: number; material: string; notes?: string | null; operations: PrintOperation[]; sizes?: { label: string; quantity: number }[] }[],
): GroupSnapshot[] {
  return groups.map((g) => ({
    id: g.id ?? null,
    quantity: g.quantity,
    material: g.material,
    notes: g.notes ?? null,
    operations: [...g.operations].sort(),
    sizes: (g.sizes ?? []).map((x) => `${x.label}:${x.quantity}`),
  }));
}

/** Order units that a worker-log unit can be compared with (same physical thing). */
const COMPARABLE_UNITS: Partial<Record<QuantityUnit, WorkUnit>> = { PIECE: "PIECE", METER: "METER" };

/**
 * Pieces of a group already worked on: for each kind of work, the logged
 * quantity in the order's own unit; the largest of those (cutting, sewing… each
 * handle the same pieces, so they are not added together).
 */
async function committedQuantities(tx: DbTransaction, groupIds: string[], orderUnit: QuantityUnit) {
  const unit = COMPARABLE_UNITS[orderUnit];
  const result = new Map<string, number>();
  if (!unit || groupIds.length === 0) return result;
  const rows = await tx.workerWorkLog.groupBy({
    by: ["orderGroupId", "workType"],
    where: { orderGroupId: { in: groupIds }, voidedAt: null, unit },
    _sum: { quantity: true },
  });
  for (const row of rows) {
    const id = row.orderGroupId!;
    result.set(id, Math.max(result.get(id) ?? 0, row._sum.quantity ?? 0));
  }
  return result;
}

type ExistingGroup = { id: string; position: number; quantity: number };

/**
 * Applies edited groups IN PLACE: existing ids are updated (so worker logs and
 * future production records keep pointing at them), new ones created, removed
 * ones deleted only if nothing references them.
 */
async function applyGroupChanges(
  tx: DbTransaction,
  orderId: string,
  orderUnit: QuantityUnit,
  existing: ExistingGroup[],
  groups: UpdateOrderInput["groups"],
) {
  const byId = new Map(existing.map((g) => [g.id, g]));
  const keptIds = new Set<string>();
  groups.forEach((g, index) => {
    if (!g.id) return;
    if (!byId.has(g.id) || keptIds.has(g.id)) {
      throw new AppError("VALIDATION_ERROR", undefined, {
        fieldErrors: { [`groups.${index}`]: ["المجموعة دي مش تبع الأوردر ده. افتح صفحة التعديل من جديد."] },
      });
    }
    keptIds.add(g.id);
  });

  const removed = existing.filter((g) => !keptIds.has(g.id));
  if (removed.length > 0) {
    const ids = removed.map((g) => g.id);
    const [logs, stages, ready, deliveries] = await Promise.all([
      tx.workerWorkLog.findMany({ where: { orderGroupId: { in: ids } }, select: { orderGroupId: true }, distinct: ["orderGroupId"] }),
      tx.productionStageProgress.findMany({ where: { orderGroupId: { in: ids } }, select: { orderGroupId: true }, distinct: ["orderGroupId"] }),
      tx.productionReady.findMany({ where: { orderGroupId: { in: ids } }, select: { orderGroupId: true }, distinct: ["orderGroupId"] }),
      tx.delivery.findMany({ where: { orderGroupId: { in: ids } }, select: { orderGroupId: true }, distinct: ["orderGroupId"] }),
    ]);
    const referenced = new Set([...logs, ...stages, ...ready, ...deliveries].map((r) => r.orderGroupId));
    if (referenced.size > 0) {
      const positions = removed.filter((g) => referenced.has(g.id)).map((g) => g.position);
      throw new AppError("CONFLICT", `مجموعة ${positions.join("، ")} عليها شغل أو إنتاج أو تسليم متسجل ومينفعش تتشال.`);
    }
  }

  const committed = await committedQuantities(tx, [...keptIds], orderUnit);
  const production = new Map((await loadGroupProgress(tx, orderId)).map((g) => [g.id, g]));
  groups.forEach((g, index) => {
    const p = g.id ? production.get(g.id) : undefined;
    const produced = p ? Math.max(p.ready, ...Object.values(p.stage).map((v) => v ?? 0)) : 0;
    const done = Math.max(g.id ? (committed.get(g.id) ?? 0) : 0, produced);
    if (g.quantity < done) {
      throw new AppError("VALIDATION_ERROR", undefined, {
        fieldErrors: { [`groups.${index}.quantity`]: [`الكمية مينفعش تقل عن اللي اتشغل فعلًا (${done})`] },
      });
    }
  });

  // Park kept groups on temporary positions so reordering never collides
  // with the (order_id, position) unique index.
  for (const g of existing.filter((x) => keptIds.has(x.id))) {
    await tx.orderGroup.update({ where: { id: g.id }, data: { position: g.position + 1000 } });
  }
  if (removed.length > 0) {
    await tx.orderGroup.deleteMany({ where: { id: { in: removed.map((g) => g.id) } } });
  }
  for (const [index, g] of groups.entries()) {
    const data = { position: index + 1, quantity: g.quantity, material: g.material, notes: g.notes ?? null };
    if (g.id) {
      await tx.orderGroup.update({ where: { id: g.id }, data });
      // Change only what changed, so steps with recorded progress keep their rows.
      const current = (await tx.orderGroupOperation.findMany({ where: { groupId: g.id }, select: { operation: true } })).map((o) => o.operation);
      const toRemove = current.filter((op) => !g.operations.includes(op));
      const toAdd = g.operations.filter((op) => !current.includes(op));
      if (toRemove.length > 0) {
        const used = await tx.productionStageProgress.findMany({
          where: { orderGroupId: g.id, operation: { in: toRemove } },
          select: { operation: true },
          distinct: ["operation"],
        });
        if (used.length > 0) {
          throw new AppError("VALIDATION_ERROR", undefined, {
            fieldErrors: {
              [`groups.${index}.operations`]: [`مينفعش تشيل ${used.map((u) => OPERATION_LABELS[u.operation]).join(" و")} — اتسجل فيها إنتاج.`],
            },
          });
        }
        await tx.orderGroupOperation.deleteMany({ where: { groupId: g.id, operation: { in: toRemove } } });
      }
      if (toAdd.length > 0) {
        await tx.orderGroupOperation.createMany({ data: toAdd.map((operation) => ({ groupId: g.id!, operation })) });
      }
      await applySizeChanges(tx, g.id, index, g.sizes);
    } else {
      await tx.orderGroup.create({
        data: {
          ...data,
          orderId,
          operations: { create: g.operations.map((operation) => ({ operation })) },
          sizes: { create: g.sizes.map((size, i) => ({ label: size.label, quantity: size.quantity, position: i + 1 })) },
        },
      });
    }
  }
}

/**
 * Edits an order. Rules:
 *  - changing the agreed price needs `orders:edit-price` (owner) and cannot go
 *    below what was already paid;
 *  - cancelling / re-opening needs `orders:cancel` (owner); an order with valid
 *    payments cannot be cancelled (void the payments first, so money is traced);
 *  - "completed" is not settable until delivery tracking exists.
 * Every change is audited with before/after values.
 */
export async function updateOrder(db: PrismaClient, actor: Actor, payload: UpdateOrderPayload) {
  assertPermission(actor, "orders:edit");
  const input = parseUpdateOrder(payload);

  return db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");

    const before = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      select: {
        id: true,
        number: true,
        customerId: true,
        title: true,
        productType: true,
        material: true,
        quantity: true,
        unit: true,
        totalPrice: true,
        receivedDate: true,
        deliveryDate: true,
        notes: true,
        status: true,
        updatedAt: true,
        groups: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            quantity: true,
            material: true,
            notes: true,
            operations: { select: { operation: true } },
            sizes: { orderBy: { position: "asc" }, select: { id: true, label: true, quantity: true } },
          },
        },
      },
    });

    // Someone saved this order after the edit screen was opened: don't overwrite their changes.
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
      throw new AppError("CONFLICT", "الأوردر اتعدّل من حد تاني بعد ما فتحت الصفحة. افتح صفحة التعديل من جديد عشان تشوف آخر نسخة.");
    }

    if (before.status === "COMPLETED") {
      throw new AppError("CONFLICT", "الأوردر ده مكتمل ومينفعش يتعدل");
    }

    const paid = await sumValidPayments(tx, input.orderId);
    const oldPrice = toCents(before.totalPrice);
    const priceChanged = oldPrice !== input.totalPrice;
    if (priceChanged) {
      if (!hasPermission(actor, "orders:edit-price")) {
        throw new AppError("FORBIDDEN", "تعديل سعر الأوردر للمدير بس");
      }
      if (input.totalPrice < paid) {
        throw new AppError("VALIDATION_ERROR", undefined, {
          fieldErrors: { totalPrice: [`السعر مينفعش يقل عن المدفوع (${formatMoney(paid)})`] },
        });
      }
    }

    // Production already recorded on this order?
    const progress = await loadGroupProgress(tx, input.orderId);
    const hasProduction =
      progress.some((g) => g.ready > 0 || g.delivered > 0 || Object.values(g.stage).some((v) => (v ?? 0) > 0)) ||
      (await tx.productionStageProgress.count({ where: { orderId: input.orderId } })) > 0;
    if (hasProduction && input.unit !== before.unit) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { unit: ["مينفعش تغيّر الوحدة بعد ما الإنتاج بدأ"] } });
    }
    if (hasProduction && input.status === "NEW" && before.status !== "NEW") {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { status: ["الأوردر بدأ إنتاجه — مينفعش يرجع «جديد»"] } });
    }
    if (input.status === "CANCELLED" && before.status !== "CANCELLED" && progress.some((g) => g.ready > 0 || g.delivered > 0 || Object.values(g.stage).some((v) => (v ?? 0) > 0))) {
      throw new AppError("CONFLICT", "الأوردر عليه إنتاج أو تسليم متسجل. المدير يلغي السجلات دي الأول (بسبب) قبل إلغاء الأوردر.");
    }

    const statusChanged = before.status !== input.status;
    if (statusChanged && (input.status === "CANCELLED" || before.status === "CANCELLED")) {
      if (!hasPermission(actor, "orders:cancel")) {
        throw new AppError("FORBIDDEN", "إلغاء الأوردر أو إرجاعه للمدير بس");
      }
      if (input.status === "CANCELLED" && paid > 0n) {
        throw new AppError("CONFLICT", "الأوردر عليه مدفوعات. ألغِ الدفعات الأول قبل إلغاء الأوردر.");
      }
    }

    const customerId = await resolveCustomerId(tx, actor, input.customer);

    const beforeGroups = snapshotGroups(
      before.groups.map((g) => ({ ...g, operations: g.operations.map((o) => o.operation) })),
    );
    const afterGroups = snapshotGroups(input.groups);
    const groupsChanged = JSON.stringify(beforeGroups) !== JSON.stringify(afterGroups);

    const scalarBefore = {
      customerId: before.customerId,
      title: before.title,
      productType: before.productType,
      material: before.material,
      quantity: before.quantity,
      unit: before.unit,
      receivedDate: dateToString(before.receivedDate),
      deliveryDate: dateToString(before.deliveryDate),
      notes: before.notes,
    };
    const scalarAfter = {
      customerId,
      title: input.title,
      productType: input.productType,
      material: input.material,
      quantity: input.quantity,
      unit: input.unit,
      receivedDate: input.receivedDate,
      deliveryDate: input.deliveryDate,
      notes: input.notes ?? null,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(scalarAfter) as (keyof typeof scalarAfter)[]) {
      if (scalarBefore[key] !== scalarAfter[key]) changes[key] = { from: scalarBefore[key], to: scalarAfter[key] };
    }
    if (groupsChanged) changes.groups = { from: beforeGroups, to: afterGroups };

    if (groupsChanged) {
      await applyGroupChanges(tx, input.orderId, input.unit, before.groups, input.groups);
    }
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        customerId,
        title: input.title,
        productType: input.productType,
        material: input.material,
        quantity: input.quantity,
        unit: input.unit,
        totalPrice: centsToDecimalString(input.totalPrice),
        receivedDate: dateFromString(input.receivedDate),
        deliveryDate: dateFromString(input.deliveryDate),
        notes: input.notes ?? null,
        status: input.status,
      },
    });

    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.ORDER_UPDATED,
        entityType: "Order",
        entityId: input.orderId,
        metadata: { number: before.number, changes } as Prisma.InputJsonValue,
      });
    }
    if (priceChanged) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.ORDER_PRICE_CHANGED,
        entityType: "Order",
        entityId: input.orderId,
        metadata: {
          number: before.number,
          from: centsToDecimalString(oldPrice),
          to: centsToDecimalString(input.totalPrice),
          paidAtChange: centsToDecimalString(paid),
        },
      });
    }
    if (statusChanged) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
        entityType: "Order",
        entityId: input.orderId,
        metadata: { number: before.number, from: before.status, to: input.status },
      });
    }

    // Quantities may have changed: completion follows the real delivery records.
    await refreshOrderStatus(tx, actor, input.orderId);
    return { orderId: input.orderId, changed: Object.keys(changes).length > 0 || priceChanged || statusChanged };
  });
}

// ───────────────────────────── Read ─────────────────────────────

export type OrderStatusFilter = "all" | "open" | "overdue" | OrderStatus;
export type OrderSort = "newest" | "oldest" | "delivery";
export const ORDERS_PAGE_SIZE = 20;

function orderListWhere(query: string, status: OrderStatusFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  const today = dateFromString(todayDateString());

  if (status === "open") and.push({ status: { in: [...OPEN_ORDER_STATUSES] } });
  else if (status === "overdue") and.push({ status: { in: [...OPEN_ORDER_STATUSES] }, deliveryDate: { lt: today } });
  else if (status !== "all") and.push({ status });

  const q = normalizeDigits(query).trim();
  if (q) {
    const numberMatch = /^#?0*(\d{1,9})$/.exec(q);
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
        { title: { contains: q, mode: "insensitive" } },
        { productType: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        ...(digits.length >= 3 ? [{ customer: { phone: { contains: digits } } }] : []),
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

const SORTS: Record<OrderSort, Prisma.OrderOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { number: "desc" }],
  oldest: [{ createdAt: "asc" }, { number: "asc" }],
  delivery: [{ deliveryDate: "asc" }, { number: "asc" }],
};

export async function listOrders(
  db: DbClient,
  actor: Actor,
  options: { query?: string; status?: OrderStatusFilter; sort?: OrderSort; page?: number },
): Promise<{ items: OrderSummary[]; total: number; page: number; pageCount: number }> {
  assertPermission(actor, "orders:view");
  const where = orderListWhere(options.query ?? "", options.status ?? "all");
  const total = await db.order.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);

  const rows = await db.order.findMany({
    where,
    orderBy: SORTS[options.sort ?? "newest"],
    skip: (page - 1) * ORDERS_PAGE_SIZE,
    take: ORDERS_PAGE_SIZE,
    select: { ...ORDER_SUMMARY_SELECT, customer: { select: { id: true, name: true } } },
  });
  const [paidMap, production] = await Promise.all([
    paidByOrderIds(db, rows.map((r) => r.id)),
    productionTotalsByOrder(db, rows.map((r) => r.id)),
  ]);
  return {
    items: rows.map((row) => ({ ...toOrderSummary(row, paidMap.get(row.id) ?? 0n), production: production.get(row.id) })),
    total,
    page,
    pageCount,
  };
}

export type OrderPaymentView = {
  id: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  notes: string | null;
  isAdvance: boolean;
  recordedByName: string;
  createdAt: Date;
  voided: null | { at: Date; byName: string; reason: string };
};

export type OrderDetails = OrderSummary & {
  customerPhone: string | null;
  notes: string | null;
  createdByName: string;
  groups: {
    id: string;
    position: number;
    quantity: number;
    material: string;
    notes: string | null;
    operations: PrintOperation[];
    description: string;
    sizes: { id: string; label: string; quantity: number }[];
  }[];
  /** True when the order has a size breakdown. */
  sizesEnabled: boolean;
  /** ISO timestamp — sent back by the edit form for stale-edit protection. */
  updatedAt: string;
  payments: OrderPaymentView[];
};

export async function getOrderDetails(db: DbClient, actor: Actor, orderId: string): Promise<OrderDetails | null> {
  assertPermission(actor, "orders:view");
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      ...ORDER_SUMMARY_SELECT,
      notes: true,
      updatedAt: true,
      customer: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { name: true } },
      groups: {
        orderBy: { position: "asc" },
        select: {
            id: true,
            position: true,
            quantity: true,
            material: true,
            notes: true,
            operations: { select: { operation: true } },
            sizes: { orderBy: { position: "asc" }, select: { id: true, label: true, quantity: true } },
          },
      },
      payments: {
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          notes: true,
          isAdvance: true,
          createdAt: true,
          voidedAt: true,
          voidReason: true,
          recordedBy: { select: { name: true } },
          voidedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!order) return null;

  const paid = order.payments
    .filter((p) => p.voidedAt === null)
    .reduce((sum, p) => sum + toCents(p.amount), 0n);

  return {
    ...toOrderSummary(order, paid),
    customerPhone: order.customer.phone,
    notes: order.notes,
    createdByName: order.createdBy.name,
    updatedAt: order.updatedAt.toISOString(),
    groups: order.groups.map((g) => {
      const operations = g.operations.map((o) => o.operation);
      return {
        id: g.id,
        position: g.position,
        quantity: g.quantity,
        material: g.material,
        notes: g.notes,
        operations,
        description: describeOperations(operations),
        sizes: g.sizes,
      };
    }),
    sizesEnabled: order.groups.some((g) => g.sizes.length > 0),
    payments: order.payments.map((p) => ({
      id: p.id,
      amount: centsToDecimalString(toCents(p.amount)),
      paidAt: dateToString(p.paidAt),
      method: p.method,
      notes: p.notes,
      isAdvance: p.isAdvance,
      recordedByName: p.recordedBy.name,
      createdAt: p.createdAt,
      voided:
        p.voidedAt && p.voidedBy && p.voidReason
          ? { at: p.voidedAt, byName: p.voidedBy.name, reason: p.voidReason }
          : null,
    })),
  };
}

/** Values to pre-fill the edit form. */
export async function getOrderForEdit(db: DbClient, actor: Actor, orderId: string) {
  assertPermission(actor, "orders:edit");
  const details = await getOrderDetails(db, actor, orderId);
  return details;
}

/** Previously used materials, offered as suggestions next to the common list. */
export async function recentMaterials(db: DbClient, actor: Actor, limit = 15): Promise<string[]> {
  assertPermission(actor, "orders:view");
  const rows = await db.orderGroup.groupBy({
    by: ["material"],
    _count: { material: true },
    orderBy: { _count: { material: "desc" } },
    take: limit,
  });
  return rows.map((r) => r.material);
}

export type DashboardStats = {
  activeOrders: number;
  overdueOrders: number;
  /** Valid customer payments dated this (Cairo) month — null unless allowed to see company money. */
  paymentsThisMonth: string | null;
};

export async function getDashboardStats(db: DbClient, actor: Actor): Promise<DashboardStats> {
  assertPermission(actor, "dashboard:view");
  const today = todayDateString();
  const monthStart = dateFromString(`${today.slice(0, 8)}01`);
  const todayDate = dateFromString(today);

  const canSeeMoney = hasPermission(actor, "finance:view-summary");
  const [activeOrders, overdueOrders, payments] = await Promise.all([
    db.order.count({ where: { status: { in: [...OPEN_ORDER_STATUSES] } } }),
    db.order.count({ where: { status: { in: [...OPEN_ORDER_STATUSES] }, deliveryDate: { lt: todayDate } } }),
    canSeeMoney
      ? db.orderPayment.aggregate({
          where: { voidedAt: null, paidAt: { gte: monthStart, lte: todayDate } },
          _sum: { amount: true },
        })
      : null,
  ]);
  return {
    activeOrders,
    overdueOrders,
    paymentsThisMonth: payments ? centsToDecimalString(toCents(payments._sum.amount)) : null,
  };
}

/**
 * Dashboard "today" overview — every number from real records, nothing stored:
 * status counts, open orders with pieces ready to hand over, orders that need
 * attention (overdue, or due within 3 days) and the latest orders.
 */
export async function getDashboardOverview(db: DbClient, actor: Actor) {
  assertPermission(actor, "orders:view");
  const today = todayDateString();
  const todayDate = dateFromString(today);
  const soon = dateFromString(new Date(todayDate.getTime() + 3 * 86_400_000).toISOString().slice(0, 10));
  const open = { status: { in: [...OPEN_ORDER_STATUSES] } } satisfies Prisma.OrderWhereInput;
  const select = { ...ORDER_SUMMARY_SELECT, customer: { select: { id: true, name: true } } };

  const [byStatus, readyRows, attentionRows, recentRows, readyWaitingIds] = await Promise.all([
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders o
      WHERE o.status IN ('NEW', 'IN_PROGRESS')
        AND COALESCE((SELECT SUM(quantity) FROM production_ready r WHERE r.order_id = o.id AND r.voided_at IS NULL), 0)
          > COALESCE((SELECT SUM(quantity) FROM deliveries d WHERE d.order_id = o.id AND d.voided_at IS NULL), 0)`,
    db.order.findMany({ where: { ...open, deliveryDate: { lte: soon } }, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }], take: 4, select }),
    db.order.findMany({ orderBy: [{ createdAt: "desc" }, { number: "desc" }], take: 4, select }),
    // Open orders holding finished pieces the customer hasn't received yet.
    db.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM orders o
      WHERE o.status IN ('NEW', 'IN_PROGRESS')
        AND COALESCE((SELECT SUM(quantity) FROM production_ready r WHERE r.order_id = o.id AND r.voided_at IS NULL), 0)
          > COALESCE((SELECT SUM(quantity) FROM deliveries d WHERE d.order_id = o.id AND d.voided_at IS NULL), 0)
      ORDER BY o.delivery_date ASC, o.number ASC
      LIMIT 4`,
  ]);
  const readyWaitingRows = readyWaitingIds.length
    ? await db.order.findMany({ where: { id: { in: readyWaitingIds.map((r) => r.id) } }, orderBy: [{ deliveryDate: "asc" }, { number: "asc" }], select })
    : [];
  const ids = [...new Set([...attentionRows, ...recentRows, ...readyWaitingRows].map((o) => o.id))];
  const [paid, production] = await Promise.all([paidByOrderIds(db, ids), productionTotalsByOrder(db, ids)]);
  const summary = (row: (typeof recentRows)[number]) => ({ ...toOrderSummary(row, paid.get(row.id) ?? 0n), production: production.get(row.id) });
  const count = (status: OrderStatus) => byStatus.find((b) => b.status === status)?._count._all ?? 0;

  return {
    newCount: count("NEW"),
    inProgressCount: count("IN_PROGRESS"),
    readyToDeliverCount: readyRows[0]?.n ?? 0,
    attention: attentionRows.map(summary),
    readyWaiting: readyWaitingRows.map(summary),
    recent: recentRows.map(summary),
  };
}

export type OrderAction = "production" | "delivery" | "payment";

/**
 * Open orders on which a quick action can actually be done right now:
 * production → anything open; delivery → finished pieces still with us;
 * payment → money still owed. Searchable by customer, title or number.
 */
export async function listOrdersForAction(db: DbClient, actor: Actor, action: OrderAction, query: string) {
  assertPermission(actor, "orders:view");
  const where: Prisma.OrderWhereInput = { AND: [{ status: { in: [...OPEN_ORDER_STATUSES] } }, orderListWhere(query, "all")] };
  const rows = await db.order.findMany({
    where,
    orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
    take: 80,
    select: { ...ORDER_SUMMARY_SELECT, customer: { select: { id: true, name: true } } },
  });
  const ids = rows.map((r) => r.id);
  const [paid, production] = await Promise.all([paidByOrderIds(db, ids), productionTotalsByOrder(db, ids)]);
  const items = rows.map((row) => ({ ...toOrderSummary(row, paid.get(row.id) ?? 0n), production: production.get(row.id) }));
  const fits = (o: (typeof items)[number]) => {
    const p = o.production ?? { ready: 0, delivered: 0 };
    if (action === "delivery") return p.ready > p.delivered;
    if (action === "payment") return toCents(o.outstanding) > 0n;
    return p.ready < o.quantity;
  };
  return items.filter(fits).slice(0, 30);
}

/** Open orders for the "تسجيل شغل" picker, with their groups. */
export async function searchOpenOrders(db: DbClient, actor: Actor, query: string, limit = 8) {
  assertPermission(actor, "orders:view");
  const where: Prisma.OrderWhereInput = {
    AND: [{ status: { in: [...OPEN_ORDER_STATUSES] } }, orderListWhere(query, "all")],
  };
  const rows = await db.order.findMany({
    where,
    orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
    take: limit,
    select: {
      id: true,
      number: true,
      title: true,
      quantity: true,
      unit: true,
      customer: { select: { name: true } },
      groups: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, quantity: true, operations: { select: { operation: true } } },
      },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    title: o.title,
    customerName: o.customer.name,
    quantity: o.quantity,
    unit: o.unit,
    groups: o.groups.map((g) => ({
      id: g.id,
      position: g.position,
      quantity: g.quantity,
      operations: g.operations.map((x) => x.operation),
      description: describeOperations(g.operations.map((x) => x.operation)),
    })),
  }));
}

export type OpenOrderOption = Awaited<ReturnType<typeof searchOpenOrders>>[number];

export { isOverdue };
