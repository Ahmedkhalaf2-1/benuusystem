import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { CostCategory, PaymentMethod } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { settlementStatus, type SettlementStatus } from "@/lib/finance/labels";
import { centsToDecimalString, toCents } from "@/lib/money";
import {
  recordOrderCostSchema,
  voidRecordSchema,
  type RecordOrderCostInput,
  type RecordOrderCostPayload,
} from "@/lib/validations/finance";
import { toFieldErrors } from "@/lib/validations/utils";
import { lockOrder } from "@/server/repositories/order-repository";
import { lockPayable, paidByCostIds, sumPaidFor } from "@/server/repositories/payable-repository";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { insertOutgoingPayment } from "./outgoing-payment-service";
import { insertSupplier } from "./supplier-service";

export type RecordCostResult = { costId: string; orderId: string; created: boolean };

async function findCostByKey(db: DbClient, key: string): Promise<RecordCostResult | null> {
  const existing = await db.orderCost.findUnique({ where: { idempotencyKey: key }, select: { id: true, orderId: true } });
  return existing ? { costId: existing.id, orderId: existing.orderId, created: false } : null;
}

export async function resolveSupplierId(
  tx: DbTransaction,
  actor: Actor,
  choice: RecordOrderCostInput["supplier"],
): Promise<string | null> {
  if (choice.mode === "none") return null;
  if (choice.mode === "new") {
    return (await insertSupplier(tx, actor, { name: choice.name, phone: choice.phone, notes: undefined })).id;
  }
  const exists = await tx.supplier.findUnique({ where: { id: choice.id }, select: { id: true } });
  if (!exists) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { supplier: ["المورد ده مش موجود، اختاره تاني"] } });
  }
  return choice.id;
}

/**
 * Records an order cost. The FULL amount counts as the order's cost right away;
 * only the part paid now becomes an outgoing payment. Cost, optional new
 * supplier and initial payment are saved in one transaction. Idempotent.
 */
