import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OrderStatus, QuantityUnit } from "@/generated/prisma/enums";
import { assertPermission, isOwner } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateToString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents } from "@/lib/money";
import { itemLabel, OPEN_ORDER_STATUSES } from "@/lib/orders/labels";
import { UNALLOCATED, type ShareStatus } from "@/lib/finance/allocation";
import type { DepartmentOption } from "@/lib/departments/suggest";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { departmentGrants, departmentItemWhere, departmentMoneyOrderWhere, departmentOrderWhere, requireDepartment, type DepartmentGrant } from "./department-access";
import { loadOrderFinances, summarizeBucket, type DepartmentFinanceSummary, type OrderFinance } from "./department-finance";
import { loadGroupProgress, recordReady, recordStageProgress, type GroupProgress } from "./production-service";
import type { RecordReadyPayload, RecordStagePayload } from "@/lib/validations/production";

/**
 * Department dashboards and department-scoped order views («الأقسام»).
 *
 * Every response here is an explicit ALLOWLIST built from the department's
 * own items. It never contains: the whole-order total, other departments'
 * items' details, customer phone numbers, order notes, whole-order payments,
 * costs or wages.
 *
 * Department money (each part behind its own switch):
 * - work value: the department's priced work (its items, or its owner-split
 *   share of a shared item) — never revenue;
 * - allocated collections: the department's pro-rata share of each valid
 *   customer payment (src/server/services/department-finance.ts) — derived,
 *   labelled as allocated, never a payment to a partner.
 */

import type { ItemWorkStatus } from "@/lib/departments/labels";
export type { ItemWorkStatus } from "@/lib/departments/labels";

/** How collections are attributed (shown with every collections figure). */
export const COLLECTIONS_BASIS = "PRO_RATA_OF_PRICED_WORK" as const;

type ItemCounters = { quantity: number; worked: number; ready: number; delivered: number };

function workStatus(orderStatus: OrderStatus, c: ItemCounters): ItemWorkStatus {
  if (orderStatus === "CANCELLED") return "CANCELLED";
  if (c.delivered >= c.quantity) return "DELIVERED";
  if (c.ready >= c.quantity) return "READY";
  if (c.worked > 0 || c.ready > 0 || c.delivered > 0) return "IN_PRODUCTION";
  return "NOT_STARTED";
}

/** Valid ready / delivered / most-advanced-step counts per item (pieces are never added across steps). */
async function itemCounters(db: DbClient, items: { id: string; quantity: number }[]): Promise<Map<string, ItemCounters>> {
  const ids = items.map((i) => i.id);
  const out = new Map<string, ItemCounters>(items.map((i) => [i.id, { quantity: i.quantity, worked: 0, ready: 0, delivered: 0 }]));
  if (ids.length === 0) return out;
  const [stages, ready, delivered] = await Promise.all([
    db.productionStageProgress.groupBy({ by: ["orderGroupId", "operation", "designId"], where: { orderGroupId: { in: ids }, voidedAt: null }, _sum: { quantity: true } }),
    db.productionReady.groupBy({ by: ["orderGroupId"], where: { orderGroupId: { in: ids }, voidedAt: null }, _sum: { quantity: true } }),
    db.delivery.groupBy({ by: ["orderGroupId"], where: { orderGroupId: { in: ids }, voidedAt: null }, _sum: { quantity: true } }),
  ]);
  for (const s of stages) {
    const c = out.get(s.orderGroupId)!;
    c.worked = Math.max(c.worked, s._sum.quantity ?? 0);
  }
  for (const r of ready) out.get(r.orderGroupId)!.ready = r._sum.quantity ?? 0;
  for (const d of delivered) out.get(d.orderGroupId)!.delivered = d._sum.quantity ?? 0;
  return out;
}

export type DepartmentCollections = {
  basis: typeof COLLECTIONS_BASIS;
  /** The department's allocated share of valid customer payments. NOT paid to anyone. */
  collected: string;
  /** Work value − allocated collections. */
  outstanding: string;
  orders: Record<ShareStatus, number>;
};

export type DepartmentMoney = {
  /** The department's priced work on non-cancelled orders. NOT money collected. */
  workValue: string;
  /** Department items whose value can't be allocated reliably (no item price, or a stale owner split). */
  unreliableItems: number;
  /** Null without the collections switch. */
  collections: DepartmentCollections | null;
};

