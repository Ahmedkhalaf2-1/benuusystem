import type { Prisma } from "@/generated/prisma/client";
import { isOwner } from "@/lib/auth/permissions";
import type { DbClient } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import type { Actor } from "./actor";

/**
 * Department access («الأقسام»): who may reach which department's ITEMS.
 *
 * - The owner reaches every department (active or not), with every capability.
 * - Any other account (STAFF or PARTNER) reaches only the ACTIVE departments
 *   it is a member of with `canViewWork`. Money and production writes are
 *   separate switches on the same membership.
 * - Memberships are re-read from the database on every call, so a change or
 *   revocation applies to the very next request.
 * - An unknown department, a department the account isn't a member of and a
 *   malformed id all look the same: NOT_FOUND. Nothing about them leaks.
 *
 * Department views only ever read the department's own items
 * (`departmentItemWhere`); they never reuse whole-order queries or DTOs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DepartmentGrant = {
  departmentId: string;
  name: string;
  isActive: boolean;
  canViewMoney: boolean;
  canRecordProduction: boolean;
  /** Allocated customer collections (derived). Only counts together with canViewMoney. */
  canViewCollections: boolean;
  /** The account's own partner settlement for this department. */
  canViewSettlements: boolean;
  /** Owner: sees orders hidden from departments too. */
  includeHidden: boolean;
};

/** Every department this actor may see, in display order. */
export async function departmentGrants(db: DbClient, actor: Actor): Promise<DepartmentGrant[]> {
  if (isOwner(actor)) {
    const all = await db.department.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } });
    return all.map((d) => ({ departmentId: d.id, name: d.name, isActive: d.isActive, canViewMoney: true, canRecordProduction: true, canViewCollections: true, canViewSettlements: true, includeHidden: true }));
  }
  if (actor.role !== "STAFF" && actor.role !== "PARTNER") return [];
  const rows = await db.departmentMember.findMany({
    where: { userId: actor.id, canViewWork: true, department: { isActive: true }, user: { isActive: true } },
    orderBy: [{ department: { sortOrder: "asc" } }, { department: { name: "asc" } }],
    select: { canViewMoney: true, canRecordProduction: true, canViewCollections: true, canViewSettlements: true, department: { select: { id: true, name: true, isActive: true } } },
  });
  return rows.map((r) => ({
    departmentId: r.department.id,
    name: r.department.name,
    isActive: r.department.isActive,
    canViewMoney: r.canViewMoney,
    canRecordProduction: r.canRecordProduction,
    // Collections show an outstanding balance, which reveals the work value: they need the money switch too.
    canViewCollections: r.canViewCollections && r.canViewMoney,
    canViewSettlements: r.canViewSettlements,
    includeHidden: false,
  }));
}

/** Whether the actor reaches any department (navigation). */
export async function hasDepartmentAccess(db: DbClient, actor: Actor): Promise<boolean> {
  if (isOwner(actor)) return true;
  return (await departmentGrants(db, actor)).length > 0;
}

/**
 * The actor's grant on one department. NOT_FOUND when the department is
 * unknown, inactive (non-owners) or not granted; FORBIDDEN when it is visible
 * but the requested capability isn't granted.
 */
export async function requireDepartment(
  db: DbClient,
  actor: Actor,
  departmentId: string,
  need: "work" | "money" | "record" | "collections" | "settlements" = "work",
): Promise<DepartmentGrant> {
  if (typeof departmentId !== "string" || !UUID.test(departmentId)) throw new AppError("NOT_FOUND", "القسم مش موجود");
  const grant = (await departmentGrants(db, actor)).find((g) => g.departmentId === departmentId);
  if (!grant) throw new AppError("NOT_FOUND", "القسم مش موجود");
  if (need === "money" && !grant.canViewMoney) throw new AppError("FORBIDDEN");
  if (need === "record" && !grant.canRecordProduction) throw new AppError("FORBIDDEN", "مالكش صلاحية تسجيل إنتاج في القسم ده");
  if (need === "collections" && !grant.canViewCollections) throw new AppError("FORBIDDEN");
  if (need === "settlements" && !grant.canViewSettlements) throw new AppError("FORBIDDEN");
  return grant;
}

/** Orders a department view may show: never archived; non-owners never see orders hidden from departments. */
function visibleOrder(includeHidden: boolean): Prisma.OrderWhereInput {
  return includeHidden ? { archivedAt: null } : { archivedAt: null, hiddenFromDepartments: false };
}

/** The department's items that department views may show. */
export function departmentItemWhere(departmentId: string, includeHidden = false): Prisma.OrderGroupWhereInput {
  return { departmentId, order: visibleOrder(includeHidden) };
}

/** Orders that have at least one item of the department (for counts and lists). */
export function departmentOrderWhere(departmentId: string, includeHidden = false): Prisma.OrderWhereInput {
  return { ...visibleOrder(includeHidden), groups: { some: { departmentId } } };
}

/** Orders where the department has priced work: its own items or an owner split share (money views). */
export function departmentMoneyOrderWhere(departmentId: string, includeHidden = false): Prisma.OrderWhereInput {
  return { ...visibleOrder(includeHidden), groups: { some: { OR: [{ departmentId }, { valueShares: { some: { departmentId } } }] } } };
}
