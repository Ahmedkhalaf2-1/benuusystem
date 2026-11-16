import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, QuantityUnit } from "@/generated/prisma/enums";
import { dateToString, todayDateString } from "@/lib/dates";
import { centsToDecimalString, toCents, type Cents } from "@/lib/money";
import { OPEN_ORDER_STATUSES } from "@/lib/orders/labels";

/** Order money (decimal strings). Outstanding is always computed, never stored. */
export type OrderMoney = { totalPrice: string; paid: string; outstanding: string };

/**
 * Plain, serializable order data for pages and client components.
 * Money is a decimal string ("40000.00"); dates are "YYYY-MM-DD".
 *
 * `money` is null for viewers without "orders:view-prices": the values are
 * never computed into the object, so they cannot reach JSON, RSC payloads
 * or client components.
 */
export type OrderSummary = {
  id: string;
  number: number;
  title: string;
  customerId: string;
  customerName: string;
  productType: string;
  material: string;
  quantity: number;
  unit: QuantityUnit;
  money: OrderMoney | null;
  receivedDate: string;
  deliveryDate: string;
  status: OrderStatus;
  overdue: boolean;
  createdAt: Date;
  /** Physical pieces ready / delivered (filled by list queries). */
  production?: { ready: number; delivered: number };
};

export const ORDER_SUMMARY_SELECT = {
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
  createdAt: true,
} as const satisfies Prisma.OrderSelect;

type SummaryRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SUMMARY_SELECT }> & {
  customer: { id: string; name: string };
};

export function isOverdue(status: OrderStatus, deliveryDate: string, today = todayDateString()): boolean {
  return OPEN_ORDER_STATUSES.includes(status) && deliveryDate < today;
}

/** `paid` is null when the viewer may not see order money (then `money` is null). */
export function toOrderSummary(row: SummaryRow, paid: Cents | null): OrderSummary {
  const total = toCents(row.totalPrice);
  const deliveryDate = dateToString(row.deliveryDate);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    customerId: row.customer.id,
    customerName: row.customer.name,
    productType: row.productType,
    material: row.material,
    quantity: row.quantity,
    unit: row.unit,
    money:
      paid === null
        ? null
        : { totalPrice: centsToDecimalString(total), paid: centsToDecimalString(paid), outstanding: centsToDecimalString(total - paid) },
    receivedDate: dateToString(row.receivedDate),
    deliveryDate,
    status: row.status,
    overdue: isOverdue(row.status, deliveryDate),
    createdAt: row.createdAt,
  };
}