export type DepartmentStats = {
  orders: { total: number; active: number; completed: number; cancelled: number };
  items: { total: number; byStatus: Record<ItemWorkStatus, number> };
  /** Pieces of active orders' items not yet ready. */
  pendingPieces: number;
  /** Ready, not yet delivered. */
  readyNotDelivered: number;
  /** Null without the money switch. */
  money: DepartmentMoney | null;
};

/** Work statistics of a department (or of items with no department when `departmentId` is null). */
async function computeWorkStats(db: DbClient, departmentId: string | null, includeHidden: boolean): Promise<Omit<DepartmentStats, "money">> {
  const itemWhere = departmentId ? departmentItemWhere(departmentId, includeHidden) : { departmentId: null, order: { archivedAt: null } };
  const orderWhere = departmentId ? departmentOrderWhere(departmentId, includeHidden) : { archivedAt: null, groups: { some: { departmentId: null } } };
  const [byStatus, items] = await Promise.all([
    db.order.groupBy({ by: ["status"], where: orderWhere, _count: { _all: true } }),
    db.orderGroup.findMany({ where: itemWhere, select: { id: true, quantity: true, order: { select: { status: true } } } }),
  ]);
  const count = (s: OrderStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const counters = await itemCounters(db, items);
  const statusCount: Record<ItemWorkStatus, number> = { NOT_STARTED: 0, IN_PRODUCTION: 0, READY: 0, DELIVERED: 0, CANCELLED: 0 };
  let pendingPieces = 0;
  let readyNotDelivered = 0;
  for (const item of items) {
    const c = counters.get(item.id)!;
    statusCount[workStatus(item.order.status, c)] += 1;
    if (OPEN_ORDER_STATUSES.includes(item.order.status)) {
      pendingPieces += Math.max(0, c.quantity - c.ready);
      readyNotDelivered += Math.max(0, c.ready - c.delivered);
    }
  }
  return {
    orders: { total: byStatus.reduce((s, r) => s + r._count._all, 0), active: count("NEW") + count("IN_PROGRESS"), completed: count("COMPLETED"), cancelled: count("CANCELLED") },
    items: { total: items.length, byStatus: statusCount },
    pendingPieces,
    readyNotDelivered,
  };
}

function toMoney(summary: DepartmentFinanceSummary, withCollections: boolean): DepartmentMoney {
  return {
    workValue: centsToDecimalString(summary.workValue),
    unreliableItems: summary.unreliableItems,
    collections: withCollections
      ? { basis: COLLECTIONS_BASIS, collected: centsToDecimalString(summary.collected), outstanding: centsToDecimalString(summary.outstanding), orders: summary.orders }
      : null,
  };
}

/** Money of one department as the grant allows (null without the money switch). */
async function departmentFinance(db: DbClient, grant: DepartmentGrant): Promise<{ summary: DepartmentFinanceSummary; finances: OrderFinance[] } | null> {
  if (!grant.canViewMoney) return null;
  const finances = await loadOrderFinances(db, departmentMoneyOrderWhere(grant.departmentId, grant.includeHidden));
  return { summary: summarizeBucket(finances, grant.departmentId), finances };
}

// ───────────────────────────── Lists ─────────────────────────────

/** The departments this actor may open (navigation, department chooser). */
export async function listMyDepartments(db: DbClient, actor: Actor): Promise<DepartmentGrant[]> {
  return departmentGrants(db, actor);
}

/** Active departments offered in the order form (names only). */
export async function listDepartmentOptions(db: DbClient, actor: Actor): Promise<DepartmentOption[]> {
  if (!isOwner(actor)) assertPermission(actor, "orders:view");
  return db.department.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, key: true, name: true } });
}

// ───────────────────────────── Department dashboard ─────────────────────────────

/** One department item as a department member sees it. */
export type DepartmentItemRow = {
  id: string;
  label: string;
  quantity: number;
  ready: number;
  delivered: number;
  status: ItemWorkStatus;
};

export type DepartmentOrderMoney = {
  /** The department's priced work in this order (its items / split shares). */
  value: string;
  /** Collections switch only. */
  collected?: string;
  outstanding?: string;
  status?: ShareStatus;
};

