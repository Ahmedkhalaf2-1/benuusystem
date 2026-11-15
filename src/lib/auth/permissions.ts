import type { Role } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";

/**
 * Permission-based authorization.
 *
 * Code checks permissions, never roles directly. Roles map to sets of
 * permissions here, so future phases can add permissions (e.g. "orders:create")
 * and assign them to roles — or later to individual users — without touching
 * the call sites.
 */
export const PERMISSIONS = [
  "dashboard:view",
  "users:manage",
  "audit-logs:view",
  // Customers
  "customers:view",
  "customers:manage",
  // Orders
  "orders:view",
  "orders:create",
  "orders:edit",
  /** Changing the agreed price of an existing order (financial correction). */
  "orders:edit-price",
  "orders:cancel",
  // Payments
  "payments:record",
  /** Voiding a recorded payment (financial correction). */
  "payments:void",
  // Suppliers, order costs, general expenses, money paid out
  "suppliers:view",
  "suppliers:manage",
  "costs:view",
  "costs:record",
  "expenses:view",
  "expenses:record",
  /** Paying (part of) a recorded cost or expense. */
  "payables:pay",
  /** Voiding order costs, general expenses and money paid out (owner). */
  "finance:void",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER_ADMIN: PERMISSIONS,
  STAFF: [
    "dashboard:view",
    "customers:view",
    "customers:manage",
    "orders:view",
    "orders:create",
    "orders:edit",
    "payments:record",
    "suppliers:view",
    "suppliers:manage",
    "costs:view",
    "costs:record",
    "expenses:view",
    "expenses:record",
    "payables:pay",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER_ADMIN: "المالك / المدير",
  STAFF: "موظف",
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(
  user: { role: Role } | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  return permissionsForRole(user.role).includes(permission);
}

/** Throws AppError(FORBIDDEN) unless the actor has the permission. For services. */
export function assertPermission(
  actor: { role: Role } | null | undefined,
  permission: Permission,
): void {
  if (!hasPermission(actor, permission)) throw new AppError("FORBIDDEN");
}
