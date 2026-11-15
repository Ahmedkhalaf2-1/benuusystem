import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents, type Cents } from "@/lib/money";
import { normalizeDigits } from "@/lib/numbers";
import {
  customerInputSchema,
  type CustomerFormValues,
  type CustomerInput,
} from "@/lib/validations/customer";
import { toFieldErrors } from "@/lib/validations/utils";
import { paidByOrderIds } from "@/server/repositories/order-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { ORDER_SUMMARY_SELECT, toOrderSummary, type OrderSummary } from "./order-dto";

export type CustomerListItem = {
  id: string;
  name: string;
  phone: string | null;
  orderCount: number;
  createdAt: Date;
};

export type CustomerTotals = {
  /** Agreed prices of non-cancelled orders. Decimal strings ("40000.00"). */
  agreed: string;
  paid: string;
  outstanding: string;
};

export type CustomerDetails = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: Date;
  createdByName: string;
  totals: CustomerTotals;
  orders: OrderSummary[];
};

export function parseCustomerInput(raw: CustomerFormValues): CustomerInput {
  const parsed = customerInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: toFieldErrors(parsed.error) });
  }
  return parsed.data;
}

/** Inserts a customer and its audit entry. Use inside a transaction. */
export async function insertCustomer(tx: DbClient, actor: Actor, input: CustomerInput) {
  const customer = await tx.customer.create({
    data: { name: input.name, phone: input.phone, notes: input.notes, createdById: actor.id },
    select: { id: true, name: true, phone: true },
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.CUSTOMER_CREATED,
    entityType: "Customer",
    entityId: customer.id,
    metadata: { name: customer.name },
  });
  return customer;
}

export async function createCustomer(db: PrismaClient, actor: Actor, raw: CustomerFormValues) {
  assertPermission(actor, "customers:manage");
  const input = parseCustomerInput(raw);
  return db.$transaction((tx) => insertCustomer(tx, actor, input));
}

export async function updateCustomer(
  db: PrismaClient,
  actor: Actor,
  customerId: string,
  raw: CustomerFormValues,
) {
  assertPermission(actor, "customers:manage");
  const input = parseCustomerInput(raw);

  return db.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({
      where: { id: customerId },
      select: { name: true, phone: true, notes: true },
    });
    if (!before) throw new AppError("NOT_FOUND", "العميل مش موجود");

    const after = { name: input.name, phone: input.phone ?? null, notes: input.notes ?? null };
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    for (const key of ["name", "phone", "notes"] as const) {
      if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
    }

    const customer = await tx.customer.update({
      where: { id: customerId },
      data: after,
      select: { id: true, name: true },
    });
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
        entityType: "Customer",
        entityId: customerId,
        metadata: { changes },
      });
    }
    return customer;
  });
}

function customerSearchWhere(query: string): Prisma.CustomerWhereInput {
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

/** Quick lookup for the order form's customer picker. */
export async function searchCustomers(db: DbClient, actor: Actor, query: string, limit = 8) {
  assertPermission(actor, "customers:view");
  const q = normalizeDigits(query).trim();
  return db.customer.findMany({
    where: customerSearchWhere(q),
    // Recent customers first when nothing is typed yet.
    orderBy: q ? [{ name: "asc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }],
    take: limit,
    select: { id: true, name: true, phone: true },
  });
}

export const CUSTOMERS_PAGE_SIZE = 20;

export async function listCustomers(
  db: DbClient,
  actor: Actor,
  options: { query?: string; page?: number },
): Promise<{ items: CustomerListItem[]; total: number; page: number; pageCount: number }> {
  assertPermission(actor, "customers:view");
  const where = customerSearchWhere(options.query ?? "");
  const total = await db.customer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);

  const rows = await db.customer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * CUSTOMERS_PAGE_SIZE,
    take: CUSTOMERS_PAGE_SIZE,
    select: { id: true, name: true, phone: true, createdAt: true, _count: { select: { orders: true } } },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      createdAt: row.createdAt,
      orderCount: row._count.orders,
    })),
    total,
    page,
    pageCount,
  };
}

export async function getCustomerDetails(
  db: DbClient,
  actor: Actor,
  customerId: string,
): Promise<CustomerDetails | null> {
  assertPermission(actor, "customers:view");
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      notes: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      orders: {
        orderBy: [{ createdAt: "desc" }],
        select: ORDER_SUMMARY_SELECT,
      },
    },
  });
  if (!customer) return null;

  const paidMap = await paidByOrderIds(db, customer.orders.map((o) => o.id));
  const orders = customer.orders.map((order) =>
    toOrderSummary({ ...order, customer: { id: customer.id, name: customer.name } }, paidMap.get(order.id) ?? 0n),
  );

  let agreed: Cents = 0n;
  let paid: Cents = 0n;
  for (const order of customer.orders) {
    if (order.status === "CANCELLED") continue;
    agreed += toCents(order.totalPrice);
    paid += paidMap.get(order.id) ?? 0n;
  }

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    notes: customer.notes,
    createdAt: customer.createdAt,
    createdByName: customer.createdBy.name,
    totals: {
      agreed: centsToDecimalString(agreed),
      paid: centsToDecimalString(paid),
      outstanding: centsToDecimalString(agreed - paid),
    },
    orders,
  };
}

export async function getCustomerForEdit(db: DbClient, actor: Actor, customerId: string) {
  assertPermission(actor, "customers:manage");
  return db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true, notes: true },
  });
}
