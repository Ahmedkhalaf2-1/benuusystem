import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { daysBetween, dateToString, todayDateString } from "@/lib/dates";
import { centsToDecimalString, toCents } from "@/lib/money";
import type { Actor } from "./actor";
import { orderScope } from "./order-access";

/**
 * «فلوس متأخرة بعد التسليم» — an INTERNAL alert, computed on every read (no
 * reminder rows, nothing sent outside the app, no due date or ledger changed).
 *
 * An order is listed when ALL of these hold:
 *   - it is fully delivered (status COMPLETED, set only by the delivery records),
 *   - its full-delivery date = the latest valid delivery date (business date,
 *     Cairo calendar) — partial deliveries never start the countdown,
 *   - at least OVERDUE_DAYS calendar days have passed since that date,
 *   - total − valid payments > 0 (a partial payment still leaves an alert for
 *     the rest; a fully paid order never shows).
 * Voided deliveries / payments are excluded, so corrections apply at once.
 * Visible only with order prices AND payment history (and order visibility).
 */
export const OVERDUE_DAYS = 10;

export type OverdueReceivable = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  fullDeliveryDate: string;
  daysSinceDelivery: number;
  total: string;
  collected: string;
  remaining: string;
};

export async function listOverdueReceivables(db: DbClient, actor: Actor, now: Date = new Date()): Promise<OverdueReceivable[]> {
  assertPermission(actor, "orders:view-prices");
  assertPermission(actor, "payments:view");
  const today = todayDateString(now);
  const orders = await db.order.findMany({
    where: { AND: [orderScope(actor), { archivedAt: null, status: "COMPLETED" }] },
    select: {
      id: true,
      number: true,
      title: true,
      totalPrice: true,
      customer: { select: { name: true } },
      payments: { where: { voidedAt: null }, select: { amount: true } },
      deliveries: { where: { voidedAt: null }, orderBy: { deliveredAt: "desc" }, take: 1, select: { deliveredAt: true } },
    },
  });
  const out: OverdueReceivable[] = [];
  for (const o of orders) {
    const last = o.deliveries[0];
    if (!last) continue;
    const total = toCents(o.totalPrice);
    const collected = o.payments.reduce((s, p) => s + toCents(p.amount), 0n);
    const remaining = total - collected;
    if (remaining <= 0n) continue;
    const fullDeliveryDate = dateToString(last.deliveredAt);
    const days = daysBetween(fullDeliveryDate, today);
    if (days < OVERDUE_DAYS) continue;
    out.push({
      orderId: o.id,
      number: o.number,
      title: o.title,
      customerName: o.customer.name,
      fullDeliveryDate,
      daysSinceDelivery: days,
      total: centsToDecimalString(total),
      collected: centsToDecimalString(collected),
      remaining: centsToDecimalString(remaining),
    });
  }
  return out.sort((a, b) => b.daysSinceDelivery - a.daysSinceDelivery || a.number - b.number);
}