export type DepartmentOrderRow = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  receivedDate: string;
  deliveryDate: string;
  orderStatus: OrderStatus;
  overdue: boolean;
  unit: QuantityUnit;
  /** This department's items only. */
  items: DepartmentItemRow[];
  /** Money switch only. Never the order total. */
  money?: DepartmentOrderMoney;
};

export type DepartmentActivity = {
  kind: "STAGE" | "READY" | "DELIVERY";
  at: Date;
  quantity: number;
  orderId: string;
  orderNumber: number;
  itemLabel: string;
};

export type CollectionHistoryRow = { paidAt: string; orderId: string; orderNumber: number; orderTitle: string; amount: string; isAdvance: boolean };

export type DepartmentDashboard = {
  department: { id: string; name: string; isActive: boolean };
  access: { canViewMoney: boolean; canRecordProduction: boolean; canViewCollections: boolean; canViewSettlements: boolean };
  stats: DepartmentStats;
  recentOrders: DepartmentOrderRow[];
  activity: DepartmentActivity[];
  /** Latest allocated collections (collections switch only). */
  collectionHistory: CollectionHistoryRow[] | null;
};

const ROW_ORDER_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  unit: true,
  receivedDate: true,
  deliveryDate: true,
  customer: { select: { name: true } },
} as const;

function orderMoney(summary: DepartmentFinanceSummary | undefined, orderId: string, grant: DepartmentGrant): DepartmentOrderMoney | undefined {
  if (!summary) return undefined;
  const m = summary.perOrder.get(orderId);
  const value = m?.value ?? 0n;
  const collected = m?.collected ?? 0n;
  return {
    value: centsToDecimalString(value),
    ...(grant.canViewCollections ? { collected: centsToDecimalString(collected), outstanding: centsToDecimalString(value - collected), status: m?.status ?? "UNPAID" } : {}),
  };
}

async function buildOrderRows(
  db: DbClient,
  grant: DepartmentGrant,
  orders: { id: string; number: number; title: string; status: OrderStatus; unit: QuantityUnit; receivedDate: Date; deliveryDate: Date; customer: { name: string } }[],
  summary?: DepartmentFinanceSummary,
): Promise<DepartmentOrderRow[]> {
  const items = await db.orderGroup.findMany({
    where: { departmentId: grant.departmentId, orderId: { in: orders.map((o) => o.id) } },
    orderBy: { position: "asc" },
    select: { id: true, orderId: true, position: true, name: true, quantity: true },
  });
  const counters = await itemCounters(db, items);
  const today = todayDateString();
  return orders.map((o) => {
    const deliveryDate = dateToString(o.deliveryDate);
    const money = orderMoney(summary, o.id, grant);
    return {
      orderId: o.id,
      number: o.number,
      title: o.title,
      customerName: o.customer.name,
      receivedDate: dateToString(o.receivedDate),
      deliveryDate,
      orderStatus: o.status,
      overdue: OPEN_ORDER_STATUSES.includes(o.status) && deliveryDate < today,
      unit: o.unit,
      items: items
        .filter((i) => i.orderId === o.id)
        .map((i) => {
          const c = counters.get(i.id)!;
          return { id: i.id, label: itemLabel(i.position, i.name), quantity: i.quantity, ready: c.ready, delivered: c.delivered, status: workStatus(o.status, c) };
        }),
      ...(money ? { money } : {}),
    };
  });
}

function historyRows(summary: DepartmentFinanceSummary, limit: number): CollectionHistoryRow[] {
  return summary.history.slice(0, limit).map((h) => ({ paidAt: h.paidAt, orderId: h.orderId, orderNumber: h.orderNumber, orderTitle: h.orderTitle, amount: centsToDecimalString(h.amount), isAdvance: h.isAdvance }));
}

