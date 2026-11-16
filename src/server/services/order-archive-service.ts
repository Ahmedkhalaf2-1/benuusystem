import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents } from "@/lib/money";
import { formatOrderNumber } from "@/lib/orders/labels";
import { z } from "zod";
import type { Actor } from "./actor";
import { canAccessOrder, requireOrderAccess } from "./order-access";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * «حذف الأوردر» — owner only, and never a real delete.
 *
 * An order is ARCHIVED (hidden from lists, dashboards, customer totals and
 * reports) only when nothing has happened on it: no valid payment, cost or
 * payment on a cost, worker output, production, ready or delivery record.
 * Voided records are kept as history and don't block. An order with activity
 * is refused with the reasons, so the owner corrects it through the normal
 * void/cancel steps first. Every archive and restore is audited with the
 * original order number, who, when and why. Nothing is ever purged.
 */

export type ArchiveBlocker = { kind: "payments" | "costs" | "costPayments" | "workLogs" | "production" | "ready" | "deliveries"; count: number };

export const ARCHIVE_BLOCKER_LABELS: Record<ArchiveBlocker["kind"], string> = {
  payments: "دفعات من العميل",
  costs: "تكاليف متسجلة",
  costPayments: "مدفوعات لموردين على تكاليف الأوردر",
  workLogs: "شغل عمال متسجل على الأوردر",
  production: "إنتاج متسجل",
  ready: "قطع متسجلة جاهزة",
  deliveries: "تسليمات",
};

const reasonSchema = z.string({ error: "اكتب سبب الحذف" }).trim().min(3, "اكتب سبب الحذف (3 حروف على الأقل)").max(300, "السبب طويل جدًا");

async function blockersOf(db: DbClient, orderId: string): Promise<ArchiveBlocker[]> {
  const [payments, costs, costPayments, workLogs, production, ready, deliveries] = await Promise.all([
    db.orderPayment.count({ where: { orderId, voidedAt: null } }),
    db.orderCost.count({ where: { orderId, voidedAt: null } }),
    db.outgoingPayment.count({ where: { orderCost: { orderId }, voidedAt: null } }),
    db.workerWorkLog.count({ where: { orderId, voidedAt: null } }),
    db.productionStageProgress.count({ where: { orderId, voidedAt: null } }),
    db.productionReady.count({ where: { orderId, voidedAt: null } }),
    db.delivery.count({ where: { orderId, voidedAt: null } }),
  ]);
  const all: ArchiveBlocker[] = [
    { kind: "payments", count: payments },
    { kind: "costs", count: costs },
    { kind: "costPayments", count: costPayments },
    { kind: "workLogs", count: workLogs },
    { kind: "production", count: production },
    { kind: "ready", count: ready },
    { kind: "deliveries", count: deliveries },
  ];
  return all.filter((b) => b.count > 0);
}

/** What stands in the way of removing this order (for the confirmation screen). */
export async function getArchiveCheck(db: DbClient, actor: Actor, orderId: string) {
  await requireOrderAccess(db, actor, orderId, "orders:archive", { includeArchived: true });
  const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, archivedAt: true } });
  if (!order) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const blockers = await blockersOf(db, orderId);
  return { archived: order.archivedAt !== null, blockers, canArchive: order.archivedAt === null && blockers.length === 0 };
}

export async function archiveOrder(db: PrismaClient, actor: Actor, payload: { orderId: unknown; reason: unknown }) {
  assertPermission(actor, "orders:archive");
  const orderId = z.uuid().safeParse(payload.orderId);
  if (!orderId.success) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const reason = reasonSchema.safeParse(payload.reason);
  if (!reason.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { reason: [reason.error.issues[0]!.message] } });

  return db.$transaction(async (tx) => {
    // Same row lock every payment / production / cost write takes, so nothing
    // can be recorded on the order between this check and the archive.
    const locked = await tx.$queryRaw<{ id: string; archived_at: Date | null }[]>`
      SELECT id, archived_at FROM orders WHERE id = ${orderId.data}::uuid FOR UPDATE`;
    if (locked.length === 0 || !(await canAccessOrder(tx, actor, orderId.data, { includeArchived: true }))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    if (locked[0]!.archived_at) return { orderId: orderId.data, archived: false };

    const blockers = await blockersOf(tx, orderId.data);
    if (blockers.length > 0) {
      throw new AppError(
        "CONFLICT",
        `مينفعش يتحذف: عليه ${blockers.map((b) => `${ARCHIVE_BLOCKER_LABELS[b.kind]} (${b.count})`).join("، ")}. لو كانت غلط، ألغها الأول (بسبب) أو ألغِ الأوردر.`,
      );
    }
    const order = await tx.order.update({
      where: { id: orderId.data },
      data: { archivedAt: new Date(), archivedById: actor.id, archiveReason: reason.data },
      select: { number: true, title: true, customerId: true, totalPrice: true, status: true },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_ARCHIVED,
      entityType: "Order",
      entityId: orderId.data,
      metadata: {
        number: order.number,
        orderNumber: formatOrderNumber(order.number),
        title: order.title,
        customerId: order.customerId,
        totalPrice: centsToDecimalString(toCents(order.totalPrice)),
        status: order.status,
        reason: reason.data,
      },
    });
    return { orderId: orderId.data, archived: true };
  });
}

/** Brings an archived order back (owner only, audited). */
export async function restoreOrder(db: PrismaClient, actor: Actor, payload: { orderId: unknown }) {
  assertPermission(actor, "orders:archive");
  const orderId = z.uuid().safeParse(payload.orderId);
  if (!orderId.success) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ archived_at: Date | null; archive_reason: string | null }[]>`
      SELECT archived_at, archive_reason FROM orders WHERE id = ${orderId.data}::uuid FOR UPDATE`;
    if (locked.length === 0 || !(await canAccessOrder(tx, actor, orderId.data, { includeArchived: true }))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    if (!locked[0]!.archived_at) return { orderId: orderId.data, restored: false };
    const order = await tx.order.update({
      where: { id: orderId.data },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
      select: { number: true },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_RESTORED,
      entityType: "Order",
      entityId: orderId.data,
      metadata: { number: order.number, archivedAt: locked[0]!.archived_at.toISOString(), archiveReason: locked[0]!.archive_reason },
    });
    return { orderId: orderId.data, restored: true };
  });
}
