import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CostCategory, CostReviewStatus, OrderStatus } from "@/generated/prisma/enums";
import { assertPermission, isOwner } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { COST_CATEGORIES } from "@/lib/finance/labels";
import { centsToDecimalString, formatMoney, MAX_CENTS, parseMoney, toCents, type Cents } from "@/lib/money";
import { itemLabel } from "@/lib/orders/labels";
import { itemWorkSummary, SALE_UNITS } from "@/lib/orders/work-kinds";
import { lockOrder } from "@/server/repositories/order-repository";
import { formatQuantity, parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { isUniqueViolation } from "@/server/repositories/prisma-errors";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import { canAccessOrder, orderScope } from "./order-access";

/**
 * «التكاليف» — cost review of every order, built on the EXISTING order-cost
 * ledger (OrderCost + OutgoingPayment + supplier balances). No second ledger.
 *
 * Status: PENDING (new order) → IN_PROGRESS (first entry) → CLOSED (owner
 * confirms the costs are complete — zero costs must be confirmed explicitly)
 * → NEEDS_REVIEW (the order changed after closing). Reopen goes back to
 * IN_PROGRESS. Null = an order created before cost tracking.
 *
 * Entries made here are DRAFTS: not a payable until the order's costs are
 * closed. Closing posts every draft once (is_draft → false, posted_at), with
 * its supplier (an existing supplier, or explicitly none). Posting is never a
 * payment. Costs recorded elsewhere (order page «إضافة تكلفة») stay posted at
 * once, as before.
 *
 * Amendments (also after closing) change the entry IN PLACE so its payments
 * stay attached, keep the full before/after + reason in order_cost_revisions,
 * and are guarded by a version check. The supplier balance (cost − valid
 * payments) moves by exactly the difference; a cost can't drop below what was
 * already paid on it, and its supplier can't change once it has payments.
 */

export const OPEN_REVIEW: CostReviewStatus[] = ["PENDING", "IN_PROGRESS", "NEEDS_REVIEW"];

export { formatQuantity, parseQuantity, usageTotalCents };

function decimalToMilli(value: { toString(): string } | null): bigint | null {
  return value === null ? null : parseQuantity(value.toString());
}

function bad(field: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [field]: [message] } });
}

function requireOwner(actor: Actor) {
  assertPermission(actor, "costs:record");
  if (!isOwner(actor)) throw new AppError("FORBIDDEN", "قفل وتعديل التكاليف للمدير بس");
}

// ───────────────────────────── Alerts ─────────────────────────────

/** An order created before cost tracking (cost_status NULL): shown for review until closed. */
export type CostAlertStatus = CostReviewStatus | "LEGACY";

export type CostAlert = {
  orderId: string;
  number: number;
  title: string;
  customerName: string;
  receivedDate: string;
  orderStatus: OrderStatus;
  costStatus: CostAlertStatus;
  entries: number;
  drafts: number;
};

/** Orders whose costs still need review (pending, in progress, or changed after closing). */
export async function listCostAlerts(db: DbClient, actor: Actor, options: { status?: CostAlertStatus | "open" } = {}): Promise<{ items: CostAlert[]; counts: Record<CostAlertStatus, number> }> {
  assertPermission(actor, "costs:view");
  const base: Prisma.OrderWhereInput = { AND: [orderScope(actor), { archivedAt: null, status: { not: "CANCELLED" } }] };
  // Open = pending / in progress / needs review, AND older orders never reviewed (NULL) — none disappear.
  const statusWhere: Prisma.OrderWhereInput =
    options.status === undefined || options.status === "open"
      ? { OR: [{ costStatus: { in: OPEN_REVIEW } }, { costStatus: null }] }
      : options.status === "LEGACY"
        ? { costStatus: null }
        : { costStatus: options.status };
  const [rows, grouped] = await Promise.all([
    db.order.findMany({
      where: { AND: [base, statusWhere] },
      orderBy: [{ receivedDate: "asc" }, { number: "asc" }],
      take: 200,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        costStatus: true,
        receivedDate: true,
        customer: { select: { name: true } },
        costs: { where: { voidedAt: null }, select: { isDraft: true } },
      },
    }),
    db.order.groupBy({ by: ["costStatus"], where: base, _count: { _all: true } }),
  ]);
  const counts: Record<CostAlertStatus, number> = { PENDING: 0, IN_PROGRESS: 0, CLOSED: 0, NEEDS_REVIEW: 0, LEGACY: 0 };
  for (const g of grouped) counts[g.costStatus ?? "LEGACY"] = g._count._all;
  return {
    counts,
    items: rows.map((o) => ({
      orderId: o.id,
      number: o.number,
      title: o.title,
      customerName: o.customer.name,
      receivedDate: dateToString(o.receivedDate),
      orderStatus: o.status,
      costStatus: o.costStatus ?? "LEGACY",
      entries: o.costs.length,
      drafts: o.costs.filter((c) => c.isDraft).length,
    })),
  };
}