export async function getDepartmentDashboard(db: DbClient, actor: Actor, departmentId: string): Promise<DepartmentDashboard> {
  const grant = await requireDepartment(db, actor, departmentId, "work");
  const hidden = grant.includeHidden;
  const [work, finance, recent, stage, ready, delivered] = await Promise.all([
    computeWorkStats(db, departmentId, hidden),
    departmentFinance(db, grant),
    db.order.findMany({ where: departmentOrderWhere(departmentId, hidden), orderBy: [{ receivedDate: "desc" }, { createdAt: "desc" }, { number: "desc" }], take: 6, select: ROW_ORDER_SELECT }),
    db.productionStageProgress.findMany({ where: { voidedAt: null, orderGroup: departmentItemWhere(departmentId, hidden) }, orderBy: { createdAt: "desc" }, take: 8, select: ACTIVITY_SELECT }),
    db.productionReady.findMany({ where: { voidedAt: null, orderGroup: departmentItemWhere(departmentId, hidden) }, orderBy: { createdAt: "desc" }, take: 8, select: ACTIVITY_SELECT }),
    db.delivery.findMany({ where: { voidedAt: null, orderGroup: departmentItemWhere(departmentId, hidden) }, orderBy: { createdAt: "desc" }, take: 8, select: ACTIVITY_SELECT }),
  ]);
  const activity = [
    ...stage.map((r) => toActivity("STAGE", r)),
    ...ready.map((r) => toActivity("READY", r)),
    ...delivered.map((r) => toActivity("DELIVERY", r)),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10);
  return {
    department: { id: grant.departmentId, name: grant.name, isActive: grant.isActive },
    access: { canViewMoney: grant.canViewMoney, canRecordProduction: grant.canRecordProduction, canViewCollections: grant.canViewCollections, canViewSettlements: grant.canViewSettlements },
    stats: { ...work, money: finance ? toMoney(finance.summary, grant.canViewCollections) : null },
    recentOrders: await buildOrderRows(db, grant, recent, finance?.summary),
    activity,
    collectionHistory: finance && grant.canViewCollections ? historyRows(finance.summary, 15) : null,
  };
}

const ACTIVITY_SELECT = {
  createdAt: true,
  quantity: true,
  orderId: true,
  orderGroup: { select: { position: true, name: true, order: { select: { number: true } } } },
} as const;

function toActivity(kind: DepartmentActivity["kind"], r: { createdAt: Date; quantity: number; orderId: string; orderGroup: { position: number; name: string | null; order: { number: number } } }): DepartmentActivity {
  return { kind, at: r.createdAt, quantity: r.quantity, orderId: r.orderId, orderNumber: r.orderGroup.order.number, itemLabel: itemLabel(r.orderGroup.position, r.orderGroup.name) };
}

/** Full allocated-collections history of a department (collections switch). */
export async function getDepartmentCollections(db: DbClient, actor: Actor, departmentId: string): Promise<{ department: DepartmentGrant; money: DepartmentMoney; history: CollectionHistoryRow[] }> {
  const grant = await requireDepartment(db, actor, departmentId, "collections");
  const finance = (await departmentFinance(db, grant))!;
  return { department: grant, money: toMoney(finance.summary, true), history: historyRows(finance.summary, 500) };
}

// ───────────────────────────── Department orders ─────────────────────────────

export type DepartmentOrderFilter = "open" | "completed" | "all";
export const DEPARTMENT_ORDERS_PAGE_SIZE = 20;

