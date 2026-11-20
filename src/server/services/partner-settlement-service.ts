import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { assertPermission, isOwner } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents } from "@/lib/money";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { requireDepartment } from "./department-access";
import { insertSupplier } from "./supplier-service";

/**
 * Partner settlements — what Benuuprint OWES a partner, and what it paid.
 *
 * Built only on the existing payables: each job is an ORDER COST recorded for
 * the partner's supplier record (agreed cost per job, or pieces × agreed cost
 * per piece — both typed by the owner), and each settlement payment is an
 * OUTGOING PAYMENT on that cost (partial payments allowed, voidable, treasury
 * attributed as today). Nothing here is computed from customer payments:
 * customers paying never pays a partner, and no amount or percentage is
 * invented.
 *
 * A partner sees only the costs of ITS OWN linked supplier, tagged with a
 * department where its membership has the settlements switch on.
 */

const SOURCE = "web:settlements";
const UUID = z.uuid();

export type SettlementJob = {
  id: string;
  costDate: string;
  orderNumber: number;
  /** Null when the order is hidden from departments (partners). */
  orderTitle: string | null;
  description: string | null;
  quantity: number | null;
  unitCost: string | null;
  amount: string;
  paid: string;
  remaining: string;
};

export type SettlementPayment = { id: string; paidAt: string; amount: string; method: PaymentMethod; orderNumber: number };

export type SettlementTotals = { payable: string; paid: string; remaining: string; jobs: number };

export type PartnerSettlement =
  | { linked: false }
  | { linked: true; totals: SettlementTotals; jobs: SettlementJob[]; payments: SettlementPayment[] };

async function settlementOf(db: DbClient, where: { supplierId?: string; departmentId?: string | null }, maskHidden: boolean): Promise<{ totals: SettlementTotals; jobs: SettlementJob[]; payments: SettlementPayment[] }> {
  const costs = await db.orderCost.findMany({
    where: { ...where, voidedAt: null, order: { archivedAt: null } },
    orderBy: [{ costDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      costDate: true,
      description: true,
      quantity: true,
      unitCost: true,
      amount: true,
      order: { select: { number: true, title: true, hiddenFromDepartments: true } },
      payments: { where: { voidedAt: null }, orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }], select: { id: true, paidAt: true, amount: true, method: true } },
    },
  });
  let payable = 0n;
  let paidAll = 0n;
  const payments: SettlementPayment[] = [];
  const jobs = costs.map((c) => {
    const amount = toCents(c.amount);
    const paid = c.payments.reduce((s, p) => s + toCents(p.amount), 0n);
    payable += amount;
    paidAll += paid;
    for (const p of c.payments) payments.push({ id: p.id, paidAt: dateToString(p.paidAt), amount: centsToDecimalString(toCents(p.amount)), method: p.method, orderNumber: c.order.number });
    return {
      id: c.id,
      costDate: dateToString(c.costDate),
      orderNumber: c.order.number,
      orderTitle: maskHidden && c.order.hiddenFromDepartments ? null : c.order.title,
      description: c.description,
      quantity: c.quantity,
      unitCost: c.unitCost === null ? null : centsToDecimalString(toCents(c.unitCost)),
      amount: centsToDecimalString(amount),
      paid: centsToDecimalString(paid),
      remaining: centsToDecimalString(amount - paid),
    };
  });
  payments.sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));
  return { totals: { payable: centsToDecimalString(payable), paid: centsToDecimalString(paidAll), remaining: centsToDecimalString(payable - paidAll), jobs: jobs.length }, jobs, payments };
}

/**
 * The signed-in partner's (or member's) own settlement for one department.
 * Requires the settlements switch; never another supplier's records.
 */
export async function getMySettlement(db: DbClient, actor: Actor, departmentId: string): Promise<PartnerSettlement> {
  await requireDepartment(db, actor, departmentId, "settlements");
  const me = await db.user.findUnique({ where: { id: actor.id }, select: { supplierId: true, isActive: true } });
  if (!me?.isActive || !me.supplierId) return { linked: false };
  return { linked: true, ...(await settlementOf(db, { supplierId: me.supplierId, departmentId }, !isOwner(actor))) };
}

export type DepartmentSettlementRow = { supplierId: string | null; supplierName: string; partnerName: string | null; totals: SettlementTotals };

