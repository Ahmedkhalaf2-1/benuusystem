import type { Role } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";

/**
 * Permission-based authorization. Code checks permissions, never roles.
 *
 * - OWNER_ADMIN has every permission, always.
 * - STAFF has exactly the permissions the owner granted on their account
 *   (`User.permissions`), deny by default. A granted key only counts when it is
 *   staff-grantable AND every permission it depends on is granted too, so a
 *   stale or hand-edited row can never widen access.
 * - Reading never implies writing, and seeing an order never implies seeing
 *   its prices. Dependencies only go the other way: a write needs its read
 *   (you cannot record a delivery on an order you cannot see).
 *
 * Permissions are loaded from the database on every request together with
 * the session, so a reduction takes effect on the very next request.
 */
export const PERMISSIONS = [
  /** Operational home screen. Every signed-in account has it. */
  "dashboard:view",
  "users:manage",
  "audit-logs:view",
  // Customers
  "customers:view",
  /** Customer phone numbers. */
  "customers:view-contact",
  "customers:manage",
  // Orders
  /** Orders the account may see under each order's visibility, without money. */
  "orders:view",
  /** Order totals, item prices, paid and outstanding. */
  "orders:view-prices",
  "orders:create",
  "orders:edit",
  /** Changing the agreed price of an existing order (financial correction). */
  "orders:edit-price",
  "orders:cancel",
  /** «حذف الأوردر»: archive an untouched order (never a real delete). */
  "orders:archive",
  /** Changing who may see an order («ظهور الأوردر للعمال»). */
  "orders:manage-access",
  // Production & delivery (physical pieces — no money)
  "production:view",
  "production:record",
  "deliveries:view",
  "deliveries:record",
  /** Voiding wrong production / ready / delivery records (owner). */
  "production:correct",
  // Payments
  /** Customer payment history on an order. */
  "payments:view",
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
  /** Supplier balances (what we owe each supplier). */
  "suppliers:view-balances",
  /** Company-wide money figures for this month (dashboard money card). */
  "finance:view-summary",
  /** Detailed accounting reports under /accounts (owner). */
  "finance:reports",
  /** Treasury: account balances, ledger, transfers, owner capital/drawings, reconciliation (owner). */
  "treasury:manage",
  /** Customer financial documents: order invoices, order summaries, account statements (PDF). */
  "documents:customer-financial",
  // Workers (payroll records — not app accounts)
  /** Worker names/jobs — enough to pick a worker when recording work. */
  "workers:view",
  /** Add/edit workers, including their daily wage. */
  "workers:manage",
  /** Wages, earnings, payments, balances. */
  "workers:view-pay",
  /** Paying wages and advances. */
  "workers:pay",
  /** Recording attendance (يومية) and output (شغل). Never shows money. */
  "work:record",
  /** Voiding wrong attendance / output records (owner). */
  "workers:correct",
  /** Labour cost per order. */
  "labor:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Every signed-in account gets these. */
const BASE_PERMISSIONS: readonly Permission[] = ["dashboard:view"];

/**
 * Permissions the owner may grant to a staff account. Everything else
 * (account management, financial corrections, wages, supplier balances,
 * order visibility…) stays owner-only and is ignored if found on a staff row.
 */
export const STAFF_GRANTABLE = [
  "orders:view",
  "orders:view-prices",
  "orders:create",
  "orders:edit",
  "orders:archive",
  "production:view",
  "production:record",
  "deliveries:view",
  "deliveries:record",
  "customers:view",
  "customers:view-contact",
  "customers:manage",
  "payments:view",
  "payments:record",
  "costs:view",
  "costs:record",
  "expenses:view",
  "expenses:record",
  "suppliers:view",
  "suppliers:manage",
  "payables:pay",
  "workers:view",
  "work:record",
  "finance:view-summary",
  "documents:customer-financial",
] as const satisfies readonly Permission[];

export type GrantablePermission = (typeof STAFF_GRANTABLE)[number];

/**
 * What each grantable permission needs to be useful and safe. A write needs
 * its read; anything that shows money on an order needs order prices.
 * Never the reverse: a read never brings a write with it.
 */
export const PERMISSION_REQUIRES: Partial<Record<GrantablePermission, readonly GrantablePermission[]>> = {
  "orders:view-prices": ["orders:view"],
  "orders:create": ["orders:view", "orders:view-prices", "customers:view"],
  "orders:edit": ["orders:view", "orders:view-prices"],
  "orders:archive": ["orders:view"],
  "production:view": ["orders:view"],
  "production:record": ["production:view"],
  "deliveries:view": ["orders:view"],
  "deliveries:record": ["deliveries:view"],
  "customers:view-contact": ["customers:view"],
  "customers:manage": ["customers:view", "customers:view-contact"],
  "payments:view": ["orders:view-prices"],
  "payments:record": ["payments:view"],
  "costs:view": ["orders:view"],
  "costs:record": ["orders:view"],
  "suppliers:manage": ["suppliers:view"],
  "work:record": ["workers:view"],
  "documents:customer-financial": ["payments:view", "customers:view-contact"],
};

export function isGrantable(key: string): key is GrantablePermission {
  return (STAFF_GRANTABLE as readonly string[]).includes(key);
}

/** Every permission `key` depends on, directly or indirectly. */
export function requiredPermissions(key: GrantablePermission): GrantablePermission[] {
  const out = new Set<GrantablePermission>();
  const visit = (k: GrantablePermission) => {
    for (const dep of PERMISSION_REQUIRES[k] ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        visit(dep);
      }
    }
  };
  visit(key);
  return [...out];
}

/** Grantable keys of `granted` whose dependencies are all granted too. */
export function effectiveStaffPermissions(granted: readonly string[]): GrantablePermission[] {
  const set = new Set(granted.filter(isGrantable));
  return STAFF_GRANTABLE.filter((k) => set.has(k) && requiredPermissions(k).every((d) => set.has(d)));
}

/** The subject of a permission check: role plus the account's grants. */
export type PermissionSubject = { role: Role; permissions?: readonly string[] | null };

export function permissionsFor(user: PermissionSubject): readonly Permission[] {
  if (user.role === "OWNER_ADMIN") return PERMISSIONS;
  if (user.role !== "STAFF") return [];
  return [...BASE_PERMISSIONS, ...effectiveStaffPermissions(user.permissions ?? [])];
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER_ADMIN: "المالك / المدير",
  STAFF: "موظف",
};

export function isOwner(user: { role: Role } | null | undefined): boolean {
  return user?.role === "OWNER_ADMIN";
}

export function hasPermission(user: PermissionSubject | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return permissionsFor(user).includes(permission);
}

/** Throws AppError(FORBIDDEN) unless the actor has the permission. For services. */
export function assertPermission(actor: PermissionSubject | null | undefined, permission: Permission): void {
  if (!hasPermission(actor, permission)) throw new AppError("FORBIDDEN");
}