export async function listDepartmentOrders(
  db: DbClient,
  actor: Actor,
  departmentId: string,
  options: { filter?: DepartmentOrderFilter; page?: number; query?: string } = {},
): Promise<{ department: DepartmentGrant; items: DepartmentOrderRow[]; total: number; page: number; pageCount: number }> {
  const grant = await requireDepartment(db, actor, departmentId, "work");
  const filter = options.filter ?? "open";
  const q = (options.query ?? "").trim().slice(0, 100);
  const numberMatch = /^#?0*(\d{1,9})$/.exec(q);
  const where = {
    AND: [
      departmentOrderWhere(departmentId, grant.includeHidden),
      filter === "open" ? { status: { in: [...OPEN_ORDER_STATUSES] } } : filter === "completed" ? { status: "COMPLETED" as const } : {},
      q
        ? {
            OR: [
              ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
              { title: { contains: q, mode: "insensitive" as const } },
              { customer: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {},
    ],
  };
  const total = await db.order.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / DEPARTMENT_ORDERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount);
  const orders = await db.order.findMany({
    where,
    orderBy: filter === "open" ? [{ deliveryDate: "asc" }, { number: "asc" }] : [{ receivedDate: "desc" }, { createdAt: "desc" }, { number: "desc" }],
    skip: (page - 1) * DEPARTMENT_ORDERS_PAGE_SIZE,
    take: DEPARTMENT_ORDERS_PAGE_SIZE,
    select: ROW_ORDER_SELECT,
  });
  let summary: DepartmentFinanceSummary | undefined;
  if (grant.canViewMoney && orders.length > 0) {
    summary = summarizeBucket(await loadOrderFinances(db, { id: { in: orders.map((o) => o.id) } }), departmentId);
  }
  return { department: grant, items: await buildOrderRows(db, grant, orders, summary), total, page, pageCount };
}

/** One department item with its production detail (no money unless allowed). */
export type DepartmentOrderItem = GroupProgress & {
  material: string;
  notes: string | null;
  status: ItemWorkStatus;
  /** Money switch only: unit price, and this department's part of the item's value (null = can't be allocated reliably). */
  unitPrice?: string | null;
  value?: string | null;
  /** True when the owner split this item's value with other departments. */
  split?: boolean;
};

export type DepartmentOrderDetails = {
  department: DepartmentGrant;
  order: { id: string; number: number; title: string; customerName: string; receivedDate: string; deliveryDate: string; status: OrderStatus; overdue: boolean; unit: QuantityUnit };
  items: DepartmentOrderItem[];
  /** Money switch only: shares of OTHER departments' items split to this department (label + share). */
  sharedWork?: { label: string; value: string }[];
  /** Money switch only. NOT the order total. */
  money?: DepartmentOrderMoney & { allocations?: { paidAt: string; amount: string; isAdvance: boolean }[] };
};

/**
 * One order as the department sees it: header + ONLY its items. NOT_FOUND when
 * the order is hidden, archived, hidden from departments (non-owners) or has
 * no item of this department.
 */
export async function getDepartmentOrder(db: DbClient, actor: Actor, departmentId: string, orderId: string): Promise<DepartmentOrderDetails> {
  const grant = await requireDepartment(db, actor, departmentId, "work");
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const order = await db.order.findFirst({ where: { AND: [{ id: orderId }, departmentOrderWhere(departmentId, grant.includeHidden)] }, select: ROW_ORDER_SELECT });
  if (!order) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const money = grant.canViewMoney;
  const [progress, rows, finance] = await Promise.all([
    loadGroupProgress(db, order.id),
    db.orderGroup.findMany({ where: { orderId: order.id, departmentId }, select: { id: true, material: true, notes: true, unitPrice: money } }),
    money ? loadOrderFinances(db, { id: order.id }) : Promise.resolve([]),
  ]);
  const f = finance[0];
  const extra = new Map(rows.map((r) => [r.id, r]));
  const partFor = (itemId: string): { value: bigint | null; split: boolean } => {
    const a = f?.items.find((i) => i.id === itemId)?.attribution;
    if (!a || a.kind === "unallocated") return { value: null, split: false };
    if (a.kind === "department") return { value: a.departmentId === departmentId ? a.value : 0n, split: false };
    return { value: a.parts.filter((p) => p.departmentId === departmentId).reduce((s, p) => s + p.value, 0n), split: true };
  };
  const items = progress
    .filter((g) => g.departmentId === departmentId && extra.has(g.id))
    .map((g): DepartmentOrderItem => {
      const r = extra.get(g.id)! as { material: string; notes: string | null; unitPrice?: { toString(): string } | null };
      const worked = Math.max(0, ...Object.values(g.stage).map((x) => x ?? 0), ...Object.values(g.design));
      const part = money ? partFor(g.id) : null;
      return {
        ...g,
        material: r.material,
        notes: r.notes,
        status: workStatus(order.status, { quantity: g.quantity, worked, ready: g.ready, delivered: g.delivered }),
        ...(part
          ? { unitPrice: r.unitPrice == null || f?.pricing !== "PER_ITEM" ? null : centsToDecimalString(toCents(r.unitPrice)), value: part.value === null ? null : centsToDecimalString(part.value), split: part.split }
          : {}),
      };
    });
  let result: DepartmentOrderDetails = {
    department: grant,
    order: {
      id: order.id,
      number: order.number,
      title: order.title,
      customerName: order.customer.name,
      receivedDate: dateToString(order.receivedDate),
      deliveryDate: dateToString(order.deliveryDate),
      status: order.status,
      overdue: OPEN_ORDER_STATUSES.includes(order.status) && dateToString(order.deliveryDate) < todayDateString(),
      unit: order.unit,
    },
    items,
  };
  if (money && f) {
    const sharedWork = f.items
      .filter((i) => i.departmentId !== departmentId && i.attribution.kind === "split" && i.attribution.parts.some((p) => p.departmentId === departmentId))
      .map((i) => ({ label: itemLabel(i.position, i.name), value: centsToDecimalString((i.attribution as { parts: { departmentId: string; value: bigint }[] }).parts.filter((p) => p.departmentId === departmentId).reduce((s, p) => s + p.value, 0n)) }));
    const summary = summarizeBucket([f], departmentId);
    const m = orderMoney(summary, order.id, grant)!;
    const allocations = grant.canViewCollections ? (summary.perOrder.get(order.id)?.allocations ?? []).map((a) => ({ paidAt: a.paidAt, amount: centsToDecimalString(a.amount), isAdvance: a.isAdvance })) : undefined;
    result = { ...result, sharedWork, money: { ...m, ...(allocations ? { allocations } : {}) } };
  }
  return result;
}

// ───────────────────────────── Department production (members) ─────────────────────────────

/** Department items as the production form needs them: progress only, no money. */
export function productionGroups(items: DepartmentOrderItem[]): GroupProgress[] {
  return items.map((item) => {
    const g: Partial<DepartmentOrderItem> = { ...item };
    delete g.unitPrice;
    delete g.value;
    delete g.split;
    delete g.material;
    delete g.notes;
    delete g.status;
    return g as GroupProgress;
  });
}

/** «تسجيل إنتاج» from a department view: membership-authorized, the department's items only, audited. */
export function recordDepartmentStage(db: PrismaClient, actor: Actor, departmentId: string, payload: RecordStagePayload) {
  return recordStageProgress(db, actor, payload, { departmentId });
}

export function recordDepartmentReady(db: PrismaClient, actor: Actor, departmentId: string, payload: RecordReadyPayload) {
  return recordReady(db, actor, payload, { departmentId });
}

// ───────────────────────────── Owner overview ─────────────────────────────

export type DepartmentOverviewRow = {
  id: string;
  name: string;
  isActive: boolean;
  members: number;
  stats: DepartmentStats & { money: DepartmentMoney };
};

export type DepartmentsOverview = {
  departments: DepartmentOverviewRow[];
  /** Items with no department (should stay empty; never hidden). */
  unassigned: Omit<DepartmentStats, "money">;
  /** Value and collections that can't be attributed reliably to a department. */
  unallocated: { value: string; collected: string };
  /**
   * Reconciliation (non-archived orders):
   *   Σ department values + unallocated value = Σ order totals (non-cancelled)
   *   Σ department collections + unallocated collections = Σ valid customer payments
   */
  totals: {
    departmentsValue: string;
    ordersTotal: string;
    departmentsCollected: string;
    paymentsTotal: string;
    valueBalanced: boolean;
    collectionsBalanced: boolean;
  };
};

export async function getDepartmentsOverview(db: DbClient, actor: Actor): Promise<DepartmentsOverview> {
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
  const departments = await db.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, _count: { select: { members: true } } },
  });
  const [finances, work, unassigned] = await Promise.all([
    loadOrderFinances(db, { archivedAt: null }),
    Promise.all(departments.map((d) => computeWorkStats(db, d.id, true))),
    computeWorkStats(db, null, true),
  ]);
  let depValue = 0n;
  let depCollected = 0n;
  const rows = departments.map((d, i) => {
    const s = summarizeBucket(finances, d.id);
    depValue += s.workValue;
    depCollected += s.collected;
    return { id: d.id, name: d.name, isActive: d.isActive, members: d._count.members, stats: { ...work[i]!, money: toMoney(s, true) } };
  });
  const un = summarizeBucket(finances, UNALLOCATED);
  const ordersTotal = finances.filter((f) => f.status !== "CANCELLED").reduce((s, f) => s + f.total, 0n);
  const paymentsTotal = finances.reduce((s, f) => s + f.paid, 0n);
  return {
    departments: rows,
    unassigned,
    unallocated: { value: centsToDecimalString(un.workValue), collected: centsToDecimalString(un.collected) },
    totals: {
      departmentsValue: centsToDecimalString(depValue),
      ordersTotal: centsToDecimalString(ordersTotal),
      departmentsCollected: centsToDecimalString(depCollected),
      paymentsTotal: centsToDecimalString(paymentsTotal),
      valueBalanced: depValue + un.workValue === ordersTotal,
      collectionsBalanced: depCollected + un.collected === paymentsTotal,
    },
  };
}

