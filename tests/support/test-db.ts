import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Integration tests need a disposable PostgreSQL database in TEST_DATABASE_URL.
 * Without it they are skipped (and say so) rather than reported as passing.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

if (!hasTestDatabase) {
  console.warn(
    "\n⚠ TEST_DATABASE_URL is not set — database integration tests are SKIPPED.\n",
  );
}

let migrated = false;

/** Applies migrations to the test database once per test run. */
export function migrateTestDatabase(): void {
  if (migrated || !TEST_DATABASE_URL) return;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  migrated = true;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL! }) });
}

export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "deliveries", "production_ready", "production_stage_progress", ' +
      '"worker_work_logs", "worker_workdays", "workers", ' +
      '"outgoing_payments", "order_costs", "general_expenses", "suppliers", ' +
      '"order_group_operations", "order_groups", "order_payments", "orders", "customers", ' +
      '"audit_logs", "sessions", "login_attempts", "users" CASCADE',
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "counters" ("key", "value") VALUES ('order_number', 0)
     ON CONFLICT ("key") DO UPDATE SET "value" = 0`,
  );
}

/** Creates a user directly (tests only) and returns it as a service Actor. */
export async function createTestUser(
  db: PrismaClient,
  role: "OWNER_ADMIN" | "STAFF",
  email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@benuuprint.test`,
) {
  const user = await db.user.create({
    data: { name: role === "OWNER_ADMIN" ? "المدير" : "موظف", email, passwordHash: "not-used", role },
    select: { id: true, role: true, name: true },
  });
  return user;
}
