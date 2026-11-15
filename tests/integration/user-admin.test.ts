import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { createFirstOwnerAdmin } from "@/server/services/admin-bootstrap-service";
import { login, validateSessionToken } from "@/server/services/auth-service";
import {
  createStaffUser,
  listUsers,
  resetUserPassword,
  revokeUserSessions,
  setUserActive,
} from "@/server/services/user-admin-service";
import { createTestPrisma, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const OWNER = { name: "المالك", email: "owner@benuuprint.test", password: "owner-pass-123" };
const STAFF = { name: "موظف", email: "Staff@Benuuprint.test", password: "staff-pass-123" };
const ctx = { ipAddress: "203.0.113.9" };

describe.skipIf(!hasTestDatabase)("account administration CLI service (PostgreSQL)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await createFirstOwnerAdmin(db, OWNER);
  });

  async function signIn(email: string, password: string) {
    const r = await login(db, { email: email.toLowerCase(), password }, ctx);
    if (!r.ok) throw new Error(`login failed: ${r.reason}`);
    return r.token;
  }

  it("creates a STAFF account with a normalized email and an Argon2id hash", async () => {
    const user = await createStaffUser(db, STAFF);
    expect(user).toMatchObject({ role: "STAFF", email: "staff@benuuprint.test", isActive: true });
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(createStaffUser(db, STAFF)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createStaffUser(db, { ...STAFF, email: "x@benuuprint.test", password: "short" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listUsers(db)).map((u) => u.role)).toEqual(["OWNER_ADMIN", "STAFF"]);
  });

  it("password reset replaces the hash and signs the user out on every device", async () => {
    await createStaffUser(db, STAFF);
    const a = await signIn(STAFF.email, STAFF.password);
    const b = await signIn(STAFF.email, STAFF.password);

    const r = await resetUserPassword(db, { email: STAFF.email, password: "brand-new-pass-1" });
    expect(r.sessionsRevoked).toBe(2);
    expect(await validateSessionToken(db, a)).toBeNull();
    expect(await validateSessionToken(db, b)).toBeNull();

    const stored = await db.user.findUniqueOrThrow({ where: { email: "staff@benuuprint.test" } });
    expect(await verifyPassword(stored.passwordHash, STAFF.password)).toBe(false);
    expect(await verifyPassword(stored.passwordHash, "brand-new-pass-1")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "USER_PASSWORD_RESET", entityId: stored.id } })).toBe(1);
  });

  it("password reset clears the failed-login lockout for that email", async () => {
    await createStaffUser(db, STAFF);
    for (let i = 0; i < 5; i++) await login(db, { email: "staff@benuuprint.test", password: "wrong-password" }, ctx);
    expect((await login(db, { email: "staff@benuuprint.test", password: STAFF.password }, ctx)).ok).toBe(false);
    await resetUserPassword(db, { email: STAFF.email, password: "brand-new-pass-1" });
    expect((await login(db, { email: "staff@benuuprint.test", password: "brand-new-pass-1" }, ctx)).ok).toBe(true);
  });

  it("deactivation blocks sign-in and ends sessions; activation restores sign-in", async () => {
    await createStaffUser(db, STAFF);
    const token = await signIn(STAFF.email, STAFF.password);
    const r = await setUserActive(db, { email: STAFF.email, active: false });
    expect(r.sessionsRevoked).toBe(1);
    expect(await validateSessionToken(db, token)).toBeNull();
    expect(await login(db, { email: "staff@benuuprint.test", password: STAFF.password }, ctx)).toMatchObject({ ok: false, reason: "INACTIVE" });

    await setUserActive(db, { email: STAFF.email, active: true });
    expect((await login(db, { email: "staff@benuuprint.test", password: STAFF.password }, ctx)).ok).toBe(true);
  });

  it("never deactivates the only active owner", async () => {
    await expect(setUserActive(db, { email: OWNER.email, active: false })).rejects.toMatchObject({ code: "CONFLICT" });
    const owner = await db.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    expect(owner.isActive).toBe(true);
  });

  it("revokes sessions without changing the password", async () => {
    const token = await signIn(OWNER.email, OWNER.password);
    expect((await revokeUserSessions(db, OWNER.email)).sessionsRevoked).toBe(1);
    expect(await validateSessionToken(db, token)).toBeNull();
    expect((await login(db, { email: OWNER.email, password: OWNER.password }, ctx)).ok).toBe(true);
  });

  it("reports unknown emails as NOT_FOUND", async () => {
    await expect(resetUserPassword(db, { email: "nobody@benuuprint.test", password: "whatever-123" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