// ───────────────────────────── Owner: departments & memberships ─────────────────────────────

const SOURCE = "web:departments";

function requireOwner(actor: Actor) {
  assertPermission(actor, "users:manage");
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
}

const nameSchema = z.string({ error: "اكتب اسم القسم" }).trim().min(2, "اكتب اسم القسم").max(80, "الاسم طويل جدًا");

function bad(field: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [field]: [message] } });
}

/** Adds a department (no code change needed). Owner only, audited. */
export async function createDepartment(db: PrismaClient, actor: Actor, payload: { name: unknown }) {
  requireOwner(actor);
  const parsed = nameSchema.safeParse(payload.name);
  if (!parsed.success) bad("name", parsed.error.issues[0]!.message);
  const name = parsed.data;
  return db.$transaction(async (tx) => {
    if (await tx.department.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) bad("name", "في قسم بنفس الاسم");
    const last = await tx.department.aggregate({ _max: { sortOrder: true } });
    const dep = await tx.department.create({ data: { name, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.id }, select: { id: true } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.DEPARTMENT_CREATED, entityType: "Department", entityId: dep.id, metadata: { name, source: SOURCE } });
    return { departmentId: dep.id };
  });
}

/** Rename / activate / deactivate. A deactivated department keeps its items; members lose access to it. */
export async function updateDepartment(db: PrismaClient, actor: Actor, payload: { departmentId: unknown; name?: unknown; isActive?: unknown }) {
  requireOwner(actor);
  const id = z.uuid().safeParse(payload.departmentId);
  if (!id.success) throw new AppError("NOT_FOUND", "القسم مش موجود");
  return db.$transaction(async (tx) => {
    const before = await tx.department.findUnique({ where: { id: id.data }, select: { name: true, isActive: true } });
    if (!before) throw new AppError("NOT_FOUND", "القسم مش موجود");
    const data: { name?: string; isActive?: boolean } = {};
    if (payload.name !== undefined) {
      const parsed = nameSchema.safeParse(payload.name);
      if (!parsed.success) bad("name", parsed.error.issues[0]!.message);
      if (parsed.data !== before.name) {
        if (await tx.department.findFirst({ where: { id: { not: id.data }, name: { equals: parsed.data, mode: "insensitive" } }, select: { id: true } })) bad("name", "في قسم بنفس الاسم");
        data.name = parsed.data;
      }
    }
    if (payload.isActive !== undefined) {
      if (typeof payload.isActive !== "boolean") bad("isActive", "قيمة غير صحيحة");
      if (payload.isActive !== before.isActive) data.isActive = payload.isActive;
    }
    if (Object.keys(data).length === 0) return { changed: false };
    await tx.department.update({ where: { id: id.data }, data });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.DEPARTMENT_UPDATED,
      entityType: "Department",
      entityId: id.data,
      metadata: { changes: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { from: before[k as keyof typeof before], to: v }])), source: SOURCE },
    });
    return { changed: true };
  });
}

