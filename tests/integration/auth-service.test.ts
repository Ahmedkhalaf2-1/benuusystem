import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_DURATION_MS, hashSessionToken } from "@/lib/auth/session-token";
import { login, logout, validateSessionToken } from "@/server/services/auth-service";
import { LOGIN_RATE_LIMIT } from "@/server/services/login-rate-limit-service";
import {
  createTestPrisma,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
} from "../support/test-db";

const PASSWORD = "S3cure-pass-word";
const ctx = { ipAddress: "203.0.113.10" };

describe.skipIf(!hasTestDatabase)("auth service (PostgreSQL)", () => {
  let db: PrismaClient;
  let passwordHash: string;

  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
    passwordHash = await hashPassword(PASSWORD);
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function createUser(overrides: { email?: string; isActive?: boolean } = {}) {
    return db.user.create({
      data: {
        name: "سارة محمد",
        email: overrides.email ?? "staff@benuuprint.test",
        passwordHash,
        role: "STAFF",
        isActive: overrides.isActive ?? true,
      },
    });
  }

  it("logs in with correct credentials and creates a hashed session", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "STAFF",
      isActive: true,
    });
    expect(result.user).not.toHaveProperty("passwordHash");

    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(hashSessionToken(result.token));
    expect(sessions[0]!.tokenHash).not.toBe(result.token);

    const audit = await db.auditLog.findMany({ where: { action: "LOGIN_SUCCESS" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.userId).toBe(user.id);
  });

  it("rejects a wrong password, records the failure and audits it", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: "wrong-password" }, ctx);

    expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await db.session.count()).toBe(0);
    expect(await db.loginAttempt.count({ where: { email: user.email } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "LOGIN_FAILED", userId: user.id } })).toBe(1);
  });

  it("gives the same answer for an unknown email (no user enumeration)", async () => {
    const result = await login(db, { email: "nobody@benuuprint.test", password: PASSWORD }, ctx);
    expect(result).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("does not let an inactive account log in", async () => {
    const user = await createUser({ isActive: false });
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    expect(result).toEqual({ ok: false, reason: "INACTIVE" });
    expect(await db.session.count()).toBe(0);
  });

  it("rate-limits an email after repeated failures, even with the right password", async () => {
    const user = await createUser();
    const now = new Date("2026-06-01T10:00:00Z");

    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailuresPerEmail; i++) {
      const failed = await login(db, { email: user.email, password: "nope" }, { ...ctx, now });
      expect(failed.ok).toBe(false);
    }

    const blocked = await login(db, { email: user.email, password: PASSWORD }, { ...ctx, now });
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.reason !== "RATE_LIMITED") throw new Error("expected RATE_LIMITED");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.windowMs / 1000);
    expect(await db.session.count()).toBe(0);

    // Once the window has passed, the right password works again.
    const afterWindow = new Date(now.getTime() + LOGIN_RATE_LIMIT.windowMs + 1000);
    const allowed = await login(db, { email: user.email, password: PASSWORD }, { ...ctx, now: afterWindow });
    expect(allowed.ok).toBe(true);
  });

  it("rate-limits by IP across different emails", async () => {
    const now = new Date();
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailuresPerIp; i++) {
      await login(db, { email: `guess${i}@benuuprint.test`, password: "x" }, { ...ctx, now });
    }
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, { ...ctx, now });
    expect(result.ok === false && result.reason).toBe("RATE_LIMITED");

    // A different IP is not affected.
    const other = await login(db, { email: user.email, password: PASSWORD }, { ipAddress: "198.51.100.7", now });
    expect(other.ok).toBe(true);
  });

  it("validates a live session and resolves its user", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    if (!result.ok) throw new Error("login failed");

    const session = await validateSessionToken(db, result.token);
    expect(session?.user.id).toBe(user.id);
  });

  it("rejects missing, malformed and unknown tokens", async () => {
    expect(await validateSessionToken(db, undefined)).toBeNull();
    expect(await validateSessionToken(db, "garbage")).toBeNull();
    expect(await validateSessionToken(db, "a".repeat(43))).toBeNull();
  });

  it("rejects and deletes expired sessions", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    if (!result.ok) throw new Error("login failed");

    const later = new Date(Date.now() + SESSION_DURATION_MS + 1000);
    expect(await validateSessionToken(db, result.token, later)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("logs out a deactivated user immediately", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    if (!result.ok) throw new Error("login failed");

    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await validateSessionToken(db, result.token)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("extends a session used in the second half of its lifetime", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    if (!result.ok) throw new Error("login failed");

    const later = new Date(Date.now() + SESSION_DURATION_MS * 0.75);
    const session = await validateSessionToken(db, result.token, later);
    expect(session).not.toBeNull();
    expect(session!.expiresAt.getTime()).toBe(later.getTime() + SESSION_DURATION_MS);
  });

  it("logout deletes the session and audits it", async () => {
    const user = await createUser();
    const result = await login(db, { email: user.email, password: PASSWORD }, ctx);
    if (!result.ok) throw new Error("login failed");

    await logout(db, result.token, ctx);
    expect(await validateSessionToken(db, result.token)).toBeNull();
    expect(await db.auditLog.count({ where: { action: "LOGOUT", userId: user.id } })).toBe(1);
  });
});