// ───────────────────────────── Workspace ─────────────────────────────

export type CostEntryView = {
  id: string;
  version: number;
  draft: boolean;
  voided: boolean;
  category: CostCategory;
  itemId: string | null;
  itemLabel: string | null;
  materialName: string | null;
  materialVariant: string | null;
  usageQuantity: string | null;
  usageUnit: string | null;
  usageUnitCost: string | null;
  amount: string;
  paid: string;
  supplier: { id: string; name: string } | null;
  costDate: string;
  description: string | null;
  notes: string | null;
  revisions: { at: Date; reason: string; byName: string; before: unknown; after: unknown }[];
};

export type CostWorkspace = {
  order: { id: string; number: number; title: string; customerName: string; receivedDate: string; status: OrderStatus; costStatus: CostReviewStatus | null; costVersion: number; reviewedAt: Date | null; reviewedByName: string | null };
  items: { id: string; label: string; quantity: number; work: string | null; departmentName: string | null }[];
  entries: CostEntryView[];
  totals: { posted: string; draft: string; paid: string };
};

export async function getCostWorkspace(db: DbClient, actor: Actor, orderId: string): Promise<CostWorkspace | null> {
  assertPermission(actor, "costs:view");
  if (!(await canAccessOrder(db, actor, orderId))) return null;
  const o = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      receivedDate: true,
      costStatus: true,
      costVersion: true,
      costReviewedAt: true,
      costReviewedById: true,
      customer: { select: { name: true } },
      groups: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          name: true,
          quantity: true,
          department: { select: { name: true } },
          workKind: true, variant: true, variantText: true, threadColor: true, saleUnit: true, pricingBasis: true, fileWidthMm: true, fileLengthMm: true, copiesPerRow: true, rollWidthMm: true, billableLengthMm: true, measuredQuantity: true,
        },
      },
      costs: {
        orderBy: [{ costDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          version: true,
          isDraft: true,
          voidedAt: true,
          category: true,
          orderGroupId: true,
          materialName: true,
          materialVariant: true,
          usageQuantity: true,
          usageUnit: true,
          usageUnitCost: true,
          amount: true,
          costDate: true,
          description: true,
          notes: true,
          supplier: { select: { id: true, name: true } },
          payments: { where: { voidedAt: null }, select: { amount: true } },
          revisions: { orderBy: { version: "asc" }, select: { createdAt: true, reason: true, before: true, after: true, changedBy: { select: { name: true } } } },
        },
      },
    },
  });
  const reviewer = o.costReviewedById ? await db.user.findUnique({ where: { id: o.costReviewedById }, select: { name: true } }) : null;
  const labels = new Map(o.groups.map((g) => [g.id, itemLabel(g.position, g.name)]));
  let posted = 0n;
  let draft = 0n;
  let paidAll = 0n;
  const entries = o.costs.map((c): CostEntryView => {
    const amount = toCents(c.amount);
    const paid = c.payments.reduce((s, p) => s + toCents(p.amount), 0n);
    if (!c.voidedAt) {
      if (c.isDraft) draft += amount;
      else posted += amount;
      paidAll += paid;
    }
    const q = decimalToMilli(c.usageQuantity);
    return {
      id: c.id,
      version: c.version,
      draft: c.isDraft,
      voided: c.voidedAt !== null,
      category: c.category,
      itemId: c.orderGroupId,
      itemLabel: c.orderGroupId ? (labels.get(c.orderGroupId) ?? null) : null,
      materialName: c.materialName,
      materialVariant: c.materialVariant,
      usageQuantity: q === null ? null : formatQuantity(q),
      usageUnit: c.usageUnit,
      usageUnitCost: c.usageUnitCost === null ? null : centsToDecimalString(toCents(c.usageUnitCost)),
      amount: centsToDecimalString(amount),
      paid: centsToDecimalString(paid),
      supplier: c.supplier,
      costDate: dateToString(c.costDate),
      description: c.description,
      notes: c.notes,
      revisions: c.revisions.map((r) => ({ at: r.createdAt, reason: r.reason, byName: r.changedBy.name, before: r.before, after: r.after })),
    };
  });
  return {
    order: {
      id: o.id,
      number: o.number,
      title: o.title,
      customerName: o.customer.name,
      receivedDate: dateToString(o.receivedDate),
      status: o.status,
      costStatus: o.costStatus,
      costVersion: o.costVersion,
      reviewedAt: o.costReviewedAt,
      reviewedByName: reviewer?.name ?? null,
    },
    items: o.groups.map((g) => ({ id: g.id, label: itemLabel(g.position, g.name), quantity: g.quantity, work: itemWorkSummary({ ...g, measuredQuantity: g.measuredQuantity?.toString() ?? null }, g.quantity), departmentName: g.department?.name ?? null })),
    entries,
    totals: { posted: centsToDecimalString(posted), draft: centsToDecimalString(draft), paid: centsToDecimalString(paidAll) },
  };
}

