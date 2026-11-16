import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OrderVisibility } from "@/generated/prisma/enums";
import { assertPermission, effectiveStaffPermissions, isOwner } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { ORDER_VISIBILITIES, type AssignableStaff } from "@/lib/orders/visibility";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockOrder } from "@/server/repositories/order-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Owner control of «ظهور الأوردر للعمال». Changes run in one transaction with
 * the order row locked, and are rejected when someone else changed the same
 * order's access in the meantime (optimistic `accessVersion` check), so two
 * owners editing at once can never silently overwrite each other.
 */

export const MAX_ORDER_ASSIGNEES = 100;

export const orderAccessSchema = z
  .object({
    visibility: z.enum(ORDER_VISIBILITIES, { error: "اختار مين يشوف الأوردر" }),
    userIds: z.array(z.uuid()).max(MAX_ORDER_ASSIGNEES).default([]),
    /** accessVersion when the form was opened; omitted on create. */
    expectedVersion: z.number().int().min(0).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === "SELECTED_STAFF" && v.userIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["userIds"], message: "اختار عامل واحد على الأقل، أو خلّي الأوردر خاص بالمدير" });
    }
  });

export type OrderAccessInput = z.output<typeof orderAccessSchema>;
export type OrderAccessPayload = z.input<typeof orderAccessSchema>;

export function parseOrderAccess(payload: unknown): OrderAccessInput {
  const parsed = orderAccessSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "راجع اختيار ظهور الأوردر", { fieldErrors: prefix(toFieldErrors(parsed.error)) });
  }
  return { ...parsed.data, userIds: [...new Set(parsed.data.userIds)] };
}

function prefix(errors: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`access.${k}`, v]));
}

/** Active staff accounts (app users — never payroll workers) for the multi-select. */
export async function listAssignableStaff(db: DbClient, actor: Actor): Promise<AssignableStaff[]> {
  assertPermission(actor, "orders:manage-access");
  const rows = await db.user.findMany({
    where: { role: "STAFF", isActive: true },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, email: true, permissions: true },
  });
  return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, canViewOrders: effectiveStaffPermissions(u.permissions).includes("orders:view") }));
}

export type OrderAccessView = { visibility: OrderVisibility; userIds: string[]; version: number };

export async function getOrderAccess(db: DbClient, actor: Actor, orderId: string): Promise<OrderAccessView | null> {
  assertPermission(actor, "orders:manage-access");
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: { visibility: true, accessVersion: true, access: { select: { userId: true }, orderBy: { createdAt: "asc" } } },
  });
  return o ? { visibility: o.visibility, userIds: o.access.map((a) => a.userId), version: o.accessVersion } : null;
}

/**
 * Applies a visibility choice inside an existing transaction (order create,
 * order edit, or the stand-alone action). The caller must hold the order row
 * lock or have just created the order.
 */
export async function applyOrderAccess(
  tx: DbTransaction,
  actor: Actor,
  orderId: string,
  input: OrderAccessInput,
  options: { source: "create" | "edit" | "detail" },
): Promise<{ changed: boolean; version: number }> {
  assertPermission(actor, "orders:manage-access");
  const current = await tx.order.findUnique({
    where: { id: orderId },
    select: { number: true, visibility: true, accessVersion: true, access: { select: { userId: true } } },
  });
  if (!current) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.accessVersion) {
    throw new AppError("CONFLICT", "حد تاني غيّر ظهور الأوردر ده دلوقتي. افتح الصفحة تاني وراجع قبل ما تحفظ.");
  }

  const wanted = input.visibility === "SELECTED_STAFF" ? input.userIds : [];
  if (wanted.length > 0) {
    const valid = await tx.user.findMany({ where: { id: { in: wanted }, role: "STAFF", isActive: true }, select: { id: true } });
    if (valid.length !== wanted.length) {
      throw new AppError("VALIDATION_ERROR", "في حساب مختار مش موجود أو موقوف", { fieldErrors: { "access.userIds": ["في حساب مختار مش موجود أو موقوف"] } });
    }
  }

  const before = current.access.map((a) => a.userId);
  const added = wanted.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !wanted.includes(id));
  const visibilityChanged = current.visibility !== input.visibility;
  if (!visibilityChanged && added.length === 0 && removed.length === 0) return { changed: false, version: current.accessVersion };

  if (removed.length > 0) await tx.orderAccess.deleteMany({ where: { orderId, userId: { in: removed } } });
  if (added.length > 0) await tx.orderAccess.createMany({ data: added.map((userId) => ({ orderId, userId, grantedById: actor.id })) });
  const updated = await tx.order.update({
    where: { id: orderId },
    data: { visibility: input.visibility, accessVersion: { increment: 1 } },
    select: { accessVersion: true },
  });

  if (visibilityChanged) {
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_VISIBILITY_CHANGED,
      entityType: "Order",
      entityId: orderId,
      metadata: { number: current.number, from: current.visibility, to: input.visibility, source: options.source },
    });
  }
  if (added.length > 0 || removed.length > 0) {
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_ACCESS_CHANGED,
      entityType: "Order",
      entityId: orderId,
      metadata: { number: current.number, added, removed, source: options.source },
    });
  }
  return { changed: true, version: updated.accessVersion };
}

/** Stand-alone owner action on the order page. */
export async function updateOrderAccess(db: PrismaClient, actor: Actor, payload: { orderId: unknown; access: unknown }) {
  assertPermission(actor, "orders:manage-access");
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  const orderId = z.uuid().safeParse(payload.orderId);
  if (!orderId.success) throw new AppError("NOT_FOUND");
  const input = parseOrderAccess(payload.access);
  return db.$transaction(async (tx) => {
    // Archived orders keep their access settings but are not edited.
    if (!(await lockOrder(tx, orderId.data))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    return applyOrderAccess(tx, actor, orderId.data, input, { source: "detail" });
  });
}
