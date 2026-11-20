import type { Prisma } from "@/generated/prisma/client";
import { assertPermission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { dateFromString, dateToString, isValidDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { centsToDecimalString, toCents } from "@/lib/money";
import { isWorkKind, WORK_KIND_CONFIG, WORK_KINDS } from "@/lib/orders/work-kinds";
import type { Actor } from "./actor";
import { formatQuantity, parseQuantity } from "./cost-review-service";
import { orderScope } from "./order-access";

/**
 * «الخامات المستخدمة بفترات» — material consumption from cost entries that
 * record a used quantity, by their CONSUMPTION date (cost_date), never the
 * time the row was created.
 *
 * Grouped by material + variant + unit + supplier: quantities in different
 * units are never added together. Voided entries are excluded; amended
 * entries count with their current values (history is in the revisions).
 * Draft entries (costs not closed yet) are included and counted separately,
 * so the report reconciles with the order cost totals.
 */

/**
 * Work type of a cost entry, for filtering:
 *   - linked to an order line → that line's work kind (GARMENT for garment / ready-made lines);
 *   - linked to the whole order → the order's work kind ONLY when every line has the same one;
 *   - otherwise UNCLASSIFIED (shown as such — never guessed, never dropped).
 */
export const REPORT_KIND_GARMENT = "GARMENT";
export const REPORT_KIND_UNCLASSIFIED = "UNCLASSIFIED";
export const REPORT_KIND_LABELS: Record<string, string> = {
  ...Object.fromEntries(WORK_KINDS.map((k) => [k, WORK_KIND_CONFIG[k].label])),
  [REPORT_KIND_GARMENT]: "ملابس وشغل عادي",
  [REPORT_KIND_UNCLASSIFIED]: "غير مصنّف (أوردر فيه أكتر من نوع شغل)",
};

function entryKind(lineKind: string | null | undefined, linked: boolean, orderLineKinds: (string | null)[]): string {
  if (linked) return lineKind ?? REPORT_KIND_GARMENT;
  const kinds = new Set(orderLineKinds.map((k) => k ?? REPORT_KIND_GARMENT));
  return kinds.size === 1 ? [...kinds][0]! : REPORT_KIND_UNCLASSIFIED;
}

export type MaterialFilters = { from: string; to: string; material?: string; supplierId?: string; workKind?: string; orderId?: string };

export type MaterialRow = {
  key: string;
  materialName: string;
  materialVariant: string | null;
  unit: string;
  supplier: { id: string; name: string } | null;
  /** Σ used quantity (exact, up to 3 decimals). */
  quantity: string;
  /** Σ cost of these entries. */
  total: string;
  /** Of which still drafts (costs not closed). */
  draftTotal: string;
  unitCosts: string[];
  /** Work types the entries come from (see entryKind). */
  workKinds: string[];
  firstDate: string;
  lastDate: string;
  /** Per order: its quantity / cost, and how much of it is still DRAFT (not booked to the supplier yet). */
  orders: { id: string; number: number; title: string; quantity: string; total: string; draftTotal: string; dates: string[] }[];
};

export async function getMaterialConsumption(db: DbClient, actor: Actor, filters: MaterialFilters): Promise<{ rows: MaterialRow[]; totals: { entries: number; total: string } }> {
  assertPermission(actor, "costs:view");
  if (!isValidDateString(filters.from) || !isValidDateString(filters.to) || filters.from > filters.to) throw new AppError("VALIDATION_ERROR", "اختار فترة صحيحة");
  const where: Prisma.OrderCostWhereInput = {
    voidedAt: null,
    usageQuantity: { not: null },
    costDate: { gte: dateFromString(filters.from), lte: dateFromString(filters.to) },
    order: { AND: [orderScope(actor), { archivedAt: null }] },
    ...(filters.material ? { materialName: { contains: filters.material.trim().slice(0, 120), mode: "insensitive" } } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.orderId ? { orderId: filters.orderId } : {}),
  };
  const kindFilter = filters.workKind && (isWorkKind(filters.workKind) || filters.workKind === REPORT_KIND_GARMENT || filters.workKind === REPORT_KIND_UNCLASSIFIED) ? filters.workKind : undefined;
  const entries = await db.orderCost.findMany({
    where,
    orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
    select: {
      materialName: true,
      materialVariant: true,
      description: true,
      usageQuantity: true,
      usageUnit: true,
      usageUnitCost: true,
      amount: true,
      costDate: true,
      isDraft: true,
      orderGroupId: true,
      orderGroup: { select: { workKind: true } },
      supplier: { select: { id: true, name: true } },
      order: { select: { id: true, number: true, title: true, groups: { select: { workKind: true } } } },
    },
  });
  const classified = entries.map((e) => ({ ...e, kind: entryKind(e.orderGroup?.workKind, e.orderGroupId !== null, e.order.groups.map((g) => g.workKind)) }));
  const selected = kindFilter ? classified.filter((e) => e.kind === kindFilter) : classified;
  type Acc = Omit<MaterialRow, "quantity" | "total" | "draftTotal" | "orders" | "unitCosts" | "workKinds"> & {
    qty: bigint;
    total: bigint;
    draft: bigint;
    unitCosts: Set<string>;
    kinds: Set<string>;
    orders: Map<string, { id: string; number: number; title: string; qty: bigint; total: bigint; draft: bigint; dates: Set<string> }>;
  };
  const groups = new Map<string, Acc>();
  let grand = 0n;
  for (const e of selected) {
    const name = e.materialName?.trim() || e.description?.trim() || "من غير اسم";
    const unit = e.usageUnit!;
    const key = [name.toLowerCase(), (e.materialVariant ?? "").toLowerCase(), unit, e.supplier?.id ?? ""].join("|");
    const date = dateToString(e.costDate);
    const qty = parseQuantity(e.usageQuantity!.toString())!;
    const amount = toCents(e.amount);
    grand += amount;
    let g = groups.get(key);
    if (!g) {
      g = { key, materialName: name, materialVariant: e.materialVariant, unit, supplier: e.supplier, qty: 0n, total: 0n, draft: 0n, unitCosts: new Set(), kinds: new Set(), firstDate: date, lastDate: date, orders: new Map() };
      groups.set(key, g);
    }
    g.qty += qty;
    g.total += amount;
    if (e.isDraft) g.draft += amount;
    g.kinds.add(e.kind);
    if (e.usageUnitCost !== null) g.unitCosts.add(centsToDecimalString(toCents(e.usageUnitCost)));
    if (date < g.firstDate) g.firstDate = date;
    if (date > g.lastDate) g.lastDate = date;
    const o = g.orders.get(e.order.id) ?? { id: e.order.id, number: e.order.number, title: e.order.title, qty: 0n, total: 0n, draft: 0n, dates: new Set<string>() };
    o.qty += qty;
    o.total += amount;
    if (e.isDraft) o.draft += amount;
    o.dates.add(date);
    g.orders.set(e.order.id, o);
  }
  const rows = [...groups.values()]
    .sort((a, b) => a.materialName.localeCompare(b.materialName, "ar") || (a.materialVariant ?? "").localeCompare(b.materialVariant ?? "", "ar") || a.unit.localeCompare(b.unit))
    .map((g) => ({
      key: g.key,
      materialName: g.materialName,
      materialVariant: g.materialVariant,
      unit: g.unit,
      supplier: g.supplier,
      quantity: formatQuantity(g.qty),
      total: centsToDecimalString(g.total),
      draftTotal: centsToDecimalString(g.draft),
      unitCosts: [...g.unitCosts].sort(),
      workKinds: [...g.kinds].sort(),
      firstDate: g.firstDate,
      lastDate: g.lastDate,
      orders: [...g.orders.values()].sort((a, b) => a.number - b.number).map((o) => ({ id: o.id, number: o.number, title: o.title, quantity: formatQuantity(o.qty), total: centsToDecimalString(o.total), draftTotal: centsToDecimalString(o.draft), dates: [...o.dates].sort() })),
    }));
  return { rows, totals: { entries: selected.length, total: centsToDecimalString(grand) } };
}
