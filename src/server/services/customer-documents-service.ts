import type { OrderStatus, PaymentMethod, PrintOperation, QuantityUnit } from "@/generated/prisma/enums";
import { itemLineCents, itemWorkSummary } from "@/lib/orders/work-kinds";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString, isValidDateString } from "@/lib/dates";
import { buildStatement, inPeriod, orderBalance, totalsFor, type DocOrder, type Period, type Statement } from "@/lib/documents/customer-account";
import { buildDeliveryHistory, type DeliveryHistory } from "@/lib/documents/delivery-history";
import { AppError } from "@/lib/errors";
import { designLabel, itemLabel, placementsText } from "@/lib/orders/labels";
import { toCents } from "@/lib/money";
import type { Actor } from "./actor";
import { orderScope } from "./order-access";

/**
 * Data for customer-facing PDF documents. Needs "documents:customer-financial"
 * (owner, or staff the owner granted it), checked here as well as in the
 * routes. Staff only ever get orders they may see.
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
  /** "PER_ITEM": each item has a unit price and line total; "ORDER_TOTAL": one agreed total (older orders). */
  pricing: "PER_ITEM" | "ORDER_TOTAL";
  groups: {
    position: number;
    label: string;
    quantity: number;
    material: string;
    operations: PrintOperation[];
    sizes: { label: string; quantity: number }[];
    unitPrice: bigint | null;
    lineTotal: bigint | null;
    /** Customer-facing design lines: "AUC Logo — DTF — الصدر، الظهر" (no workload figures). */
    designs: { label: string; operation: PrintOperation; placements: string; quantity: number }[];
  }[];
  balance: ReturnType<typeof orderBalance>;
  voidedPayments: number;
  /** Physical deliveries — independent of the money figures above. */
  deliveries: DeliveryHistory;
  voidedDeliveries: number;
};

export async function getOrderInvoiceData(db: DbClient, actor: Actor, orderId: string): Promise<InvoiceData | null> {
  guard(actor);
  if (!UUID.test(orderId)) return null;
  // Staff granted documents only reach orders they may see (hidden = not found).
  const o = await db.order.findFirst({
    where: { AND: [{ id: orderId, archivedAt: null }, orderScope(actor)] },
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
      pricing: true,
      customer: { select: { name: true, phone: true } },
      groups: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          name: true,
          quantity: true,
          material: true,
          unitPrice: true,
          workKind: true, variant: true, variantText: true, threadColor: true, saleUnit: true, pricingBasis: true, fileWidthMm: true, fileLengthMm: true, copiesPerRow: true, rollWidthMm: true, billableLengthMm: true, measuredQuantity: true,
          operations: { select: { operation: true } },
          sizes: { orderBy: { position: "asc" }, select: { label: true, quantity: true } },
          designs: { orderBy: { position: "asc" }, select: { position: true, name: true, operation: true, placements: true, customPlacements: true, quantity: true } },
        },
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
          orderGroup: { select: { id: true, position: true, name: true } },
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
    pricing: o.pricing,
    groups: o.groups.map((g) => {
      const unitPrice = o.pricing === "PER_ITEM" && g.unitPrice !== null ? toCents(g.unitPrice) : null;
      // Work-kind items describe their material / size / billed meters instead of a fabric.
      const work = itemWorkSummary({ ...g, measuredQuantity: g.measuredQuantity?.toString() ?? null }, g.quantity);
      return {
        position: g.position,
        label: itemLabel(g.position, g.name),
        quantity: g.quantity,
        material: work ?? g.material,
        operations: g.operations.map((x) => x.operation),
        sizes: g.sizes,
        unitPrice,
        lineTotal: itemLineCents({ quantity: g.quantity, unitPriceCents: unitPrice, pricingBasis: g.pricingBasis, billableLengthMm: g.billableLengthMm, measuredQuantity: g.measuredQuantity }),
        designs: g.designs.map((d) => ({ label: designLabel(d.position, d.name), operation: d.operation, placements: placementsText(d.placements, d.customPlacements), quantity: d.quantity })),
      };
    }),
    balance: orderBalance(order),
    voidedPayments: o.payments.length - payments.length,
    deliveries: buildDeliveryHistory(
      o.groups.map((g) => ({ id: g.id, position: g.position, quantity: g.quantity, label: itemLabel(g.position, g.name) })),
      o.deliveries
        .filter((d) => d.voidedAt === null)
        .map((d) => ({
          id: d.id,
          groupId: d.orderGroup.id,
          groupPosition: d.orderGroup.position,
          groupLabel: itemLabel(d.orderGroup.position, d.orderGroup.name),
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

async function loadCustomerOrders(db: DbClient, actor: Actor, customerId: string): Promise<{ customer: CustomerDocData["customer"]; orders: DocOrder[] } | null> {
  if (!UUID.test(customerId)) return null;
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      orders: {
        where: { AND: [{ archivedAt: null }, orderScope(actor)] },
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
  const loaded = await loadCustomerOrders(db, actor, customerId);
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
  const loaded = await loadCustomerOrders(db, actor, customerId);
  if (!loaded) return null;
  const statement = buildStatement(loaded.orders, period);
  const cancelledOrders = loaded.orders
    .filter((o) => o.status === "CANCELLED" && (!period.to || o.receivedDate <= period.to))
    .map((o) => ({ number: o.number, title: o.title, paid: orderBalance(o).paidOnCancelled }));
  return { generatedAt: new Date(), customer: loaded.customer, statement, cancelledOrders };
}
