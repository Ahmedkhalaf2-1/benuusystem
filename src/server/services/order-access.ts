import { Prisma } from "@/generated/prisma/client";
import { assertPermission, hasPermission, isOwner, type Permission } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";

/**
 * Per-order visibility («ظهور الأوردر للعمال»).
 *
 * Effective access to an order needs BOTH the general permission
 * "orders:view" AND the order's own visibility allowing this account:
 *   PRIVATE              → owners only
 *   ALL_AUTHORIZED_STAFF → every staff account with orders:view
 *   SELECTED_STAFF       → staff listed in order_access for that order
 * Archived («محذوف») orders are only reachable with "orders:archive".
 *
 * Every query that returns orders, counts orders or acts on one order goes
 * through `orderScope` / `orderScopeSql` / `requireOrderAccess`, so a hidden
 * order never leaks through lists, counts, search, pickers or guessed IDs.
 * A hidden order is reported as NOT_FOUND, never FORBIDDEN, so its existence
 * is not revealed either.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prisma filter for the orders this actor may see. Throws FORBIDDEN without orders:view. */
export function orderScope(actor: Actor, options: { includeArchived?: boolean } = {}): Prisma.OrderWhereInput {
  assertPermission(actor, "orders:view");
  if (isOwner(actor)) return {};
  const and: Prisma.OrderWhereInput[] = [
    {
      OR: [
        { visibility: "ALL_AUTHORIZED_STAFF" },
        { visibility: "SELECTED_STAFF", access: { some: { userId: actor.id } } },
      ],
    },
  ];
  if (!(options.includeArchived && hasPermission(actor, "orders:archive"))) and.push({ archivedAt: null });
  return { AND: and };
}

/** Same rule as `orderScope` for raw SQL, against the orders table aliased `alias`. */
export function orderScopeSql(actor: Actor, alias: string): Prisma.Sql {
  assertPermission(actor, "orders:view");
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("bad alias");
  if (isOwner(actor)) return Prisma.sql`TRUE`;
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(${a}.archived_at IS NULL AND (${a}.visibility = 'ALL_AUTHORIZED_STAFF'
    OR (${a}.visibility = 'SELECTED_STAFF' AND EXISTS (
      SELECT 1 FROM order_access oa WHERE oa.order_id = ${a}.id AND oa.user_id = ${actor.id}::uuid))))`;
}

/** Whether the actor may see this order (false for malformed or unknown IDs). */
export async function canAccessOrder(db: DbClient, actor: Actor, orderId: string, options: { includeArchived?: boolean } = {}): Promise<boolean> {
  if (!hasPermission(actor, "orders:view") || typeof orderId !== "string" || !UUID.test(orderId)) return false;
  const row = await db.order.findFirst({ where: { AND: [{ id: orderId }, orderScope(actor, options)] }, select: { id: true } });
  return row !== null;
}

/**
 * For services acting on one order: requires `permission` (if given) and
 * access to the order. Throws FORBIDDEN without the permission, NOT_FOUND
 * when the order is hidden or does not exist.
 */
export async function requireOrderAccess(
  db: DbClient,
  actor: Actor,
  orderId: string,
  permission?: Permission,
  options: { includeArchived?: boolean } = {},
): Promise<void> {
  if (permission) assertPermission(actor, permission);
  if (!(await canAccessOrder(db, actor, orderId, options))) throw new AppError("NOT_FOUND");
}

/** Field-level money rule: order totals, item prices, paid, outstanding. */
export function canSeeOrderPrices(actor: Actor): boolean {
  return hasPermission(actor, "orders:view-prices");
}