export type MembershipView = {
  departmentId: string;
  departmentName: string;
  departmentActive: boolean;
  canViewWork: boolean;
  canViewMoney: boolean;
  canRecordProduction: boolean;
  canViewCollections: boolean;
  canViewSettlements: boolean;
};

/** Departments with their members (owner screen). */
export async function listDepartmentsForAdmin(db: DbClient, actor: Actor) {
  requireOwner(actor);
  return db.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      isActive: true,
      members: { orderBy: { user: { name: "asc" } }, select: { canViewWork: true, canViewMoney: true, canRecordProduction: true, canViewCollections: true, canViewSettlements: true, user: { select: { id: true, name: true, role: true, isActive: true } } } },
      _count: { select: { items: true } },
    },
  });
}

/** One account's department access (users page). */
export async function getAccountDepartments(db: DbClient, actor: Actor, userId: string): Promise<{ all: { id: string; name: string; isActive: boolean }[]; memberships: MembershipView[] }> {
  requireOwner(actor);
  const [all, rows] = await Promise.all([
    db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    z.uuid().safeParse(userId).success
      ? db.departmentMember.findMany({ where: { userId }, select: { canViewWork: true, canViewMoney: true, canRecordProduction: true, canViewCollections: true, canViewSettlements: true, department: { select: { id: true, name: true, isActive: true, sortOrder: true } } } })
      : Promise.resolve([]),
  ]);
  return {
    all,
    memberships: rows
      .sort((a, b) => a.department.sortOrder - b.department.sortOrder)
      .map((r) => ({
        departmentId: r.department.id,
        departmentName: r.department.name,
        departmentActive: r.department.isActive,
        canViewWork: r.canViewWork,
        canViewMoney: r.canViewMoney,
        canRecordProduction: r.canRecordProduction,
        canViewCollections: r.canViewCollections,
        canViewSettlements: r.canViewSettlements,
      })),
  };
}

