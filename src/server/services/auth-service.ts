import type { DbClient } from "@/lib/db/prisma";
import {
  getDummyPasswordHash,
  verifyPassword,
} from "@/lib/auth/password";
import {
  SESSION_DURATION_MS,
  SESSION_REFRESH_THRESHOLD_MS,
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/lib/auth/session-token";
import type { LoginInput } from "@/lib/validations/auth";
import { clearFailuresForEmail } from "@/server/repositories/login-attempt-repository";
import {
  createSession,
  deleteExpiredSessions,
  deleteSessionById,
  deleteSessionByTokenHash,
  extendSession,
  findSessionWithUser,
} from "@/server/repositories/session-repository";
import {
  findUserByEmailWithPassword,
  type PublicUser,
} from "@/server/repositories/user-repository";
import { AUDIT_ACTIONS, recordAudit } from "./audit-service";
import {
  checkLoginRateLimit,
  pruneOldLoginAttempts,
  recordLoginFailure,
} from "./login-rate-limit-service";

export type RequestContext = {
  ipAddress: string;
  now?: Date;
};

export type LoginResult =
  | { ok: true; user: PublicUser; token: string; expiresAt: Date }
  | { ok: false; reason: "INVALID_CREDENTIALS" }
  | { ok: false; reason: "INACTIVE" }
  | { ok: false; reason: "RATE_LIMITED"; retryAfterSeconds: number };

/**
 * Verifies credentials and, on success, creates a new session.
 * Input must already be validated by `loginSchema` (email normalized).
 */
export async function login(
  db: DbClient,
  input: LoginInput,
  context: RequestContext,
): Promise<LoginResult> {
  const now = context.now ?? new Date();
  const { email, password } = input;
  const { ipAddress } = context;

  const limit = await checkLoginRateLimit(db, { email, ipAddress, now });
  if (!limit.allowed) {
    await recordAudit(db, {
      userId: null,
      action: AUDIT_ACTIONS.LOGIN_RATE_LIMITED,
      metadata: { email, ipAddress },
    });
    return { ok: false, reason: "RATE_LIMITED", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const user = await findUserByEmailWithPassword(db, email);
  // Always run one Argon2 verification so unknown emails take as long as known ones.
  const passwordOk = await verifyPassword(
    user?.passwordHash ?? (await getDummyPasswordHash()),
    password,
  );

  if (!user || !passwordOk) {
    await recordLoginFailure(db, { email, ipAddress, now });
    await recordAudit(db, {
      userId: user?.id ?? null,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: user ? "User" : undefined,
      entityId: user?.id,
      metadata: { email, ipAddress },
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (!user.isActive) {
    await recordAudit(db, {
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN_BLOCKED_INACTIVE,
      entityType: "User",
      entityId: user.id,
      metadata: { ipAddress },
    });
    return { ok: false, reason: "INACTIVE" };
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  await createSession(db, { tokenHash: hashSessionToken(token), userId: user.id, expiresAt });
  await clearFailuresForEmail(db, email);
  await recordAudit(db, {
    userId: user.id,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entityType: "User",
    entityId: user.id,
    metadata: { ipAddress },
  });

  // Housekeeping; cheap thanks to the expires_at / created_at indexes.
  await Promise.all([deleteExpiredSessions(db, now), pruneOldLoginAttempts(db, now)]);

  const publicUser: PublicUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    permissions: user.permissions,
  };
  return { ok: true, user: publicUser, token, expiresAt };
}

export type ValidatedSession = {
  sessionId: string;
  user: PublicUser;
  expiresAt: Date;
};

/**
 * Resolves a session token to its active user, or null.
 * Expired sessions and sessions of deactivated users are deleted on sight,
 * so deactivating a user logs them out on their next request.
 * Sessions used in their second half are extended (sliding expiry).
 */
export async function validateSessionToken(
  db: DbClient,
  token: string | undefined | null,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  if (!token || !isWellFormedSessionToken(token)) return null;

  const session = await findSessionWithUser(db, hashSessionToken(token));
  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime() || !session.user.isActive) {
    await deleteSessionById(db, session.id);
    return null;
  }

  let expiresAt = session.expiresAt;
  if (expiresAt.getTime() - now.getTime() < SESSION_REFRESH_THRESHOLD_MS) {
    expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    await extendSession(db, session.id, expiresAt);
  }

  return { sessionId: session.id, user: session.user, expiresAt };
}

/** Deletes the session for this token (if any) and audits the logout. */
export async function logout(
  db: DbClient,
  token: string | undefined | null,
  context: RequestContext,
): Promise<void> {
  if (!token || !isWellFormedSessionToken(token)) return;
  const tokenHash = hashSessionToken(token);
  const session = await findSessionWithUser(db, tokenHash);
  await deleteSessionByTokenHash(db, tokenHash);
  if (session) {
    await recordAudit(db, {
      userId: session.user.id,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: "User",
      entityId: session.user.id,
      metadata: { ipAddress: context.ipAddress },
    });
  }
}
