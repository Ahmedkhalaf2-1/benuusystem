import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, WorkerJob, WorkerPaymentType, WorkType, WorkUnit } from "@/generated/prisma/enums";
import { assertPermission, hasPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, dateToString, monthRange, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents, type Cents } from "@/lib/money";
import { allocateDayWage, costPerUnit, percentOf, type AllocationBasis, type UnallocatedReason } from "@/lib/workers/allocation";
import { balancesByWorker, sumEarned, sumPaidToWorker } from "@/server/repositories/worker-repository";
import type { Actor } from "./actor";

/**
 * Read side of the workers module. Labour cost has ONE source — the worked
 * days (wage snapshots). Splitting a day's wage across orders is recomputed
 * from valid work logs every time; nothing derived is stored.
 */

const DAY_WITH_LOGS = {
  id: true,
  workerId: true,
  workDate: true,
  worked: true,
  wage: true,
  notes: true,
  voidedAt: true,
  voidReason: true,
  workLogs: {
    where: { voidedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderId: true,
      orderGroupId: true,
      workType: true,
      quantity: true,
      unit: true,
      hours: true,
      notes: true,
      order: { select: { number: true, title: true, customer: { select: { name: true } } } },
      orderGroup: { select: { position: true } },
    },
  },
} as const satisfies Prisma.WorkerWorkdaySelect;

type DayRow = Prisma.WorkerWorkdayGetPayload<{ select: typeof DAY_WITH_LOGS }>;

function allocate(day: DayRow) {
  const wage = day.worked && !day.voidedAt ? toCents(day.wage) : 0n;
  return allocateDayWage(
    wage,
    day.workLogs.map((l) => ({
      id: l.id,
      orderId: l.orderId,
      unit: l.unit,
      quantity: l.quantity,
      hundredthsOfHours: l.hours ? Number(toCents(l.hours)) : null,
    })),
  );
}

// ───────────────────────────── Worker details ─────────────────────────────

export type WorkLogView = {
  id: string;
  orderId: string | null;
  orderLabel: string | null;
  groupPosition: number | null;
  workType: WorkType;
  quantity: number;
  unit: WorkUnit;
  hours: string | null;
  notes: string | null;
  /** Share of the day's wage (pay viewers only). */
  share: string | null;
};

export type WorkdayView = {
  id: string;
  date: string;
  worked: boolean;
  notes: string | null;
  voided: null | { reason: string };
  /** Output per unit, never mixing units. */
  output: { unit: WorkUnit; quantity: number }[];
  /** Against the worker's target unit, when set: "83.33". */
  achievement: string | null;
  logs: WorkLogView[];
  pay: null | {
    wage: string;
    /** Wage ÷ output, only when the whole day is in one unit. */
    costPerUnit: string | null;
    basis: AllocationBasis;
    unallocated: string;
    unallocatedReason: UnallocatedReason;
  };
};

export type WorkerDetails = {
  id: string;
  name: string;
  phone: string | null;
  job: WorkerJob;
  jobTitle: string | null;
  isActive: boolean;
  notes: string | null;
  dailyTarget: number | null;
  targetUnit: WorkUnit | null;
  month: { from: string; to: string; daysWorked: number; output: { unit: WorkUnit; quantity: number }[]; achievement: string | null };
  days: WorkdayView[];
  pay: null | {
    dailyWage: string;
    earnedThisMonth: string;
    earnedTotal: string;
    wagePaymentsTotal: string;
    advancesTotal: string;
    /** We still owe him (≥ 0). */
    owed: string;
    /** Advances not yet covered by earned days (≥ 0). */
    advanceOutstanding: string;
    payments: { id: string; type: WorkerPaymentType; amount: string; paidAt: string; method: PaymentMethod; notes: string | null; recordedByName: string; voided: null | { byName: string; reason: string } }[];
  };
};