const membershipSchema = z.object({
  userId: z.uuid(),
  departmentId: z.uuid(),
  canViewWork: z.boolean(),
  canViewMoney: z.boolean(),
  canRecordProduction: z.boolean(),
  /** Allocated customer collections (takes effect only with canViewMoney). */
  canViewCollections: z.boolean().default(false),
  /** Own partner settlement for this department. */
  canViewSettlements: z.boolean().default(false),
});

/** The account a membership is changed for: STAFF or PARTNER, never an owner, never yourself. */
async function memberTarget(tx: DbClient, actor: Actor, userId: string) {
  if (userId === actor.id) throw new AppError("FORBIDDEN", "مينفعش تعدّل صلاحيات حسابك إنت.");
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!user) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  if (user.role !== "STAFF" && user.role !== "PARTNER") throw new AppError("FORBIDDEN", "حساب المدير بيشوف كل الأقسام دايمًا.");
  return user;
}

/**
 * Grants or changes an account's access to a department. Work, money and
 * production recording are independent switches; work off = no access at all
 * (the row is kept so the owner can switch it back on). Owner only, audited.
 */
export async function setDepartmentMembership(db: PrismaClient, actor: Actor, payload: unknown) {
  requireOwner(actor);
  const parsed = membershipSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const user = await memberTarget(tx, actor, input.userId);
    const dep = await tx.department.findUnique({ where: { id: input.departmentId }, select: { name: true } });
    if (!dep) throw new AppError("NOT_FOUND", "القسم مش موجود");
    const before = await tx.departmentMember.findUnique({
      where: { departmentId_userId: { departmentId: input.departmentId, userId: input.userId } },
      select: { canViewWork: true, canViewMoney: true, canRecordProduction: true, canViewCollections: true, canViewSettlements: true },
    });
    const after = {
      canViewWork: input.canViewWork,
      canViewMoney: input.canViewMoney,
      canRecordProduction: input.canRecordProduction,
      canViewCollections: input.canViewCollections,
      canViewSettlements: input.canViewSettlements,
    };
    if (before && (Object.keys(after) as (keyof typeof after)[]).every((k) => before[k] === after[k])) return { changed: false };
    await tx.departmentMember.upsert({
      where: { departmentId_userId: { departmentId: input.departmentId, userId: input.userId } },
      create: { departmentId: input.departmentId, userId: input.userId, grantedById: actor.id, ...after },
      update: { ...after, grantedById: actor.id },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.DEPARTMENT_ACCESS_CHANGED,
      entityType: "User",
      entityId: input.userId,
      metadata: { email: user.email, role: user.role, departmentId: input.departmentId, department: dep.name, before, after, source: SOURCE },
    });
    return { changed: true };
  });
}

/** Removes an account's access to a department entirely. Applies on the next request. */
export async function revokeDepartmentMembership(db: PrismaClient, actor: Actor, payload: { userId: unknown; departmentId: unknown }) {
  requireOwner(actor);
  const userId = z.uuid().safeParse(payload.userId);
  const departmentId = z.uuid().safeParse(payload.departmentId);
  if (!userId.success || !departmentId.success) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  return db.$transaction(async (tx) => {
    const user = await memberTarget(tx, actor, userId.data);
    const { count } = await tx.departmentMember.deleteMany({ where: { userId: userId.data, departmentId: departmentId.data } });
    if (count === 0) return { changed: false };
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.DEPARTMENT_ACCESS_REVOKED,
      entityType: "User",
      entityId: userId.data,
      metadata: { email: user.email, role: user.role, departmentId: departmentId.data, source: SOURCE },
    });
    return { changed: true };
  });
}