// ───────────────────────────── Entries ─────────────────────────────

const USAGE_UNITS = SALE_UNITS.map((u) => u.code) as [string, ...string[]];

const entrySchema = z.object({
  orderId: z.uuid(),
  idempotencyKey: z.uuid(),
  orderGroupId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
  category: z.enum(COST_CATEGORIES as [string, ...string[]], { error: "اختار نوع التكلفة" }).transform((c) => c as CostCategory),
  materialName: z.string().trim().max(120, "الاسم طويل جدًا").optional().transform((v) => v || undefined),
  materialVariant: z.string().trim().max(80, "النص طويل جدًا").optional().transform((v) => v || undefined),
  usageQuantity: z.union([z.string(), z.number()]).optional(),
  usageUnit: z.enum(USAGE_UNITS).optional().or(z.literal("").transform(() => undefined)),
  usageUnitCost: z.string().optional(),
  /** Total when there is no quantity × unit cost (e.g. a job price). */
  amount: z.string().optional(),
  supplierId: z.uuid("اختار المورد من القائمة").optional().or(z.literal("").transform(() => undefined)),
  costDate: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "اختار التاريخ").refine((v) => v <= todayDateString(), "التاريخ مينفعش يكون في المستقبل"),
  description: z.string().trim().max(200).optional().transform((v) => v || undefined),
  notes: z.string().trim().max(500).optional().transform((v) => v || undefined),
});

type ParsedEntry = { usage: { quantity: bigint; unit: string; unitCost: bigint | null } | null; amount: Cents };

/** Quantity × unit cost (exact) or the typed amount; never both inconsistent. */
function parseEntryMoney(input: { usageQuantity?: string | number; usageUnit?: string; usageUnitCost?: string; amount?: string }): ParsedEntry {
  const qText = input.usageQuantity === undefined ? "" : String(input.usageQuantity).trim();
  const usage = qText === "" ? null : parseQuantity(qText);
  if (qText !== "" && (usage === null || usage <= 0n)) bad("usageQuantity", "اكتب الكمية بالأرقام (لحد 3 أرقام عشرية)");
  if (usage !== null && !input.usageUnit) bad("usageUnit", "اختار الوحدة");
  const ucText = input.usageUnitCost?.trim() ?? "";
  const unitCost = ucText === "" ? null : parseMoney(ucText);
  if (ucText !== "" && (unitCost === null || unitCost > MAX_CENTS)) bad("usageUnitCost", "اكتب تكلفة الوحدة بالأرقام");
  if (unitCost !== null && usage === null) bad("usageQuantity", "اكتب الكمية");
  const aText = input.amount?.trim() ?? "";
  const typed = aText === "" ? null : parseMoney(aText);
  if (aText !== "" && (typed === null || typed > MAX_CENTS)) bad("amount", "اكتب المبلغ بالأرقام");
  let amount: Cents;
  if (usage !== null && unitCost !== null) {
    amount = usageTotalCents(usage, unitCost);
    if (typed !== null && typed !== amount) bad("amount", `الإجمالي لازم يساوي الكمية × تكلفة الوحدة (${formatMoney(amount)})`);
  } else {
    if (typed === null) bad("amount", "اكتب الإجمالي، أو الكمية وتكلفة الوحدة");
    amount = typed;
  }
  if (amount < 0n) bad("amount", "المبلغ مينفعش يكون بالسالب");
  return { usage: usage === null ? null : { quantity: usage, unit: input.usageUnit!, unitCost }, amount };
}