function outputByUnit(logs: { unit: WorkUnit; quantity: number }[]) {
  const map = new Map<WorkUnit, number>();
  for (const l of logs) map.set(l.unit, (map.get(l.unit) ?? 0) + l.quantity);
  return [...map.entries()].map(([unit, quantity]) => ({ unit, quantity }));
}

export async function getWorkerDetails(db: DbClient, actor: Actor, workerId: string, options: { days?: number } = {}): Promise<WorkerDetails | null> {
  assertPermission(actor, "workers:view");
  const canSeePay = hasPermission(actor, "workers:view-pay");
  const worker = await db.worker.findUnique({ where: { id: workerId } });
  if (!worker) return null;

  const month = monthRange(todayDateString());
  const days = await db.workerWorkday.findMany({
    where: { workerId },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    take: options.days ?? 40,
    select: DAY_WITH_LOGS,
  });
  const monthDays = await db.workerWorkday.findMany({
    where: { workerId, voidedAt: null, workDate: { gte: dateFromString(month.from), lte: dateFromString(month.to) } },
    select: { worked: true, wage: true, workLogs: { where: { voidedAt: null }, select: { unit: true, quantity: true } } },
  });

  const target = worker.dailyTarget && worker.targetUnit ? { qty: worker.dailyTarget, unit: worker.targetUnit } : null;
  const dayViews = days.map((d): WorkdayView => {
    const output = outputByUnit(d.workLogs);
    const inTarget = target ? output.find((o) => o.unit === target.unit)?.quantity ?? 0 : 0;
    const a = allocate(d);
    const shareById = new Map(a.shares.map((s) => [s.logId, s.cents]));
    const wage = toCents(d.wage);
    const single = output.length === 1 ? output[0]! : null;
    const cpu = d.worked && single ? costPerUnit(wage, single.quantity) : null;
    return {
      id: d.id,
      date: dateToString(d.workDate),
      worked: d.worked,
      notes: d.notes,
      voided: d.voidedAt ? { reason: d.voidReason ?? "" } : null,
      output,
      achievement: d.worked && target ? percentOf(inTarget, target.qty) : null,
      logs: d.workLogs.map((l) => ({
        id: l.id,
        orderId: l.orderId,
        orderLabel: l.order ? `#${String(l.order.number).padStart(4, "0")} ${l.order.customer.name} — ${l.order.title}` : null,
        groupPosition: l.orderGroup?.position ?? null,
        workType: l.workType,
        quantity: l.quantity,
        unit: l.unit,
        hours: l.hours ? centsToDecimalString(toCents(l.hours)) : null,
        notes: l.notes,
        share: canSeePay && shareById.has(l.id) ? centsToDecimalString(shareById.get(l.id)!) : null,
      })),
      pay: canSeePay
        ? {
            wage: centsToDecimalString(wage),
            costPerUnit: cpu !== null ? centsToDecimalString(cpu) : null,
            basis: a.basis,
            unallocated: centsToDecimalString(a.unallocated),
            unallocatedReason: a.reason,
          }
        : null,
    };
  });

  const workedMonth = monthDays.filter((d) => d.worked);
  const monthOutput = outputByUnit(workedMonth.flatMap((d) => d.workLogs));
  const monthInTarget = target ? monthOutput.find((o) => o.unit === target.unit)?.quantity ?? 0 : 0;

  let pay: WorkerDetails["pay"] = null;
  if (canSeePay) {
    const [earnedTotal, wagePaid, advances, payments] = await Promise.all([
      sumEarned(db, workerId),
      sumPaidToWorker(db, workerId, undefined, "WAGE"),
      sumPaidToWorker(db, workerId, undefined, "ADVANCE"),
      db.outgoingPayment.findMany({
        where: { workerId },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: 30,
        select: {
          id: true,
          workerPaymentType: true,
          amount: true,
          paidAt: true,
          method: true,
          notes: true,
          voidedAt: true,
          voidReason: true,
          recordedBy: { select: { name: true } },
          voidedBy: { select: { name: true } },
        },
      }),
    ]);
    const net = earnedTotal - wagePaid - advances;
    pay = {
      dailyWage: centsToDecimalString(toCents(worker.dailyWage)),
      earnedThisMonth: centsToDecimalString(workedMonth.reduce((s, d) => s + toCents(d.wage), 0n)),
      earnedTotal: centsToDecimalString(earnedTotal),
      wagePaymentsTotal: centsToDecimalString(wagePaid),
      advancesTotal: centsToDecimalString(advances),
      owed: centsToDecimalString(net > 0n ? net : 0n),
      advanceOutstanding: centsToDecimalString(net < 0n ? -net : 0n),
      payments: payments.map((p) => ({
        id: p.id,
        type: p.workerPaymentType!,
        amount: centsToDecimalString(toCents(p.amount)),
        paidAt: dateToString(p.paidAt),
        method: p.method,
        notes: p.notes,
        recordedByName: p.recordedBy.name,
        voided: p.voidedAt && p.voidReason ? { byName: p.voidedBy?.name ?? "", reason: p.voidReason } : null,
      })),
    };
  }

  return {
    id: worker.id,
    name: worker.name,
    phone: worker.phone,
    job: worker.job,
    jobTitle: worker.jobTitle,
    isActive: worker.isActive,
    notes: worker.notes,
    dailyTarget: worker.dailyTarget,
    targetUnit: worker.targetUnit,
    month: {
      ...month,
      daysWorked: workedMonth.length,
      output: monthOutput,
      achievement: target && workedMonth.length > 0 ? percentOf(monthInTarget, target.qty * workedMonth.length) : null,
    },
    days: dayViews,
    pay,
  };
}

