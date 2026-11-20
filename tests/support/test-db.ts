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
      '"order_group_sizes", "order_group_operations", "order_groups", "order_payments", "orders", "customers", ' +
      '"monthly_close_events", "monthly_closes", "recurring_expenses", "audit_logs", "sessions", "login_attempts", "department_members", "departments", "product_presets", "users" CASCADE',
  );
  // The four departments the Phase 2 migration seeds.
  await db.$executeRawUnsafe(
    `INSERT INTO "departments" ("id", "key", "name", "sort_order", "updated_at") VALUES
      (gen_random_uuid(), 'EMBROIDERY', 'تطريز', 1, now()),
      (gen_random_uuid(), 'COVERS', 'كوفرات', 2, now()),
      (gen_random_uuid(), 'PRINTING', 'طباعة', 3, now()),
      (gen_random_uuid(), 'GARMENTS', 'ملابس / منتج كامل', 4, now())`,
  );
  // The «منتج جاهز» presets the Phase 3 migration seeds.
  await db.$executeRawUnsafe(
    `INSERT INTO "product_presets" ("id", "name", "sort_order", "updated_at") VALUES
      (gen_random_uuid(), 'تيشيرت', 1, now()), (gen_random_uuid(), 'هودي', 2, now()), (gen_random_uuid(), 'سويت شيرت', 3, now()),
      (gen_random_uuid(), 'بولو', 4, now()), (gen_random_uuid(), 'كاب', 5, now()), (gen_random_uuid(), 'شنطة', 6, now())`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "counters" ("key", "value") VALUES ('order_number', 0)
     ON CONFLICT ("key") DO UPDATE SET "value" = 0`,
  );
}

/**
 * The grants the Phase 10 migration writes onto pre-existing STAFF accounts
 * (= what the old STAFF role could do). Older tests use it as "a typical
 * staff member"; new staff accounts start with none.
 */
export const LEGACY_STAFF_PERMISSIONS = [
  "orders:view", "orders:view-prices", "orders:create", "orders:edit",
  "production:view", "production:record", "deliveries:view", "deliveries:record",
  "customers:view", "customers:view-contact", "customers:manage",
  "payments:view", "payments:record",
  "costs:record", "expenses:record", "payables:pay",
  "suppliers:view", "suppliers:manage",
  "workers:view", "work:record",
];

/** Creates a user directly (tests only) and returns it as a service Actor. */
export async function createTestUser(
  db: PrismaClient,
  role: "OWNER_ADMIN" | "STAFF" | "PARTNER",
  email = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@benuuprint.test`,
  permissions: string[] = role === "STAFF" ? LEGACY_STAFF_PERMISSIONS : [],
) {
  const user = await db.user.create({
    data: { name: role === "OWNER_ADMIN" ? "المدير" : role === "PARTNER" ? "شريك" : "موظف", email, passwordHash: "not-used", role, permissions },
    select: { id: true, role: true, name: true, permissions: true },
  });
  return user;
}

/** Makes an order visible to every authorized staff member (tests only). */
export async function shareWithAllStaff(db: PrismaClient, orderId: string) {
  await db.order.update({ where: { id: orderId }, data: { visibility: "ALL_AUTHORIZED_STAFF" } });
}

/**
 * Owner-created order shared with all authorized staff — the setup older
 * tests assumed before per-order visibility existed (orders default to PRIVATE).
 */
export async function createSharedOrder(...args: Parameters<typeof import("@/server/services/order-service").createOrder>) {
  const { createOrder } = await import("@/server/services/order-service");
  const [db, actor, payload] = args;
  return createOrder(db, actor, payload, { visibility: "ALL_AUTHORIZED_STAFF" });
}
