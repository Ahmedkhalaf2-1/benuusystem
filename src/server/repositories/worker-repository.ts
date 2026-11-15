import type { WorkerPaymentType } from "@/generated/prisma/enums";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString } from "@/lib/dates";
import { toCents, type Cents } from "@/lib/money";

/**
 * Locks the worker row until the transaction ends. Every money/attendance write
 * for a worker takes this lock, so concurrent requests cannot double-record a
 * day or pay more than is owed.
 */
export async function lockWorker(tx: DbTransaction, workerId: string) {
  const rows = await tx.$queryRaw<{ id: string; daily_wage: string; is_active: boolean }[]>`
    SELECT id, daily_wage::text, is_active FROM workers WHERE id = ${workerId}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? { id: row.id, dailyWage: toCents(row.daily_wage), isActive: row.is_active } : null;
}

/** Wages earned = sum of valid worked days (up to a date, inclusive). */
export async function sumEarned(db: DbClient, workerId: string, upTo?: string): Promise<Cents> {
  const r = await db.workerWorkday.aggregate({
    where: { workerId, voidedAt: null, worked: true, ...(upTo ? { workDate: { lte: dateFromString(upTo) } } : {}) },
    _sum: { wage: true },
  });
  return toCents(r._sum.wage);
}

/** Money paid to the worker (wages + advances, or one type), up to a date. */
export async function sumPaidToWorker(db: DbClient, workerId: string, upTo?: string, type?: WorkerPaymentType): Promise<Cents> {
  const r = await db.outgoingPayment.aggregate({
    where: {
      workerId,
      voidedAt: null,
      ...(type ? { workerPaymentType: type } : {}),
      ...(upTo ? { paidAt: { lte: dateFromString(upTo) } } : {}),
    },
    _sum: { amount: true },
  });
  return toCents(r._sum.amount);
}

/** Per-worker earned and paid totals (optionally up to a date) in two grouped queries. */
export async function balancesByWorker(db: DbClient, workerIds: string[], upTo?: string) {
  const result = new Map<string, { earned: Cents; paid: Cents }>();
  if (workerIds.length === 0) return result;
  const dateLimit = upTo ? dateFromString(upTo) : undefined;
  const [earned, paid] = await Promise.all([
    db.workerWorkday.groupBy({
      by: ["workerId"],
      where: { workerId: { in: workerIds }, voidedAt: null, worked: true, ...(dateLimit ? { workDate: { lte: dateLimit } } : {}) },
      _sum: { wage: true },
    }),
    db.outgoingPayment.groupBy({
      by: ["workerId"],
      where: { workerId: { in: workerIds }, voidedAt: null, ...(dateLimit ? { paidAt: { lte: dateLimit } } : {}) },
      _sum: { amount: true },
    }),
  ]);
  for (const id of workerIds) result.set(id, { earned: 0n, paid: 0n });
  for (const e of earned) result.get(e.workerId)!.earned = toCents(e._sum.wage);
  for (const p of paid) if (p.workerId) result.get(p.workerId)!.paid = toCents(p._sum.amount);
  return result;
}
