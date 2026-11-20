import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { toCents, type Cents } from "@/lib/money";

/**
 * "Payables" = order costs and general expenses. Their unpaid part is always
 * computed (amount − valid outgoing payments), never stored.
 */
export type PayableKind = "cost" | "expense";

/** `draft`: a cost entry not posted yet («التكاليف» before closing) — not a payable. */
type LockedPayable = { id: string; amount: Cents; voided: boolean; draft: boolean };

/** Locks the cost/expense row until the transaction ends (pay / void). */
export async function lockPayable(tx: DbTransaction, kind: PayableKind, id: string): Promise<LockedPayable | null> {
  const rows =
    kind === "cost"
      ? await tx.$queryRaw<{ id: string; amount: string; voided: boolean; draft: boolean }[]>`
          SELECT id, amount::text AS amount, (voided_at IS NOT NULL) AS voided, is_draft AS draft
          FROM order_costs WHERE id = ${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{ id: string; amount: string; voided: boolean; draft: boolean }[]>`
          SELECT id, amount::text AS amount, (voided_at IS NOT NULL) AS voided, false AS draft
          FROM general_expenses WHERE id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { id: row.id, amount: toCents(row.amount), voided: row.voided, draft: row.draft } : null;
}

/** Valid (non-voided) money paid toward one cost or expense. */
export async function sumPaidFor(db: DbClient, kind: PayableKind, id: string): Promise<Cents> {
  const result = await db.outgoingPayment.aggregate({
    where: { ...(kind === "cost" ? { orderCostId: id } : { expenseId: id }), voidedAt: null },
    _sum: { amount: true },
  });
  return toCents(result._sum.amount);
}

export async function paidByCostIds(db: DbClient, ids: string[]): Promise<Map<string, Cents>> {
  if (ids.length === 0) return new Map();
  const rows = await db.outgoingPayment.groupBy({
    by: ["orderCostId"],
    where: { orderCostId: { in: ids }, voidedAt: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.orderCostId!, toCents(r._sum.amount)]));
}

export async function paidByExpenseIds(db: DbClient, ids: string[]): Promise<Map<string, Cents>> {
  if (ids.length === 0) return new Map();
  const rows = await db.outgoingPayment.groupBy({
    by: ["expenseId"],
    where: { expenseId: { in: ids }, voidedAt: null },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.expenseId!, toCents(r._sum.amount)]));
}

export type SupplierBalance = { purchased: Cents; paid: Cents; outstanding: Cents };

/**
 * Per-supplier totals from valid costs and their valid payments, in one query.
 * Pass ids to limit to some suppliers; omit for all.
 */
export async function supplierBalances(db: DbClient, ids?: string[]): Promise<Map<string, SupplierBalance>> {
  if (ids && ids.length === 0) return new Map();
  const rows = await db.$queryRaw<{ supplierId: string; purchased: string; paid: string }[]>`
    SELECT c.supplier_id AS "supplierId",
           SUM(c.amount)::text AS purchased,
           COALESCE(SUM(p.paid), 0)::text AS paid
    FROM order_costs c
    LEFT JOIN (
      SELECT order_cost_id, SUM(amount) AS paid
      FROM outgoing_payments
      WHERE voided_at IS NULL AND order_cost_id IS NOT NULL
      GROUP BY order_cost_id
    ) p ON p.order_cost_id = c.id
    WHERE c.voided_at IS NULL
      AND c.is_draft = false
      AND c.supplier_id IS NOT NULL
      AND (${ids ?? null}::uuid[] IS NULL OR c.supplier_id = ANY(${ids ?? null}::uuid[]))
    GROUP BY c.supplier_id`;
  return new Map(
    rows.map((r) => {
      const purchased = toCents(r.purchased);
      const paid = toCents(r.paid);
      return [r.supplierId, { purchased, paid, outstanding: purchased - paid }];
    }),
  );
}