async function checkRefs(tx: DbClient, orderId: string, orderGroupId: string | undefined, supplierId: string | undefined) {
  if (orderGroupId && !(await tx.orderGroup.findFirst({ where: { id: orderGroupId, orderId }, select: { id: true } }))) bad("orderGroupId", "السطر ده مش تبع الأوردر ده");
  if (supplierId && !(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) bad("supplierId", "المورد ده مش موجود");
}

/**
 * The ONE entry point for adding a cost to an order, from «التكاليف» (draft)
 * or the order page (booked at once): locks the order (serializes with close
 * / reopen / archive), checks access, and refuses an order whose costs are
 * closed — nothing can bypass the close. Returns the order's number.
 */
export async function openOrderForCost(tx: DbTransaction, actor: Actor, orderId: string): Promise<{ number: number }> {
  if (!(await lockOrder(tx, orderId)) || !(await canAccessOrder(tx, actor, orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { number: true, costStatus: true } });
  if (order.costStatus === "CLOSED") throw new AppError("CONFLICT", "تكاليف الأوردر ده مقفولة. افتحها من «التكاليف» الأول (أو عدّل سطر موجود) عشان تضيف تكلفة.");
  return { number: order.number };
}

/**
 * Booking state of a new cost row: a DRAFT (not owed yet) or BOOKED now
 * (a supplier payable from this moment, with its booking time).
 */
export function bookingState(mode: "draft" | "book", now = new Date()) {
  return mode === "draft" ? { isDraft: true, postedAt: null } : { isDraft: false, postedAt: now };
}

/** Bumps a PENDING / untracked order to IN_PROGRESS once something is recorded. */
export async function markCostsInProgress(tx: DbTransaction, orderId: string) {
  await tx.order.updateMany({ where: { id: orderId, OR: [{ costStatus: "PENDING" }, { costStatus: null }] }, data: { costStatus: "IN_PROGRESS", costVersion: { increment: 1 } } });
}

type EntryInput = z.output<typeof entrySchema>;

/** Inserts ONE draft cost row (caller holds the order via openOrderForCost). Shared by single and batch entry. */
async function insertDraft(tx: DbTransaction, actor: Actor, input: Omit<EntryInput, "orderId">, orderId: string, orderNumber: number, money: ParsedEntry) {
  await checkRefs(tx, orderId, input.orderGroupId, input.supplierId);
  const cost = await tx.orderCost.create({
    data: {
      orderId,
      orderGroupId: input.orderGroupId ?? null,
      category: input.category,
      description: input.description ?? input.materialName,
      materialName: input.materialName,
      materialVariant: input.materialVariant,
      usageQuantity: money.usage ? formatQuantity(money.usage.quantity) : null,
      usageUnit: money.usage?.unit ?? null,
      usageUnitCost: money.usage?.unitCost != null ? centsToDecimalString(money.usage.unitCost) : null,
      amount: centsToDecimalString(money.amount),
      costDate: dateFromString(input.costDate),
      supplierId: input.supplierId ?? null,
      notes: input.notes,
      ...bookingState("draft"),
      idempotencyKey: input.idempotencyKey,
      recordedById: actor.id,
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    userId: actor.id,
    action: AUDIT_ACTIONS.ORDER_COST_RECORDED,
    entityType: "OrderCost",
    entityId: cost.id,
    metadata: { orderId, orderNumber, draft: true, category: input.category, amount: centsToDecimalString(money.amount), supplierId: input.supplierId ?? null, material: input.materialName ?? null, description: input.description ?? null, usageQuantity: money.usage ? formatQuantity(money.usage.quantity) : null, usageUnit: money.usage?.unit ?? null },
  });
  return cost.id;
}

function validationIssues(error: z.ZodError, prefix = ""): Record<string, string[]> {
  const fe: Record<string, string[]> = {};
  for (const i of error.issues) (fe[prefix + (i.path.join(".") || "_form")] ??= []).push(i.message);
  return fe;
}

/** A draft cost entry / material usage line (not a payable until the costs are closed). */
export async function recordCostEntry(db: PrismaClient, actor: Actor, payload: unknown): Promise<{ costId: string; created: boolean }> {
  const r = await recordCostEntries(db, actor, { orderId: (payload as { orderId?: unknown })?.orderId, entries: [payload] }, { flatErrors: true });
  return r.entries[0]!;
}

const batchSchema = z.object({ orderId: z.uuid(), entries: z.array(z.unknown()).min(1, "ضيف بند تكلفة واحد على الأقل").max(50, "أقصى 50 بند في المرة") });

/**
 * «+ إضافة بند تكلفة»: several independent draft cost rows for ONE order, saved
 * together (all or none). Each row has its own idempotency key, so a repeated
 * submit returns the rows already saved instead of duplicating them, and new
 * rows are always new rows. Errors come back per row (`entries.N.field`).
 */
export async function recordCostEntries(db: PrismaClient, actor: Actor, payload: unknown, opts: { flatErrors?: boolean } = {}): Promise<{ entries: { costId: string; created: boolean }[] }> {
  assertPermission(actor, "costs:record");
  const batch = batchSchema.safeParse(payload);
  if (!batch.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: validationIssues(batch.error) });
  const orderId = batch.data.orderId;
  const rows: { input: Omit<EntryInput, "orderId">; money: ParsedEntry }[] = [];
  const errors: Record<string, string[]> = {};
  batch.data.entries.forEach((raw, i) => {
    const prefix = opts.flatErrors ? "" : `entries.${i}.`;
    const parsed = entrySchema.safeParse({ ...(raw as object), orderId });
    if (!parsed.success) return Object.assign(errors, validationIssues(parsed.error, prefix));
    try {
      rows.push({ input: parsed.data, money: parseEntryMoney(parsed.data) });
    } catch (error) {
      if (error instanceof AppError && error.fieldErrors) for (const [k, v] of Object.entries(error.fieldErrors)) errors[prefix + k] = v;
      else throw error;
    }
  });
  if (Object.keys(errors).length > 0) throw new AppError("VALIDATION_ERROR", "راجع بنود التكلفة", { fieldErrors: errors });
  const keys = rows.map((r) => r.input.idempotencyKey);
  if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION_ERROR", "في بند متكرر — افتح الصفحة تاني");

  const replayed = async () => {
    const existing = await db.orderCost.findMany({ where: { idempotencyKey: { in: keys } }, select: { id: true, orderId: true, idempotencyKey: true } });
    if (existing.some((e) => e.orderId !== orderId)) throw new AppError("CONFLICT", "الطلب ده اتسجل قبل كده لأوردر تاني");
    return new Map(existing.map((e) => [e.idempotencyKey, e.id]));
  };
  try {
    return await db.$transaction(async (tx) => {
      const order = await openOrderForCost(tx, actor, orderId);
      const done = new Map((await tx.orderCost.findMany({ where: { idempotencyKey: { in: keys } }, select: { id: true, orderId: true, idempotencyKey: true } })).map((e) => {
        if (e.orderId !== orderId) throw new AppError("CONFLICT", "الطلب ده اتسجل قبل كده لأوردر تاني");
        return [e.idempotencyKey, e.id] as const;
      }));
      const out: { costId: string; created: boolean }[] = [];
      for (const r of rows) {
        const prior = done.get(r.input.idempotencyKey);
        if (prior) out.push({ costId: prior, created: false });
        else out.push({ costId: await insertDraft(tx, actor, r.input, orderId, order.number, r.money), created: true });
      }
      if (out.some((o) => o.created)) await markCostsInProgress(tx, orderId);
      return { entries: out };
    });
  } catch (error) {
    // Two identical submits raced: the loser returns the winner's rows.
    if (isUniqueViolation(error)) {
      const map = await replayed();
      if (keys.every((k) => map.has(k))) return { entries: keys.map((k) => ({ costId: map.get(k)!, created: false })) };
    }
    throw error;
  }
}

/**
 * Removes a DRAFT cost row (never a booked one — those are amended or voided
 * through the finance flow). Kept in history as voided with the reason; the
 * order's costs must still be open.
 */
export async function removeDraftCost(db: PrismaClient, actor: Actor, payload: { costId: unknown }) {
  assertPermission(actor, "costs:record");
  const costId = z.uuid().safeParse(payload.costId);
  if (!costId.success) throw new AppError("NOT_FOUND", "التكلفة مش موجودة");
  return db.$transaction(async (tx) => {
    const head = await tx.orderCost.findUnique({ where: { id: costId.data }, select: { orderId: true } });
    if (!head) throw new AppError("NOT_FOUND", "التكلفة مش موجودة");
    const order = await openOrderForCost(tx, actor, head.orderId);
    const { count } = await tx.orderCost.updateMany({
      where: { id: costId.data, isDraft: true, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: "حذف مسودة قبل قفل التكاليف" },
    });
    if (count === 0) throw new AppError("CONFLICT", "البند ده مش مسودة (أو اتشال قبل كده). البنود المتسجلة بتتعدّل أو بتتلغي من التكاليف.");
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.ORDER_COST_VOIDED, entityType: "OrderCost", entityId: costId.data, metadata: { orderId: head.orderId, orderNumber: order.number, draft: true, reason: "draft removed" } });
    return { orderId: head.orderId };
  });
}

