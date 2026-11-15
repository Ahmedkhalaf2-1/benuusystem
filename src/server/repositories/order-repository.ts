import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { toCents, type Cents } from "@/lib/money";

/**
 * Next order number. Must run inside the order-creating transaction: the row
 * lock taken by UPDATE serializes concurrent creators, and a rollback also
 * rolls the counter back, so numbers stay unique AND gapless.
 */
export async function nextOrderNumber(tx: DbTransaction): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    UPDATE counters SET value = value + 1 WHERE key = 'order_number' RETURNING value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error("order_number counter is missing (run migrations)");
  return value;
}

/** Locks the order row until the transaction ends (payments, edits). */
export async function lockOrder(tx: DbTransaction, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

/** Sum of non-voided payments for one order. */
export async function sumValidPayments(db: DbClient, orderId: string): Promise<Cents> {
  const result = await db.orderPayment.aggregate({
    where: { orderId, voidedAt: null },
    _sum: { amount: true },
  });
  return toCents(result._sum.amount);
}

/** Sum of non-voided payments per order, for list pages. */
export async function paidByOrderIds(db: DbClient, orderIds: string[]): Promise<Map<string, Cents>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db.orderPayment.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, voidedAt: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((row) => [row.orderId, toCents(row._sum.amount)]));
}
