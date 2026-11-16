import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { PERMISSION_INFO, missingDependencies } from "@/lib/auth/permission-catalog";
import { STAFF_GRANTABLE, assertPermission, effectiveStaffPermissions, isGrantable, isOwner, type GrantablePermission } from "@/lib/auth/permissions";
import type { DbClient, DbTransaction } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { emailSchema, newPasswordSchema, userNameSchema } from "@/lib/validations/auth";
import { createUser, findUserByEmail } from "@/server/repositories/user-repository";
import { deleteSessionsForUser } from "@/server/repositories/session-repository";
import type { Actor } from "./actor";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * «إدارة المستخدمين والصلاحيات» — owner only ("users:manage").
 *
 * - The owner creates STAFF accounts and resets their passwords here. Both
 *   need the owner's own password again (re-authentication), are rate
 *   limited, and audited — so a stolen browser session alone can't mint
 *   logins. New accounts start with no permissions.
 * - Only STAFF accounts are edited here. Owner accounts (always full access)
 *   are never changed from the browser, so the last owner can't be locked out
 *   and nobody can promote themselves.
 * - A user can never change their own account here.
 * - Every change runs in a transaction with the user row locked and an
 *   optimistic version check, and is audited. Permissions are read from the
 *   database on every request, so a reduction applies to the very next
 *   request; the owner may also sign the account out everywhere at once.
 */

const SOURCE = "web:users";
const UUID = z.uuid();

export type StaffAccountSummary = {
  id: string;
  name: string;
  email: string;
  role: "OWNER_ADMIN" | "STAFF";
  isActive: boolean;
  /** Effective grants (owners: empty — they have everything). */
  permissions: GrantablePermission[];
  sessions: number;
  /** Orders shared with this account by name (SELECTED_STAFF). */
  assignedOrders: number;
  createdAt: Date;
};

export async function listAccounts(db: DbClient, actor: Actor): Promise<StaffAccountSummary[]> {
  assertPermission(actor, "users:manage");
  const now = new Date();
  const rows = await db.user.findMany({
    orderBy: [{ role: "asc" }, { isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      permissions: true,
      createdAt: true,
      _count: { select: { sessions: { where: { expiresAt: { gt: now } } }, orderAccess: { where: { order: { visibility: "SELECTED_STAFF", archivedAt: null } } } } },
    },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    permissions: u.role === "STAFF" ? effectiveStaffPermissions(u.permissions) : [],
    sessions: u._count.sessions,
    assignedOrders: u._count.orderAccess,
    createdAt: u.createdAt,
  }));
}

export type StaffAccountDetails = StaffAccountSummary & {
  version: number;
  /** Grants stored on the row that are not in effect (unknown / owner-only / missing a dependency). */
  ignoredPermissions: string[];
  orders: { id: string; number: number; title: string; customerName: string }[];
  /** Orders every authorized staff member sees (count). */
  sharedWithAllStaff: number;
  lastLoginAt: Date | null;
};