export async function recordOrderCost(
  db: PrismaClient,
  actor: Actor,
  payload: RecordOrderCostPayload,
): Promise<RecordCostResult> {
  assertPermission(actor, "costs:record");
  const parsed = recordOrderCostSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  const input = parsed.data;
  if (input.initialPayment > 0n) assertPermission(actor, "payables:pay");

  const previous = await findCostByKey(db, input.idempotencyKey);
  if (previous) return previous;

  try {
    return await db.$transaction(async (tx) => {
      // Order lock: serializes with archiving (an archived order counts as missing).
      if (!(await lockOrder(tx, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
      const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, number: true } });
      if (!order) throw new AppError("NOT_FOUND", "الأوردر مش موجود");

      const supplierId = await resolveSupplierId(tx, actor, input.supplier);
      const cost = await tx.orderCost.create({
        data: {
          orderId: order.id,
          category: input.category,
          description: input.description,
          amount: centsToDecimalString(input.amount),
          costDate: dateFromString(input.costDate),
          supplierId,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.ORDER_COST_RECORDED,
        entityType: "OrderCost",
        entityId: cost.id,
        metadata: {
          orderId: order.id,
          orderNumber: order.number,
          category: input.category,
          amount: centsToDecimalString(input.amount),
          supplierId,
          paidNow: centsToDecimalString(input.initialPayment),
        },
      });

      if (input.initialPayment > 0n) {
        await insertOutgoingPayment(tx, actor, {
          kind: "cost",
          targetId: cost.id,
          amount: input.initialPayment,
          paidAt: input.costDate,
          method: input.method,
          idempotencyKey: randomUUID(),
        });
      }
      return { costId: cost.id, orderId: order.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findCostByKey(db, input.idempotencyKey);
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Owner-only: void a wrongly entered cost. Refused while it still has valid
 * payments — those were real cash, so they must be voided (or kept) explicitly.
 */
export async function voidOrderCost(db: PrismaClient, actor: Actor, payload: { id?: unknown; reason?: unknown }) {
  assertPermission(actor, "finance:void");
  const parsed = voidRecordSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  const { id, reason } = parsed.data;

  return db.$transaction(async (tx) => {
    const cost = await lockPayable(tx, "cost", id);
    if (!cost) throw new AppError("NOT_FOUND", "التكلفة مش موجودة");
    if (cost.voided) throw new AppError("CONFLICT", "التكلفة دي ملغية بالفعل");
    if ((await sumPaidFor(tx, "cost", id)) > 0n) {
      throw new AppError("CONFLICT", "التكلفة دي عليها مدفوعات. ألغِ المدفوعات الأول لو كانت غلط.");
    }
    const updated = await tx.orderCost.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
      select: { orderId: true },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_COST_VOIDED,
      entityType: "OrderCost",
      entityId: id,
      metadata: { orderId: updated.orderId, amount: centsToDecimalString(cost.amount), reason },
    });
    return { orderId: updated.orderId };
  });
}

export type CostPaymentView = {
  id: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  recordedByName: string;
  voided: null | { byName: string; reason: string };
};

export type OrderCostView = {
  id: string;
  category: CostCategory;
  description: string | null;
  amount: string;
  paid: string;
  remaining: string;
  status: SettlementStatus;
  costDate: string;
  supplier: { id: string; name: string } | null;
  notes: string | null;
  recordedByName: string;
  voided: null | { byName: string; reason: string };
  payments: CostPaymentView[];
};

export type OrderCostSummary = {
  /** Valid costs only. Decimal strings. */
  totals: { costs: string; paid: string; outstanding: string };
  entries: OrderCostView[];
};

export async function getOrderCosts(db: DbClient, actor: Actor, orderId: string): Promise<OrderCostSummary> {
  assertPermission(actor, "costs:view");
  const costs = await db.orderCost.findMany({
    where: { orderId },
    orderBy: [{ costDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      category: true,
      description: true,
      amount: true,
      costDate: true,
      notes: true,
      voidedAt: true,
      voidReason: true,
      supplier: { select: { id: true, name: true } },
      recordedBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      payments: {
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          voidedAt: true,
          voidReason: true,
          recordedBy: { select: { name: true } },
          voidedBy: { select: { name: true } },
        },
      },
    },
  });
  const paidMap = await paidByCostIds(db, costs.map((c) => c.id));

  let total = 0n;
  let paidTotal = 0n;
  const entries = costs.map((c): OrderCostView => {
    const amount = toCents(c.amount);
    const paid = paidMap.get(c.id) ?? 0n;
    const voided = c.voidedAt !== null;
    if (!voided) {
      total += amount;
      paidTotal += paid;
    }
    return {
      id: c.id,
      category: c.category,
      description: c.description,
      amount: centsToDecimalString(amount),
      paid: centsToDecimalString(paid),
      remaining: centsToDecimalString(voided ? 0n : amount - paid),
      status: settlementStatus(amount, paid),
      costDate: dateToString(c.costDate),
      supplier: c.supplier,
      notes: c.notes,
      recordedByName: c.recordedBy.name,
      voided: voided && c.voidReason ? { byName: c.voidedBy?.name ?? "", reason: c.voidReason } : null,
      payments: c.payments.map((p) => ({
        id: p.id,
        amount: centsToDecimalString(toCents(p.amount)),
        paidAt: dateToString(p.paidAt),
        method: p.method,
        recordedByName: p.recordedBy.name,
        voided: p.voidedAt && p.voidReason ? { byName: p.voidedBy?.name ?? "", reason: p.voidReason } : null,
      })),
    };
  });

  return {
    totals: {
      costs: centsToDecimalString(total),
      paid: centsToDecimalString(paidTotal),
      outstanding: centsToDecimalString(total - paidTotal),
    },
    entries,
  };
}

/** One cost with what is left to pay — for the "pay this cost" page. */
export async function getCostForPayment(db: DbClient, actor: Actor, costId: string) {
  assertPermission(actor, "payables:pay");
  assertPermission(actor, "costs:view");
  const cost = await db.orderCost.findUnique({
    where: { id: costId },
    select: {
      id: true,
      category: true,
      description: true,
      amount: true,
      voidedAt: true,
      supplier: { select: { id: true, name: true } },
      order: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } },
    },
  });
  if (!cost) return null;
  const paid = await sumPaidFor(db, "cost", costId);
  const amount = toCents(cost.amount);
  return {
    id: cost.id,
    category: cost.category,
    description: cost.description,
    supplier: cost.supplier,
    order: cost.order,
    voided: cost.voidedAt !== null,
    amount: centsToDecimalString(amount),
    paid: centsToDecimalString(paid),
    remaining: centsToDecimalString(amount - paid),
  };
}