// ───────────────────────────── Labour per order ─────────────────────────────

export type OrderLabor = {
  total: string;
  entries: { logId: string; workerId: string; workerName: string; date: string; workType: WorkType; quantity: number; unit: WorkUnit; share: string }[];
};

/** Wages attributed to one order (shares of the days its work was logged on). */
export async function getOrderLabor(db: DbClient, actor: Actor, orderId: string): Promise<OrderLabor> {
  assertPermission(actor, "labor:view");
  const dayIds = await db.workerWorkLog.findMany({
    where: { orderId, voidedAt: null },
    select: { workdayId: true },
    distinct: ["workdayId"],
  });
  const days = await db.workerWorkday.findMany({
    where: { id: { in: dayIds.map((d) => d.workdayId) }, voidedAt: null, worked: true },
    select: { ...DAY_WITH_LOGS, worker: { select: { name: true } } },
    orderBy: [{ workDate: "asc" }],
  });
  let total = 0n;
  const entries: OrderLabor["entries"] = [];
  for (const day of days) {
    const a = allocate(day);
    for (const share of a.shares) {
      if (share.orderId !== orderId) continue;
      const log = day.workLogs.find((l) => l.id === share.logId)!;
      total += share.cents;
      entries.push({
        logId: log.id,
        workerId: day.workerId,
        workerName: day.worker.name,
        date: dateToString(day.workDate),
        workType: log.workType,
        quantity: log.quantity,
        unit: log.unit,
        share: centsToDecimalString(share.cents),
      });
    }
  }
  return { total: centsToDecimalString(total), entries };
}

// ───────────────────────────── Monthly summary ─────────────────────────────

export type MonthlyWorkerSummary = {
  from: string;
  to: string;
  /** 1) Labour EXPENSE incurred in the month (by work date). */
  expense: { workersCount: number; workedDays: number; wagesEarned: string; unallocatedLabor: string };
  /** 2) CASH paid to workers in the month (by payment date). */
  cash: { wagePayments: string; advances: string; total: string };
  /** 3) BALANCES at the end of the month. */
  balances: { owedToWorkers: string; advancesOutstanding: string };
  workers: {
    id: string;
    name: string;
    isActive: boolean;
    workedDays: number;
    earned: string;
    paidInMonth: string;
    /** Positive: we owe him; negative: unsettled advance. As of month end. */
    balanceAtEnd: string;
  }[];
};

