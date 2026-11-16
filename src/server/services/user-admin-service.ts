import { Role } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { AppError } from "@/lib/errors";
import { emailSchema, newPasswordSchema, userNameSchema } from "@/lib/validations/auth";
import { clearFailuresForEmail } from "@/server/repositories/login-attempt-repository";
import { deleteSessionsForUser } from "@/server/repositories/session-repository";
import { createUser, findUserByEmail, publicUserSelect, type PublicUser } from "@/server/repositories/user-repository";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";

/**
 * Account administration for the server operator (`npm run users -- …`).
 * There is no web UI for this on purpose: it runs on the VPS shell only, so a
 * stolen browser session can never create accounts or reset passwords.
 *
 * Every change that weakens an existing login (password reset, deactivation,
 * revocation) deletes that user's sessions in the same transaction, so it
 * takes effect on every device immediately.
 */

const SOURCE = "cli:users";

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError("VALIDATION_ERROR", r.error.issues[0]?.message);
  return r.data;
}

async function requireUserByEmail(db: PrismaClient, rawEmail: string): Promise<PublicUser> {
  const user = await findUserByEmail(db, parse(emailSchema, rawEmail));
  if (!user) throw new AppError("NOT_FOUND", "No account with this email.");
  return user;
}

export async function listUsers(db: PrismaClient) {
  const users = await db.user.findMany({
    select: { ...publicUserSelect, createdAt: true, _count: { select: { sessions: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return users.map(({ _count, ...u }) => ({ ...u, sessions: _count.sessions }));
}

/**
 * Creates a STAFF account with NO permissions (deny by default); the owner
 * grants them in the app. Owners are only created by `npm run admin:create`.
 */
export async function createStaffUser(db: PrismaClient, input: { name: string; email: string; password: string }): Promise<PublicUser> {
  const name = parse(userNameSchema, input.name);
  const email = parse(emailSchema, input.email);
  const passwordHash = await hashPassword(parse(newPasswordSchema, input.password));
  return db.$transaction(async (tx) => {
    if (await findUserByEmail(tx, email)) throw new AppError("CONFLICT", "This email is already used.");
    const user = await createUser(tx, { name, email, passwordHash, role: Role.STAFF, permissions: [] });
    await recordAudit(tx, { userId: null, action: AUDIT_ACTIONS.USER_CREATED, entityType: "User", entityId: user.id, metadata: { role: user.role, source: SOURCE } });
    return user;
  });
}

/** Sets a new password, signs the user out everywhere and clears their failed-login counter. */
export async function resetUserPassword(db: PrismaClient, input: { email: string; password: string }): Promise<{ user: PublicUser; sessionsRevoked: number }> {
  const user = await requireUserByEmail(db, input.email);
  const passwordHash = await hashPassword(parse(newPasswordSchema, input.password));
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    const { count } = await deleteSessionsForUser(tx, user.id);
    await clearFailuresForEmail(tx, user.email);
    await recordAudit(tx, { userId: null, action: AUDIT_ACTIONS.USER_PASSWORD_RESET, entityType: "User", entityId: user.id, metadata: { sessionsRevoked: count, source: SOURCE } });
    return { user, sessionsRevoked: count };
  });
}

/**
 * Deactivating blocks sign-in and ends every session. The last active owner
 * can never be deactivated, so the business cannot lock itself out.
 */
export async function setUserActive(db: PrismaClient, input: { email: string; active: boolean }): Promise<{ user: PublicUser; sessionsRevoked: number }> {
  const user = await requireUserByEmail(db, input.email);
  return db.$transaction(async (tx) => {
    if (!input.active && user.role === Role.OWNER_ADMIN) {
      const otherOwners = await tx.user.count({ where: { role: Role.OWNER_ADMIN, isActive: true, id: { not: user.id } } });
      if (otherOwners === 0) throw new AppError("CONFLICT", "This is the only active owner account; it cannot be deactivated.");
    }
    const updated = await tx.user.update({ where: { id: user.id }, data: { isActive: input.active }, select: publicUserSelect });
    const { count } = input.active ? { count: 0 } : await deleteSessionsForUser(tx, user.id);
    await recordAudit(tx, {
      userId: null,
      action: input.active ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
      entityType: "User",
      entityId: user.id,
      metadata: { sessionsRevoked: count, source: SOURCE },
    });
    return { user: updated, sessionsRevoked: count };
  });
}

/** Signs a user out on every device (e.g. a lost phone) without changing the password. */
export async function revokeUserSessions(db: PrismaClient, rawEmail: string): Promise<{ user: PublicUser; sessionsRevoked: number }> {
  const user = await requireUserByEmail(db, rawEmail);
  return db.$transaction(async (tx) => {
    const { count } = await deleteSessionsForUser(tx, user.id);
    await recordAudit(tx, { userId: null, action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED, entityType: "User", entityId: user.id, metadata: { sessionsRevoked: count, source: SOURCE } });
    return { user, sessionsRevoked: count };
  });
}