// ───────────────────────────── Close / reopen ─────────────────────────────

const closeSchema = z.object({
  orderId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  /** Supplier for each draft without one: an existing supplier id, or "none" (no supplier owed). */
  suppliers: z.record(z.string(), z.string()).default({}),
  /** Required when the order has no cost at all: "costs are really zero". */
  confirmZero: z.boolean().default(false),
});

/**
 * Closes an order's costs (owner). Every draft is posted once as a supplier
 * payable (or as a cost with no supplier, when explicitly chosen). Safe to
 * repeat: an already-closed order is left as is (nothing posted twice).
 */
export async function closeOrderCosts(db: PrismaClient, actor: Actor, payload: unknown) {
  requireOwner(actor);
  const parsed = closeSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId)) || !(await canAccessOrder(tx, actor, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { number: true, costStatus: true, costVersion: true } });
    if (order.costStatus === "CLOSED") return { changed: false, posted: 0 };
    if (order.costVersion !== input.expectedVersion) throw new AppError("CONFLICT", "التكاليف اتعدلت من شوية. افتح الصفحة تاني وراجع قبل القفل.");
    const costs = await tx.orderCost.findMany({ where: { orderId: input.orderId, voidedAt: null }, select: { id: true, isDraft: true, supplierId: true, amount: true } });
    if (costs.length === 0 && !input.confirmZero) {
      throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { confirmZero: ["مفيش ولا تكلفة. أكّد إن تكاليف الأوردر ده فعلًا صفر"] } });
    }
    const drafts = costs.filter((c) => c.isDraft);
    const missing: string[] = [];
    const chosen = new Map<string, string | null>();
    for (const d of drafts) {
      if (d.supplierId) continue;
      const pick = input.suppliers[d.id];
      if (!pick) missing.push(d.id);
      else if (pick === "none") chosen.set(d.id, null);
      else {
        if (!z.uuid().safeParse(pick).success || !(await tx.supplier.findUnique({ where: { id: pick }, select: { id: true } }))) bad(`suppliers.${d.id}`, "المورد ده مش موجود");
        chosen.set(d.id, pick);
      }
    }
    if (missing.length > 0) {
      throw new AppError("VALIDATION_ERROR", "حدد المورد لكل تكلفة (أو «من غير مورد»)", { fieldErrors: Object.fromEntries(missing.map((id) => [`suppliers.${id}`, ["اختار المورد"]])) });
    }
    const now = new Date();
    for (const d of drafts) {
      // Only drafts flip (is_draft = true in the WHERE): a concurrent close can't post twice.
      await tx.orderCost.updateMany({ where: { id: d.id, isDraft: true }, data: { isDraft: false, postedAt: now, ...(chosen.has(d.id) ? { supplierId: chosen.get(d.id) } : {}) } });
    }
    await tx.order.update({ where: { id: input.orderId }, data: { costStatus: "CLOSED", costReviewedAt: now, costReviewedById: actor.id, costVersion: { increment: 1 } } });
    const total = costs.reduce((s, c) => s + toCents(c.amount), 0n);
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.COST_REVIEW_CLOSED,
      entityType: "Order",
      entityId: input.orderId,
      metadata: {
        number: order.number,
        from: order.costStatus,
        posted: drafts.map((d) => ({ costId: d.id, amount: centsToDecimalString(toCents(d.amount)), supplierId: chosen.has(d.id) ? chosen.get(d.id) : d.supplierId })),
        totalCosts: centsToDecimalString(total),
        zeroConfirmed: costs.length === 0,
      },
    });
    return { changed: true, posted: drafts.length };
  });
}