export async function getMonthlyWorkerSummary(db: DbClient, actor: Actor, month: string): Promise<MonthlyWorkerSummary> {
  assertPermission(actor, "workers:view-pay");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError("VALIDATION_ERROR", "اختار الشهر");
  const range = monthRange(`${month}-01`);
  const between = { gte: dateFromString(range.from), lte: dateFromString(range.to) };

  const [days, payments] = await Promise.all([
    db.workerWorkday.findMany({ where: { voidedAt: null, workDate: between }, select: DAY_WITH_LOGS }),
    db.outgoingPayment.findMany({
      where: { voidedAt: null, workerId: { not: null }, paidAt: between },
      select: { workerId: true, workerPaymentType: true, amount: true },
    }),
  ]);
  const activityIds = new Set([...days.map((d) => d.workerId), ...payments.map((p) => p.workerId!)]);
  const workers = await db.worker.findMany({
    where: { OR: [{ isActive: true }, { id: { in: [...activityIds] } }] },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });
  const balances = await balancesByWorker(db, workers.map((w) => w.id), range.to);

  let workedDays = 0;
  let earned = 0n;
  let unallocated = 0n;
  const perWorker = new Map<string, { days: number; earned: Cents; paid: Cents }>();
  for (const w of workers) perWorker.set(w.id, { days: 0, earned: 0n, paid: 0n });
  for (const d of days) {
    if (!d.worked) continue;
    const wage = toCents(d.wage);
    workedDays += 1;
    earned += wage;
    unallocated += allocate(d).unallocated;
    const pw = perWorker.get(d.workerId)!;
    pw.days += 1;
    pw.earned += wage;
  }
  let wagePayments = 0n;
  let advances = 0n;
  for (const p of payments) {
    const amount = toCents(p.amount);
    if (p.workerPaymentType === "ADVANCE") advances += amount;
    else wagePayments += amount;
    perWorker.get(p.workerId!)!.paid += amount;
  }
  let owed = 0n;
  let advanceOutstanding = 0n;
  for (const b of balances.values()) {
    const net = b.earned - b.paid;
    if (net > 0n) owed += net;
    else advanceOutstanding += -net;
  }

  return {
    ...range,
    expense: {
      workersCount: workers.filter((w) => w.isActive).length,
      workedDays,
      wagesEarned: centsToDecimalString(earned),
      unallocatedLabor: centsToDecimalString(unallocated),
    },
    cash: {
      wagePayments: centsToDecimalString(wagePayments),
      advances: centsToDecimalString(advances),
      total: centsToDecimalString(wagePayments + advances),
    },
    balances: { owedToWorkers: centsToDecimalString(owed), advancesOutstanding: centsToDecimalString(advanceOutstanding) },
    workers: workers.map((w) => {
      const pw = perWorker.get(w.id)!;
      const b = balances.get(w.id)!;
      return {
        id: w.id,
        name: w.name,
        isActive: w.isActive,
        workedDays: pw.days,
        earned: centsToDecimalString(pw.earned),
        paidInMonth: centsToDecimalString(pw.paid),
        balanceAtEnd: centsToDecimalString(b.earned - b.paid),
      };
    }),
  };
}

/** Today's attendance count — operational (no money), for the dashboard. */
export async function getTodayAttendance(db: DbClient, actor: Actor) {
  assertPermission(actor, "workers:view");
  const today = dateFromString(todayDateString());
  const [active, present] = await Promise.all([
    db.worker.count({ where: { isActive: true } }),
    db.workerWorkday.count({ where: { voidedAt: null, worked: true, workDate: today } }),
  ]);
  return { activeWorkers: active, presentToday: present };
}