export async function getAccount(db: DbClient, actor: Actor, userId: string): Promise<StaffAccountDetails | null> {
  assertPermission(actor, "users:manage");
  if (!UUID.safeParse(userId).success) return null;
  const now = new Date();
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      permissions: true,
      permissionsVersion: true,
      createdAt: true,
      _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } },
      orderAccess: {
        where: { order: { visibility: "SELECTED_STAFF", archivedAt: null } },
        orderBy: { order: { number: "desc" } },
        take: 50,
        select: { order: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } } },
      },
    },
  });
  if (!u) return null;
  const [assignedOrders, sharedWithAllStaff, lastLogin] = await Promise.all([
    db.orderAccess.count({ where: { userId, order: { visibility: "SELECTED_STAFF", archivedAt: null } } }),
    db.order.count({ where: { visibility: "ALL_AUTHORIZED_STAFF", archivedAt: null } }),
    db.auditLog.findFirst({ where: { userId, action: AUDIT_ACTIONS.LOGIN_SUCCESS }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const effective = u.role === "STAFF" ? effectiveStaffPermissions(u.permissions) : [];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    permissions: effective,
    ignoredPermissions: u.role === "STAFF" ? u.permissions.filter((p) => !(effective as string[]).includes(p)) : [],
    sessions: u._count.sessions,
    assignedOrders,
    createdAt: u.createdAt,
    version: u.permissionsVersion,
    orders: u.orderAccess.map((a) => ({ id: a.order.id, number: a.order.number, title: a.order.title, customerName: a.order.customer.name })),
    sharedWithAllStaff,
    lastLoginAt: lastLogin?.createdAt ?? null,
  };
}

/** Locks a STAFF account row for a change by the owner. Refuses owners and self-edits. */
async function lockStaffAccount(tx: DbTransaction, actor: Actor, userId: string, expectedVersion: number | undefined) {
  if (userId === actor.id) throw new AppError("FORBIDDEN", "مينفعش تعدّل صلاحيات أو حالة حسابك إنت.");
  const rows = await tx.$queryRaw<{ id: string; role: string; is_active: boolean; permissions: string[]; permissions_version: number; email: string }[]>`
    SELECT id, role, is_active, permissions, permissions_version, email FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  if (row.role !== "STAFF") throw new AppError("FORBIDDEN", "حسابات المدير بتتدار من السيرفر بس، ودايمًا ليها كل الصلاحيات.");
  if (expectedVersion !== undefined && expectedVersion !== row.permissions_version) {
    throw new AppError("CONFLICT", "الحساب ده اتعدّل من شوية. افتح الصفحة تاني وراجع قبل ما تحفظ.");
  }
  return row;
}

function requireOwnerActor(actor: Actor) {
  assertPermission(actor, "users:manage");
  // Defence in depth: users:manage is owner-only, but never let a staff row reach this.
  if (!isOwner(actor)) throw new AppError("FORBIDDEN");
}

const permissionsInputSchema = z.object({
  userId: z.uuid(),
  permissions: z.array(z.string().max(64)).max(STAFF_GRANTABLE.length + 10),
  expectedVersion: z.number().int().min(0),
  /** Also sign the account out on every device. */
  revokeSessions: z.boolean().default(false),
});

export async function updateStaffPermissions(db: PrismaClient, actor: Actor, payload: unknown) {
  requireOwnerActor(actor);
  const parsed = permissionsInputSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const input = parsed.data;

  const unknown = input.permissions.filter((p) => !isGrantable(p));
  if (unknown.length > 0) throw new AppError("VALIDATION_ERROR", "في صلاحية مينفعش تتدي لموظف");
  const wanted = STAFF_GRANTABLE.filter((k) => input.permissions.includes(k));
  const missing = missingDependencies(wanted);
  if (missing.length > 0) {
    const m = missing[0]!;
    throw new AppError("VALIDATION_ERROR", `«${PERMISSION_INFO[m.key].label}» محتاجة كمان: ${m.needs.map((n) => `«${PERMISSION_INFO[n].label}»`).join("، ")}`);
  }

  return db.$transaction(async (tx) => {
    const row = await lockStaffAccount(tx, actor, input.userId, input.expectedVersion);
    const before = effectiveStaffPermissions(row.permissions);
    const added = wanted.filter((k) => !before.includes(k));
    const removed = before.filter((k) => !wanted.includes(k));
    const storedChanged = row.permissions.length !== wanted.length || row.permissions.some((p) => !(wanted as string[]).includes(p));
    if (!storedChanged && !input.revokeSessions) return { changed: false, sessionsRevoked: 0 };

    await tx.user.update({ where: { id: input.userId }, data: { permissions: wanted, permissionsVersion: { increment: 1 } } });
    const { count } = input.revokeSessions ? await deleteSessionsForUser(tx, input.userId) : { count: 0 };
    if (storedChanged) {
      await recordAudit(tx, {
        userId: actor.id,
        action: AUDIT_ACTIONS.USER_PERMISSIONS_CHANGED,
        entityType: "User",
        entityId: input.userId,
        metadata: { email: row.email, added, removed, after: wanted, reduced: removed.length > 0, sessionsRevoked: count, source: SOURCE },
      });
    }
    if (input.revokeSessions) {
      await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED, entityType: "User", entityId: input.userId, metadata: { sessionsRevoked: count, source: SOURCE } });
    }
    return { changed: true, sessionsRevoked: count };
  });
}

/** Activate / deactivate a STAFF account. Deactivation ends every session immediately. */
export async function setStaffActive(db: PrismaClient, actor: Actor, payload: { userId: unknown; active: unknown; expectedVersion: unknown }) {
  requireOwnerActor(actor);
  const userId = UUID.safeParse(payload.userId);
  const version = z.coerce.number().int().min(0).safeParse(payload.expectedVersion);
  if (!userId.success || !version.success || typeof payload.active !== "boolean") throw new AppError("VALIDATION_ERROR", "البيانات المرسلة غير صحيحة");
  const active = payload.active;
  return db.$transaction(async (tx) => {
    const row = await lockStaffAccount(tx, actor, userId.data, version.data);
    if (row.is_active === active) return { changed: false, sessionsRevoked: 0 };
    await tx.user.update({ where: { id: userId.data }, data: { isActive: active, permissionsVersion: { increment: 1 } } });
    const { count } = active ? { count: 0 } : await deleteSessionsForUser(tx, userId.data);
    await recordAudit(tx, {
      userId: actor.id,
      action: active ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
      entityType: "User",
      entityId: userId.data,
      metadata: { email: row.email, sessionsRevoked: count, source: SOURCE },
    });
    return { changed: true, sessionsRevoked: count };
  });
}

/** Sign a STAFF account out on every device (e.g. a lost phone). */
export async function revokeStaffSessions(db: PrismaClient, actor: Actor, payload: { userId: unknown }) {
  requireOwnerActor(actor);
  const userId = UUID.safeParse(payload.userId);
  if (!userId.success) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  return db.$transaction(async (tx) => {
    await lockStaffAccount(tx, actor, userId.data, undefined);
    const { count } = await deleteSessionsForUser(tx, userId.data);
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED, entityType: "User", entityId: userId.data, metadata: { sessionsRevoked: count, source: SOURCE } });
    return { sessionsRevoked: count };
  });
}

// ───────────────────────────── Accounts from the browser ─────────────────────────────

/** Max accounts created / passwords reset per owner per hour, and wrong re-auth tries per 15 min. */
export const ACCOUNT_CHANGES_PER_HOUR = 10;
export const REAUTH_FAILURES_PER_15_MIN = 5;

/**
 * Owner re-authentication: the owner types their own password again. Wrong
 * passwords are audited and, after a few, further attempts are blocked.
 */
async function reauthenticateOwner(db: PrismaClient, actor: Actor, ownerPassword: unknown) {
  const since = new Date(Date.now() - 15 * 60_000);
  const failures = await db.auditLog.count({ where: { userId: actor.id, action: AUDIT_ACTIONS.OWNER_REAUTH_FAILED, createdAt: { gte: since } } });
  if (failures >= REAUTH_FAILURES_PER_15_MIN) throw new AppError("RATE_LIMITED", "محاولات كتير بكلمة سر غلط. استنى ربع ساعة وجرّب تاني.");
  const owner = await db.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true, isActive: true, role: true } });
  const ok = owner?.isActive && owner.role === "OWNER_ADMIN" && typeof ownerPassword === "string" && ownerPassword.length > 0 && (await verifyPassword(owner.passwordHash, ownerPassword));
  if (!ok) {
    await recordAudit(db, { userId: actor.id, action: AUDIT_ACTIONS.OWNER_REAUTH_FAILED, entityType: "User", entityId: actor.id, metadata: { source: SOURCE } });
    throw new AppError("VALIDATION_ERROR", "كلمة السر بتاعتك غلط", { fieldErrors: { ownerPassword: ["كلمة السر بتاعتك غلط"] } });
  }
}

async function assertAccountChangeBudget(db: PrismaClient, actor: Actor) {
  const since = new Date(Date.now() - 60 * 60_000);
  const recent = await db.auditLog.count({
    where: { userId: actor.id, action: { in: [AUDIT_ACTIONS.USER_CREATED, AUDIT_ACTIONS.USER_PASSWORD_RESET] }, createdAt: { gte: since } },
  });
  if (recent >= ACCOUNT_CHANGES_PER_HOUR) throw new AppError("RATE_LIMITED", "اتعمل حسابات أو تغيير كلمات سر كتير في ساعة. جرّب بعد شوية.");
}

function field<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown, name: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError("VALIDATION_ERROR", undefined, { fieldErrors: { [name]: [r.error.issues[0]?.message ?? "قيمة غير صحيحة"] } });
  return r.data;
}

/** Creates a STAFF account with NO permissions. Owner only, with re-authentication. */
export async function createStaffAccount(
  db: PrismaClient,
  actor: Actor,
  payload: { name: unknown; email: unknown; password: unknown; ownerPassword: unknown },
): Promise<{ userId: string }> {
  requireOwnerActor(actor);
  const name = field(userNameSchema, payload.name, "name");
  const email = field(emailSchema, payload.email, "email");
  const password = field(newPasswordSchema, payload.password, "password");
  await assertAccountChangeBudget(db, actor);
  await reauthenticateOwner(db, actor, payload.ownerPassword);
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    if (await findUserByEmail(tx, email)) throw new AppError("CONFLICT", "الإيميل ده مستخدم في حساب تاني", { fieldErrors: { email: ["الإيميل ده مستخدم في حساب تاني"] } });
    const user = await createUser(tx, { name, email, passwordHash, role: "STAFF", permissions: [] });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.USER_CREATED, entityType: "User", entityId: user.id, metadata: { role: "STAFF", email, source: SOURCE } });
    return { userId: user.id };
  });
}

/** Sets a STAFF account's password and signs it out everywhere. Owner only, with re-authentication. */
export async function resetStaffPassword(db: PrismaClient, actor: Actor, payload: { userId: unknown; password: unknown; ownerPassword: unknown }) {
  requireOwnerActor(actor);
  const userId = UUID.safeParse(payload.userId);
  if (!userId.success) throw new AppError("NOT_FOUND", "الحساب مش موجود");
  const password = field(newPasswordSchema, payload.password, "password");
  await assertAccountChangeBudget(db, actor);
  await reauthenticateOwner(db, actor, payload.ownerPassword);
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const row = await lockStaffAccount(tx, actor, userId.data, undefined);
    await tx.user.update({ where: { id: userId.data }, data: { passwordHash } });
    const { count } = await deleteSessionsForUser(tx, userId.data);
    await tx.loginAttempt.deleteMany({ where: { email: row.email } });
    await recordAudit(tx, { userId: actor.id, action: AUDIT_ACTIONS.USER_PASSWORD_RESET, entityType: "User", entityId: userId.data, metadata: { sessionsRevoked: count, source: SOURCE } });
    return { sessionsRevoked: count };
  });
}