const reopenSchema = z.object({ orderId: z.uuid(), expectedVersion: z.number().int().min(0), reason: z.string().trim().min(3, "اكتب السبب").max(300) });

/** Reopens closed costs (owner). Posted costs stay posted — new entries are drafts until the next close. */
export async function reopenOrderCosts(db: PrismaClient, actor: Actor, payload: unknown) {
  requireOwner(actor);
  const parsed = reopenSchema.safeParse(payload);
  if (!parsed.success) bad("reason", parsed.error.issues[0]?.message ?? "اكتب السبب");
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId)) || !(await canAccessOrder(tx, actor, input.orderId))) throw new AppError("NOT_FOUND", "الأوردر مش موجود");
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { number: true, costStatus: true, costVersion: true } });
    if (order.costStatus !== "CLOSED" && order.costStatus !== "NEEDS_REVIEW") return { changed: false };
    if (order.costVersion !== input.expectedVersion) throw new AppError("CONFLICT", "التكاليف اتعدلت من شوية. افتح الصفحة تاني.");
    await tx.order.update({ where: { id: input.orderId }, data: { costStatus: "IN_PROGRESS", costVersion: { increment: 1 } } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.COST_REVIEW_REOPENED, entityType: "Order", entityId: input.orderId, metadata: { number: order.number, from: order.costStatus, reason: input.reason } });
    return { changed: true };
  });
}

