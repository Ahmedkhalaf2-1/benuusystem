import type { OrderStatus, PaymentMethod, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString, isValidDateString } from "@/lib/dates";
import { buildStatement, inPeriod, orderBalance, totalsFor, type DocOrder, type Period, type Statement } from "@/lib/documents/customer-account";
import { buildDeliveryHistory, type DeliveryHistory } from "@/lib/documents/delivery-history";
import { AppError } from "@/lib/errors";
import { toCents } from "@/lib/money";
import type { Actor } from "./actor";

/**
 * Data for customer-facing PDF documents. Owner-only (permission
 * "documents:customer-financial"), checked here as well as in the routes.
 * Reads only customers, orders, groups, sizes, operations and payments —
 * never costs, wages, suppliers or profitability.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guard(actor: Actor) {
  assertPermission(actor, "documents:customer-financial");
}

/** from/to as "YYYY-MM-DD" (either optional). Throws VALIDATION_ERROR on bad input. */
export function parsePeriod(raw: { from?: string | null; to?: string | null }): Period {
  const period: Period = {};
  for (const key of ["from", "to"] as const) {
    const value = raw[key]?.trim();
    if (!value) continue;
    if (!isValidDateString(value)) throw new AppError("VALIDATION_ERROR", "التاريخ غير صحيح");
    period[key] = value;
  }
  // A reversed range (easy to pick on a phone) is read the right way round.
  if (period.from && period.to && period.from > period.to) return { from: period.to, to: period.from };
  return period;
}

const PAYMENT_SELECT = { id: true, amount: true, paidAt: true, method: true, isAdvance: true, createdAt: true, voidedAt: true } as const;

type PaymentRow = { id: string; amount: { toString(): string }; paidAt: Date; method: PaymentMethod; isAdvance: boolean; createdAt: Date; voidedAt: Date | null };

function validPayments(rows: PaymentRow[]) {
  return rows
    .filter((p) => p.voidedAt === null)
    .map((p) => ({ id: p.id, amount: toCents(p.amount), paidAt: dateToString(p.paidAt), method: p.method, isAdvance: p.isAdvance, createdAt: p.createdAt }));
}

export type InvoiceData = {
  generatedAt: Date;
  order: DocOrder & {
    material: string;
    quantity: number;
    unit: QuantityUnit;
    deliveryDate: string;
    payments: (DocOrder["payments"][number] & { method: PaymentMethod })[];
  };
  customer: { name: string; phone: string | null };
  groups: { position: number; quantity: number; material: string; operations: PrintOperation[]; sizes: { label: string; quantity: number }[] }[];
  balance: ReturnType<typeof orderBalance>;
  voidedPayments: number;
  /** Physical deliveries — independent of the money figures above. */
  deliveries: DeliveryHistory;
  voidedDeliveries: number;
};

