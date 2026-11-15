import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OrderStatus, PaymentMethod, PrintOperation } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney, toCents } from "@/lib/money";
import { normalizeDigits } from "@/lib/numbers";
import { OPEN_ORDER_STATUSES, describeOperations } from "@/lib/orders/labels";
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
  }));
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

type GroupSnapshot = { quantity: number; material: string; notes: string | null; operations: PrintOperation[] };

function snapshotGroups(
  groups: { quantity: number; material: string; notes?: string | null; operations: PrintOperation[] }[],
): GroupSnapshot[] {
  return groups.map((g) => ({
    quantity: g.quantity,
    material: g.material,
    notes: g.notes ?? null,
    operations: [...g.operations].sort(),
  }));
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
        groups: {
          orderBy: { position: "asc" },
          select: { quantity: true, material: true, notes: true, operations: { select: { operation: true } } },
        },
      },
    });

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
      await tx.orderGroup.deleteMany({ where: { orderId: input.orderId } });
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
        ...(groupsChanged ? { groups: { create: groupsCreateData(input.groups) } } : {}),
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
  const paidMap = await paidByOrderIds(db, rows.map((r) => r.id));
  return {
    items: rows.map((row) => toOrderSummary(row, paidMap.get(row.id) ?? 0n)),
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
  groups: { position: number; quantity: number; material: string; notes: string | null; operations: PrintOperation[]; description: string }[];
  payments: OrderPaymentView[];
};

export async function getOrderDetails(db: DbClient, actor: Actor, orderId: string): Promise<OrderDetails | null> {
  assertPermission(actor, "orders:view");
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      ...ORDER_SUMMARY_SELECT,
      notes: true,
      customer: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { name: true } },
      groups: {
        orderBy: { position: "asc" },
        select: { position: true, quantity: true, material: true, notes: true, operations: { select: { operation: true } } },
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
    groups: order.groups.map((g) => {
      const operations = g.operations.map((o) => o.operation);
      return {
        position: g.position,
        quantity: g.quantity,
        material: g.material,
        notes: g.notes,
        operations,
        description: describeOperations(operations),
      };
    }),
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
  /** Valid payments dated in the current (Cairo) month, decimal string. */
  paymentsThisMonth: string;
};

export async function getDashboardStats(db: DbClient, actor: Actor): Promise<DashboardStats> {
  assertPermission(actor, "dashboard:view");
  const today = todayDateString();
  const monthStart = dateFromString(`${today.slice(0, 8)}01`);
  const todayDate = dateFromString(today);

  const [activeOrders, overdueOrders, payments] = await Promise.all([
    db.order.count({ where: { status: { in: [...OPEN_ORDER_STATUSES] } } }),
    db.order.count({ where: { status: { in: [...OPEN_ORDER_STATUSES] }, deliveryDate: { lt: todayDate } } }),
    db.orderPayment.aggregate({
      where: { voidedAt: null, paidAt: { gte: monthStart, lte: todayDate } },
      _sum: { amount: true },
    }),
  ]);
  return {
    activeOrders,
    overdueOrders,
    paymentsThisMonth: centsToDecimalString(toCents(payments._sum.amount)),
  };
}

export { isOverdue };