/** Owner: what is owed for a department's work, per supplier / partner. */
export async function getDepartmentSettlements(db: DbClient, actor: Actor, departmentId: string): Promise<{ rows: DepartmentSettlementRow[]; totals: SettlementTotals }> {
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  await requireDepartment(db, actor, departmentId, "settlements");
  const costs = await db.orderCost.findMany({
    where: { departmentId, voidedAt: null, order: { archivedAt: null } },
    select: { amount: true, supplierId: true, supplier: { select: { name: true, partner: { select: { name: true } } } }, payments: { where: { voidedAt: null }, select: { amount: true } } },
  });
  const map = new Map<string, { supplierId: string | null; supplierName: string; partnerName: string | null; payable: bigint; paid: bigint; jobs: number }>();
  let payable = 0n;
  let paid = 0n;
  for (const c of costs) {
    const key = c.supplierId ?? "none";
    const row = map.get(key) ?? { supplierId: c.supplierId, supplierName: c.supplier?.name ?? "من غير مورد", partnerName: c.supplier?.partner?.name ?? null, payable: 0n, paid: 0n, jobs: 0 };
    const a = toCents(c.amount);
    const p = c.payments.reduce((s, x) => s + toCents(x.amount), 0n);
    row.payable += a;
    row.paid += p;
    row.jobs += 1;
    payable += a;
    paid += p;
    map.set(key, row);
  }
  const fmt = (x: { payable: bigint; paid: bigint; jobs: number }): SettlementTotals => ({ payable: centsToDecimalString(x.payable), paid: centsToDecimalString(x.paid), remaining: centsToDecimalString(x.payable - x.paid), jobs: x.jobs });
  return {
    rows: [...map.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, "ar")).map((r) => ({ supplierId: r.supplierId, supplierName: r.supplierName, partnerName: r.partnerName, totals: fmt(r) })),
    totals: fmt({ payable, paid, jobs: costs.length }),
  };
}

/** Owner: a partner account's link and its whole settlement (all departments) — users page. */
export async function getPartnerAccountSettlement(db: DbClient, actor: Actor, userId: string) {
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  if (!UUID.safeParse(userId).success) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, supplierId: true, partnerSupplier: { select: { id: true, name: true } } } });
  if (!user || user.role !== "PARTNER") return null;
  const suppliers = await db.supplier.findMany({ where: user.supplierId ? { OR: [{ partner: { is: null } }, { id: user.supplierId }] } : { partner: { is: null } }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } });
  return {
    supplier: user.partnerSupplier,
    suppliers,
    settlement: user.supplierId ? await settlementOf(db, { supplierId: user.supplierId }, false) : null,
  };
}

/**
 * Owner: link a partner account to the supplier record its jobs are owed
 * through («new» creates one with the partner's name), or unlink it.
 * One supplier ↔ one partner. Audited.
 */
export async function linkPartnerSupplier(db: PrismaClient, actor: Actor, payload: { userId: unknown; supplierId: unknown }) {
  assertPermission(actor, "users:manage");
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  const userId = UUID.safeParse(payload.userId);
  if (!userId.success) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  const target = payload.supplierId === "new" ? "new" : payload.supplierId === "" || payload.supplierId === null || payload.supplierId === undefined ? null : UUID.safeParse(payload.supplierId).success ? (payload.supplierId as string) : undefined;
  if (target === undefined) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { supplierId: ["اختار المورد"] } });
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId.data }, select: { role: true, name: true, email: true, supplierId: true } });
    if (!user) throw new AppError("NOT_FOUND", "الحساب مش موجود");
    if (user.role !== "PARTNER") throw new AppError("FORBIDDEN", "الربط بمورد لحسابات الشركاء بس");
    let supplierId: string | null = null;
    if (target === "new") {
      supplierId = (await insertSupplier(tx, actor, { name: user.name, phone: undefined, notes: "حساب تسوية الشريك" })).id;
    } else if (target) {
      const s = await tx.supplier.findUnique({ where: { id: target }, select: { id: true, partner: { select: { id: true } } } });
      if (!s) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { supplierId: ["المورد ده مش موجود"] } });
      if (s.partner && s.partner.id !== userId.data) throw new AppError("CONFLICT", "المورد ده مربوط بشريك تاني", { fieldErrors: { supplierId: ["المورد ده مربوط بشريك تاني"] } });
      supplierId = s.id;
    }
    if (supplierId === user.supplierId) return { changed: false, supplierId };
    await tx.user.update({ where: { id: userId.data }, data: { supplierId } });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.PARTNER_SUPPLIER_LINKED,
      entityType: "User",
      entityId: userId.data,
      metadata: { email: user.email, from: user.supplierId, to: supplierId, createdSupplier: target === "new", source: SOURCE },
    });
    return { changed: true, supplierId };
  });
}
