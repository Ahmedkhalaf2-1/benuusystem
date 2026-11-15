import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { AppError } from "@/lib/errors";
import { createFirstOwnerAdmin } from "@/server/services/admin-bootstrap-service";
import {
  TEST_DATABASE_URL,
  createTestPrisma,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
} from "../support/test-db";

const OWNER = { name: "أحمد خلف", email: "Owner@Benuuprint.test", password: "owner-pass-123" };

describe.skipIf(!hasTestDatabase)("owner/admin bootstrap (PostgreSQL)", () => {
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
  });

  it("creates the first OWNER_ADMIN with an Argon2id hash and an audit entry", async () => {
    const user = await createFirstOwnerAdmin(db, OWNER);
    expect(user.role).toBe("OWNER_ADMIN");
    expect(user.email).toBe("owner@benuuprint.test");

    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored.passwordHash, OWNER.password)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "USER_CREATED", entityId: user.id } })).toBe(1);
  });

  it("refuses to create a second owner", async () => {
    await createFirstOwnerAdmin(db, OWNER);
    await expect(
      createFirstOwnerAdmin(db, { ...OWNER, email: "other@benuuprint.test" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count({ where: { role: "OWNER_ADMIN" } })).toBe(1);
  });

  it("creates exactly one owner when two runs race", async () => {
    const results = await Promise.allSettled([
      createFirstOwnerAdmin(db, OWNER),
      createFirstOwnerAdmin(db, { ...OWNER, email: "second@benuuprint.test" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { role: "OWNER_ADMIN" } })).toBe(1);
  });

  it("validates input", async () => {
    await expect(createFirstOwnerAdmin(db, { ...OWNER, password: "short" })).rejects.toBeInstanceOf(
      AppError,
    );
    expect(await db.user.count()).toBe(0);
  });

  describe("npm run admin:create (CLI process)", () => {
    function runCli(stdinText: string) {
      return spawnSync("npx", ["tsx", "scripts/create-admin.ts"], {
        input: stdinText,
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        encoding: "utf8",
        timeout: 60_000,
      });
    }

    it("creates the owner from piped answers, then refuses a second run", async () => {
      const answers = `${OWNER.name}\n${OWNER.email}\n${OWNER.password}\n${OWNER.password}\n`;
      const first = runCli(answers);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toContain("Owner account created for owner@benuuprint.test");
      expect(first.stdout).not.toContain(OWNER.password);

      const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@benuuprint.test" } });
      expect(owner.role).toBe("OWNER_ADMIN");

      const second = runCli(answers);
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("already exists");
      expect(await db.user.count()).toBe(1);
    });

    it("rejects mismatched password confirmation without creating anything", async () => {
      const result = runCli(`${OWNER.name}\n${OWNER.email}\n${OWNER.password}\nsomething-else\n`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Passwords do not match");
      expect(await db.user.count()).toBe(0);
    });

    it("refuses a password passed as an argument", () => {
      const result = spawnSync("npx", ["tsx", "scripts/create-admin.ts", "--password=abc"], {
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not supported");
    });
  });
});
