import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CostCategory, PaymentMethod } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { settlementStatus, type SettlementStatus } from "@/lib/finance/labels";
import { centsToDecimalString, toCents } from "@/lib/money";
import { normalizeDigits } from "@/lib/numbers";
import { supplierInputSchema, type SupplierFormValues, type SupplierInput } from "@/lib/validations/finance";
import { toFieldErrors } from "@/lib/validations/utils";
import { paidByCostIds, supplierBalances } from "@/server/repositories/payable-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

function parseSupplier(raw: SupplierFormValues): SupplierInput {
  const parsed = supplierInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  return parsed.data;
}

/** Inserts a supplier + audit entry. Use inside a transaction. */
export async function insertSupplier(tx: DbClient, actor: Actor, input: SupplierInput) {
  assertPermission(actor, "suppliers:manage");
  const supplier = await tx.supplier.create({
    data: { name: input.name, phone: input.phone, notes: input.notes, createdById: actor.id },
    select: { id: true, name: true },
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.SUPPLIER_CREATED,
    entityType: "Supplier",
    entityId: supplier.id,
    metadata: { name: supplier.name },
  });
  return supplier;
}

export async function createSupplier(db: PrismaClient, actor: Actor, raw: SupplierFormValues) {
  assertPermission(actor, "suppliers:manage");
  const input = parseSupplier(raw);
  return db.$transaction((tx) => insertSupplier(tx, actor, input));
}

export async function updateSupplier(db: PrismaClient, actor: Actor, supplierId: string, raw: SupplierFormValues) {
  assertPermission(actor, "suppliers:manage");
  const input = parseSupplier(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id: supplierId }, select: { name: true, phone: true, notes: true } });
    if (!before) throw new AppError("NOT_FOUND", "المورد مش موجود");
    const after = { name: input.name, phone: input.phone ?? null, notes: input.notes ?? null };
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    for (const key of ["name", "phone", "notes"] as const) {
      if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
    }
    const supplier = await tx.supplier.update({ where: { id: supplierId }, data: after, select: { id: true } });
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
        entityType: "Supplier",
        entityId: supplierId,
        metadata: { changes },
      });
    }
    return supplier;
  });
}

function searchWhere(query: string): Prisma.SupplierWhereInput {
  const q = normalizeDigits(query).trim();
  if (!q) return {};
  const digits = q.replace(/\D/g, "");
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ],
  };
}

export async function searchSuppliers(db: DbClient, actor: Actor, query: string, limit = 8) {
  assertPermission(actor, "suppliers:view");
  const q = normalizeDigits(query).trim();
  return db.supplier.findMany({
    where: searchWhere(q),
    orderBy: q ? [{ name: "asc" }] : [{ createdAt: "desc" }],
    take: limit,
    select: { id: true, name: true, phone: true },
  });
}

export const SUPPLIERS_PAGE_SIZE = 20;

export type SupplierListItem = {
  id: string;
  name: string;
  phone: string | null;
  purchased: string;
  paid: string;
  outstanding: string;
};

export async function listSuppliers(db: DbClient, actor: Actor, options: { query?: string; page?: number }) {
  assertPermission(actor, "suppliers:view");
  const where = searchWhere(options.query ?? "");
  const total = await db.supplier.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / SUPPLIERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);
  const rows = await db.supplier.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * SUPPLIERS_PAGE_SIZE,
    take: SUPPLIERS_PAGE_SIZE,
    select: { id: true, name: true, phone: true },
  });
  const balances = await supplierBalances(db, rows.map((r) => r.id));
  const items: SupplierListItem[] = rows.map((r) => {
    const b = balances.get(r.id);
    return {
      ...r,
      purchased: centsToDecimalString(b?.purchased ?? 0n),
      paid: centsToDecimalString(b?.paid ?? 0n),
      outstanding: centsToDecimalString(b?.outstanding ?? 0n),
    };
  });
  return { items, total, page, pageCount };
}

export type SupplierPurchase = {
  id: string;
  orderId: string;
  orderNumber: number;
  orderTitle: string;
  customerName: string;
  category: CostCategory;
  description: string | null;
  amount: string;
  paid: string;
  remaining: string;
  status: SettlementStatus;
  costDate: string;
  voided: boolean;
};

export type SupplierPaymentView = {
  id: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  notes: string | null;
  costId: string;
  costLabel: string;
  recordedByName: string;
  voided: null | { byName: string; reason: string };
};

export type SupplierDetails = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: Date;
  totals: { purchased: string; paid: string; outstanding: string };
  purchases: SupplierPurchase[];
  payments: SupplierPaymentView[];
};

export async function getSupplierDetails(db: DbClient, actor: Actor, supplierId: string): Promise<SupplierDetails | null> {
  assertPermission(actor, "suppliers:view");
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      name: true,
      phone: true,
      notes: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      costs: {
        orderBy: [{ costDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          category: true,
          description: true,
          amount: true,
          costDate: true,
          voidedAt: true,
          order: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } },
          payments: {
            orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              amount: true,
              paidAt: true,
              method: true,
              notes: true,
              voidedAt: true,
              voidReason: true,
              recordedBy: { select: { name: true } },
              voidedBy: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!supplier) return null;

  const paidMap = await paidByCostIds(db, supplier.costs.map((c) => c.id));
  let purchased = 0n;
  let paidTotal = 0n;
  const purchases: SupplierPurchase[] = supplier.costs.map((c) => {
    const amount = toCents(c.amount);
    const paid = paidMap.get(c.id) ?? 0n;
    const voided = c.voidedAt !== null;
    if (!voided) {
      purchased += amount;
      paidTotal += paid;
    }
    return {
      id: c.id,
      orderId: c.order.id,
      orderNumber: c.order.number,
      orderTitle: c.order.title,
      customerName: c.order.customer.name,
      category: c.category,
      description: c.description,
      amount: centsToDecimalString(amount),
      paid: centsToDecimalString(paid),
      remaining: centsToDecimalString(voided ? 0n : amount - paid),
      status: settlementStatus(amount, paid),
      costDate: dateToString(c.costDate),
      voided,
    };
  });

  const payments: SupplierPaymentView[] = supplier.costs
    .flatMap((c) =>
      c.payments.map((p) => ({
        id: p.id,
        amount: centsToDecimalString(toCents(p.amount)),
        paidAt: dateToString(p.paidAt),
        method: p.method,
        notes: p.notes,
        costId: c.id,
        costLabel: c.description ?? `أوردر #${String(c.order.number).padStart(4, "0")}`,
        recordedByName: p.recordedBy.name,
        voided: p.voidedAt && p.voidReason ? { byName: p.voidedBy?.name ?? "", reason: p.voidReason } : null,
      })),
    )
    .sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));

  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    notes: supplier.notes,
    createdByName: supplier.createdBy.name,
    createdAt: supplier.createdAt,
    totals: {
      purchased: centsToDecimalString(purchased),
      paid: centsToDecimalString(paidTotal),
      outstanding: centsToDecimalString(purchased - paidTotal),
    },
    purchases,
    payments,
  };
}

export async function getSupplierForEdit(db: DbClient, actor: Actor, supplierId: string) {
  assertPermission(actor, "suppliers:manage");
  return db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, phone: true, notes: true } });
}
