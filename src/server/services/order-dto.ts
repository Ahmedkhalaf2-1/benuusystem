import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, QuantityUnit } from "@/generated/prisma/enums";
import { dateToString, todayDateString } from "@/lib/dates";
import { centsToDecimalString, toCents, type Cents } from "@/lib/money";
import { OPEN_ORDER_STATUSES } from "@/lib/orders/labels";

/**
 * Plain, serializable order data for pages and client components.
 * Money is a decimal string ("40000.00"); dates are "YYYY-MM-DD".
 * Outstanding is always computed, never read from storage.
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
  totalPrice: string;
  paid: string;
  outstanding: string;
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

export function toOrderSummary(row: SummaryRow, paid: Cents): OrderSummary {
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
    totalPrice: centsToDecimalString(total),
    paid: centsToDecimalString(paid),
    outstanding: centsToDecimalString(total - paid),
    receivedDate: dateToString(row.receivedDate),
    deliveryDate,
    status: row.status,
    overdue: isOverdue(row.status, deliveryDate),
    createdAt: row.createdAt,
  };
}
