import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasPermission, isOwner } from "@/lib/auth/permissions";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, formatMoney, MAX_CENTS, parseMoney, toCents } from "@/lib/money";
import { itemLabel } from "@/lib/orders/labels";
import { itemLineCents } from "@/lib/orders/work-kinds";
import { lockOrder } from "@/server/repositories/order-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Owner tools for how an order meets the departments:
 * - an explicit split of ONE item's value across departments (work shared
 *   between departments) — amounts typed by the owner, exact piasters, adding
 *   up to the item's line total; never a percentage the system invents;
 * - hiding an order from every department view (partners and members).
 */

const UUID = z.uuid();

function requireOwner(actor: Actor) {
  if (!isOwner(actor) || !hasPermission(actor, "orders:edit-price")) throw new AppError("FORBIDDEN");
}

const splitSchema = z.object({
  orderId: z.uuid(),
  orderGroupId: z.uuid(),
  /** Empty = no split (the whole value is the item's department's). */
  shares: z.array(z.object({ departmentId: z.uuid("اختار القسم"), amount: z.string() })).max(10),
});

export async function setItemValueSplit(db: PrismaClient, actor: Actor, payload: unknown) {
  requireOwner(actor);
  const parsed = splitSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    const item = await tx.orderGroup.findFirst({
      where: { id: input.orderGroupId, orderId: input.orderId, order: { archivedAt: null } },
      select: { id: true, position: true, name: true, quantity: true, unitPrice: true, pricingBasis: true, billableLengthMm: true, measuredQuantity: true, departmentId: true, order: { select: { number: true, pricing: true } }, valueShares: { select: { departmentId: true, amount: true } } },
    });
    if (!item) throw new AppError("NOT_FOUND", "البند مش موجود");
    if (item.order.pricing !== "PER_ITEM" || item.unitPrice === null) throw new AppError("CONFLICT", "البند ده مالوش سعر خاص بيه (أوردر قديم بسعر إجمالي) — مينفعش يتقسم على الأقسام.");
    const line = itemLineCents({ quantity: item.quantity, unitPriceCents: toCents(item.unitPrice), pricingBasis: item.pricingBasis, billableLengthMm: item.billableLengthMm, measuredQuantity: item.measuredQuantity })!;
    const shares = input.shares.map((s, i) => {
      const cents = parseMoney(s.amount.trim());
      if (cents === null || cents <= 0n || cents > MAX_CENTS) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [`shares.${i}.amount`]: ["اكتب مبلغ أكبر من صفر"] } });
      return { departmentId: s.departmentId, amount: cents };
    });
    if (shares.length === 1) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { shares: ["التقسيم محتاج قسمين على الأقل — لو البند لقسم واحد امسح التقسيم"] } });
    if (new Set(shares.map((s) => s.departmentId)).size !== shares.length) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { shares: ["كل قسم مرة واحدة بس"] } });
    const sum = shares.reduce((s, x) => s + x.amount, 0n);
    if (shares.length > 0 && sum !== line) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { shares: [`مجموع التقسيم (${formatMoney(sum)}) لازم يساوي قيمة البند بالظبط (${formatMoney(line)})`] } });
    }
    const known = await tx.department.findMany({ where: { id: { in: shares.map((s) => s.departmentId) } }, select: { id: true, isActive: true } });
    const before = new Set(item.valueShares.map((s) => s.departmentId));
    for (const s of shares) {
      const d = known.find((k) => k.id === s.departmentId);
      if (!d || (!d.isActive && !before.has(d.id))) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { shares: ["في قسم مش موجود أو متوقف"] } });
    }
    await tx.orderGroupValueShare.deleteMany({ where: { orderGroupId: item.id } });
    if (shares.length > 0) {
      await tx.orderGroupValueShare.createMany({ data: shares.map((s) => ({ orderGroupId: item.id, departmentId: s.departmentId, amount: centsToDecimalString(s.amount), setById: actor.id })) });
    }
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_VALUE_SPLIT_SET,
      entityType: "OrderGroup",
      entityId: item.id,
      metadata: {
        orderId: input.orderId,
        orderNumber: item.order.number,
        item: itemLabel(item.position, item.name),
        lineTotal: centsToDecimalString(line),
        from: item.valueShares.map((s) => ({ departmentId: s.departmentId, amount: centsToDecimalString(toCents(s.amount)) })),
        to: shares.map((s) => ({ departmentId: s.departmentId, amount: centsToDecimalString(s.amount) })),
      },
    });
    return { changed: true };
  });
}

/** Owner: keep an order out of every department view for non-owners (work, values, collections). */
export async function setOrderHiddenFromDepartments(db: PrismaClient, actor: Actor, payload: { orderId: unknown; hidden: unknown }) {
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  const orderId = UUID.safeParse(payload.orderId);
  if (!orderId.success || typeof payload.hidden !== "boolean") throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const hidden = payload.hidden;
  return db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId.data))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId.data }, select: { number: true, hiddenFromDepartments: true } });
    if (order.hiddenFromDepartments === hidden) return { changed: false };
    await tx.order.update({ where: { id: orderId.data }, data: { hiddenFromDepartments: hidden } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.ORDER_DEPARTMENT_VISIBILITY_CHANGED, entityType: "Order", entityId: orderId.data, metadata: { number: order.number, hiddenFromDepartments: hidden } });
    return { changed: true };
  });
}