/** A closed order changed (items, quantities, prices, cancellation): its costs need another look. */
export async function markCostsNeedReview(tx: DbTransaction, actor: Actor, orderId: string, what: string) {
  const { count } = await tx.order.updateMany({ where: { id: orderId, costStatus: "CLOSED" }, data: { costStatus: "NEEDS_REVIEW", costVersion: { increment: 1 } } });
  if (count > 0) await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.COST_REVIEW_NEEDS_REVIEW, entityType: "Order", entityId: orderId, metadata: { reason: what } });
}

// ───────────────────────────── Amend ─────────────────────────────

const amendSchema = z.object({
  costId: z.uuid(),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().max(300).optional().transform((v) => v || undefined),
  orderGroupId: z.uuid().optional().or(z.literal("").transform(() => null)).nullable(),
  category: z.enum(COST_CATEGORIES as [string, ...string[]]).optional(),
  materialName: z.string().trim().max(120).optional(),
  materialVariant: z.string().trim().max(80).optional(),
  usageQuantity: z.union([z.string(), z.number()]).optional(),
  usageUnit: z.enum(USAGE_UNITS).optional().or(z.literal("").transform(() => undefined)),
  usageUnitCost: z.string().optional(),
  amount: z.string().optional(),
  supplierId: z.uuid().optional().or(z.literal("").transform(() => null)).nullable(),
  costDate: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

function snapshot(c: { category: string; orderGroupId: string | null; materialName: string | null; materialVariant: string | null; usageQuantity: { toString(): string } | null; usageUnit: string | null; usageUnitCost: { toString(): string } | null; amount: { toString(): string }; supplierId: string | null; costDate: Date; notes: string | null }) {
  return {
    category: c.category,
    orderGroupId: c.orderGroupId,
    materialName: c.materialName,
    materialVariant: c.materialVariant,
    usageQuantity: c.usageQuantity === null ? null : formatQuantity(decimalToMilli(c.usageQuantity)!),
    usageUnit: c.usageUnit,
    usageUnitCost: c.usageUnitCost === null ? null : centsToDecimalString(toCents(c.usageUnitCost)),
    amount: centsToDecimalString(toCents(c.amount)),
    supplierId: c.supplierId,
    costDate: dateToString(c.costDate),
    notes: c.notes,
  };
}

/**
 * Corrects one cost entry IN PLACE (keeps its payments). Drafts: anyone who
 * records costs, while the order's costs are open. Posted entries: owner only,
 * with a reason — also after closing. History is kept in order_cost_revisions.
 */
export async function amendCostEntry(db: PrismaClient, actor: Actor, payload: unknown) {
  assertPermission(actor, "costs:record");
  const parsed = amendSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const head = await tx.orderCost.findUnique({ where: { id: input.costId }, select: { orderId: true } });
    if (!head) throw new AppError("NOT_FOUND", "التكلفة مش موجودة");
    if (!(await lockOrder(tx, head.orderId)) || !(await canAccessOrder(tx, actor, head.orderId))) throw new AppError("NOT_FOUND", "التكلفة مش موجودة");
    // Lock the cost row (payments serialize on the same lock).
    await tx.$queryRaw`SELECT id FROM order_costs WHERE id = ${input.costId}::uuid FOR UPDATE`;
    const c = await tx.orderCost.findUniqueOrThrow({
      where: { id: input.costId },
      select: { orderId: true, version: true, isDraft: true, voidedAt: true, category: true, orderGroupId: true, materialName: true, materialVariant: true, usageQuantity: true, usageUnit: true, usageUnitCost: true, amount: true, supplierId: true, costDate: true, notes: true, order: { select: { costStatus: true, number: true } } },
    });
    if (c.voidedAt) throw new AppError("CONFLICT", "التكلفة دي ملغية");
    if (c.version !== input.expectedVersion) throw new AppError("CONFLICT", "التكلفة دي اتعدلت من شوية. افتح الصفحة تاني وراجع.");
    if (!c.isDraft || c.order.costStatus === "CLOSED") {
      if (!isOwner(actor)) throw new AppError("FORBIDDEN", "تعديل تكلفة متسجلة للمدير بس");
      if (!input.reason || input.reason.length < 3) bad("reason", "اكتب سبب التعديل");
    }
    const before = snapshot(c);
    const qtyIn = input.usageQuantity !== undefined ? input.usageQuantity : before.usageQuantity ?? undefined;
    const money = parseEntryMoney({
      usageQuantity: qtyIn === null ? undefined : qtyIn,
      usageUnit: input.usageUnit !== undefined ? input.usageUnit : (before.usageUnit ?? undefined),
      usageUnitCost: input.usageUnitCost !== undefined ? input.usageUnitCost : (before.usageUnitCost ?? undefined),
      // A new typed amount, or (without quantity × unit cost) the current amount.
      amount: input.amount !== undefined ? input.amount : qtyIn === undefined || qtyIn === "" ? before.amount : undefined,
    });
    const supplierId = input.supplierId !== undefined ? input.supplierId : c.supplierId;
    const orderGroupId = input.orderGroupId !== undefined ? input.orderGroupId : c.orderGroupId;
    await checkRefs(tx, c.orderId, orderGroupId ?? undefined, supplierId ?? undefined);
    const costDate = input.costDate ?? before.costDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(costDate) || costDate > todayDateString()) bad("costDate", "التاريخ مش صحيح أو في المستقبل");

    const paid = (await tx.outgoingPayment.aggregate({ where: { orderCostId: input.costId, voidedAt: null }, _sum: { amount: true } }))._sum.amount;
    const paidCents = paid ? toCents(paid) : 0n;
    if (money.amount < paidCents) bad("amount", `اتدفع للمورد ${formatMoney(paidCents)} على التكلفة دي — المبلغ مينفعش يقل عن كده (ألغِ الدفعة الأول لو كانت غلط).`);
    if (supplierId !== c.supplierId && paidCents > 0n) bad("supplierId", "التكلفة دي عليها مدفوعات للمورد الحالي — مينفعش تغيّر المورد قبل إلغائها.");

    const data = {
      category: (input.category as CostCategory | undefined) ?? c.category,
      orderGroupId,
      materialName: input.materialName !== undefined ? input.materialName || null : c.materialName,
      materialVariant: input.materialVariant !== undefined ? input.materialVariant || null : c.materialVariant,
      usageQuantity: money.usage ? formatQuantity(money.usage.quantity) : null,
      usageUnit: money.usage?.unit ?? null,
      usageUnitCost: money.usage?.unitCost != null ? centsToDecimalString(money.usage.unitCost) : null,
      amount: centsToDecimalString(money.amount),
      supplierId,
      costDate: dateFromString(costDate),
      notes: input.notes !== undefined ? input.notes || null : c.notes,
    };
    const after = snapshot({ ...data, usageQuantity: data.usageQuantity, usageUnitCost: data.usageUnitCost, amount: data.amount });
    if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false, version: c.version };
    const version = c.version + 1;
    await tx.orderCost.update({ where: { id: input.costId }, data: { ...data, version } });
    await tx.orderCostRevision.create({
      data: { orderCostId: input.costId, version, before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue, reason: input.reason ?? "تعديل مسودة", changedById: actor.id },
    });
    await recordAudit(tx, {
      userId: actor.id,
      action: AUDIT_ACTIONS.ORDER_COST_AMENDED,
      entityType: "OrderCost",
      entityId: input.costId,
      metadata: { orderId: c.orderId, orderNumber: c.order.number, draft: c.isDraft, reason: input.reason ?? null, before, after, difference: centsToDecimalString(money.amount - toCents(c.amount)) },
    });
    return { changed: true, version };
  });
}