export async function getOrderInvoiceData(db: DbClient, actor: Actor, orderId: string): Promise<InvoiceData | null> {
  guard(actor);
  if (!UUID.test(orderId)) return null;
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      title: true,
      productType: true,
      material: true,
      quantity: true,
      unit: true,
      totalPrice: true,
      receivedDate: true,
      deliveryDate: true,
      status: true,
      customer: { select: { name: true, phone: true } },
      groups: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, quantity: true, material: true, operations: { select: { operation: true } }, sizes: { orderBy: { position: "asc" }, select: { label: true, quantity: true } } },
      },
      deliveries: {
        select: {
          id: true,
          quantity: true,
          deliveredAt: true,
          createdAt: true,
          recordedById: true,
          notes: true,
          voidedAt: true,
          orderGroup: { select: { id: true, position: true } },
          orderGroupSize: { select: { label: true, position: true } },
        },
      },
      payments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }], select: PAYMENT_SELECT },
    },
  });
  if (!o) return null;
  const payments = validPayments(o.payments);
  const order = {
    id: o.id,
    number: o.number,
    title: o.title,
    productType: o.productType,
    material: o.material,
    quantity: o.quantity,
    unit: o.unit,
    status: o.status as OrderStatus,
    totalPrice: toCents(o.totalPrice),
    receivedDate: dateToString(o.receivedDate),
    deliveryDate: dateToString(o.deliveryDate),
    payments,
  };
  return {
    generatedAt: new Date(),
    order,
    customer: o.customer,
    groups: o.groups.map((g) => ({ position: g.position, quantity: g.quantity, material: g.material, operations: g.operations.map((x) => x.operation), sizes: g.sizes })),
    balance: orderBalance(order),
    voidedPayments: o.payments.length - payments.length,
    deliveries: buildDeliveryHistory(
      o.groups.map((g) => ({ id: g.id, position: g.position, quantity: g.quantity })),
      o.deliveries
        .filter((d) => d.voidedAt === null)
        .map((d) => ({
          id: d.id,
          groupId: d.orderGroup.id,
          groupPosition: d.orderGroup.position,
          sizeLabel: d.orderGroupSize?.label ?? null,
          sizePosition: d.orderGroupSize?.position ?? null,
          quantity: d.quantity,
          deliveredAt: dateToString(d.deliveredAt),
          createdAt: d.createdAt,
          recordedById: d.recordedById,
          notes: d.notes,
        })),
    ),
    voidedDeliveries: o.deliveries.filter((d) => d.voidedAt !== null).length,
  };
}

export type CustomerDocData = {
  generatedAt: Date;
  customer: { id: string; name: string; phone: string | null };
  period: Period;
  orders: DocOrder[];
};

async function loadCustomerOrders(db: DbClient, customerId: string): Promise<{ customer: CustomerDocData["customer"]; orders: DocOrder[] } | null> {
  if (!UUID.test(customerId)) return null;
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      orders: {
        orderBy: [{ receivedDate: "asc" }, { number: "asc" }],
        select: { id: true, number: true, title: true, productType: true, status: true, totalPrice: true, receivedDate: true, payments: { select: PAYMENT_SELECT } },
      },
    },
  });
  if (!c) return null;
  return {
    customer: { id: c.id, name: c.name, phone: c.phone },
    orders: c.orders.map((o) => ({
      id: o.id,
      number: o.number,
      title: o.title,
      productType: o.productType,
      status: o.status,
      totalPrice: toCents(o.totalPrice),
      receivedDate: dateToString(o.receivedDate),
      payments: validPayments(o.payments),
    })),
  };
}

/** Orders placed (by order date) inside the period, with their balances and totals. */
export async function getCustomerOrdersSummary(db: DbClient, actor: Actor, customerId: string, period: Period) {
  guard(actor);
  const loaded = await loadCustomerOrders(db, customerId);
  if (!loaded) return null;
  const orders = loaded.orders.filter((o) => inPeriod(o.receivedDate, period));
  return { generatedAt: new Date(), customer: loaded.customer, period, orders, totals: totalsFor(orders) };
}

/** Chronological ledger of the customer's account, built from current records. */
export async function getCustomerStatement(
  db: DbClient,
  actor: Actor,
  customerId: string,
  period: Period,
): Promise<{ generatedAt: Date; customer: CustomerDocData["customer"]; statement: Statement; cancelledOrders: { number: number; title: string; paid: bigint }[] } | null> {
  guard(actor);
  const loaded = await loadCustomerOrders(db, customerId);
  if (!loaded) return null;
  const statement = buildStatement(loaded.orders, period);
  const cancelledOrders = loaded.orders
    .filter((o) => o.status === "CANCELLED" && (!period.to || o.receivedDate <= period.to))
    .map((o) => ({ number: o.number, title: o.title, paid: orderBalance(o).paidOnCancelled }));
  return { generatedAt: new Date(), customer: loaded.customer, statement, cancelledOrders };
}
