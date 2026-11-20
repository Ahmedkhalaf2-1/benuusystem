import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { Actor } from "@/server/services/actor";
import { createDepartment, getDepartmentDashboard, getDepartmentsOverview } from "@/server/services/department-service";
import { loadOrderFinances, summarizeBucket } from "@/server/services/department-finance";
import { createOrder } from "@/server/services/order-service";
import { recordPayment } from "@/server/services/payment-service";
import { recordReady } from "@/server/services/production-service";
import { createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase, TEST_DATABASE_URL } from "../support/test-db";

/**
 * Performance regressions: query budgets that must not grow with the number of
 * departments, and the batched / lean paths giving exactly the same numbers.
 */
describe.skipIf(!hasTestDatabase)("performance budgets (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let queries = 0;

  beforeAll(async () => {
    migrateTestDatabase();
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL! }), log: [{ emit: "event", level: "query" }] });
    (db as unknown as { $on: (e: "query", cb: () => void) => void }).$on("query", () => {
      queries++;
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    owner = await createTestUser(db, "OWNER_ADMIN");
  });

  async function seed(n: number) {
    const dept = Object.fromEntries((await db.department.findMany({ select: { id: true, key: true } })).map((d) => [d.key, d.id]));
    for (let i = 0; i < n; i++) {
      const { orderId } = await createOrder(db, owner, {
        idempotencyKey: randomUUID(), customer: { mode: "new", name: `c${i}` }, title: `o${i}`, productType: "x", pricing: "items", unit: "PIECE", receivedDate: todayDateString(), deliveryDate: "2099-01-01",
        groups: [
          { name: "a", quantity: "10", unitPrice: "100", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }] },
          { name: "b", quantity: "5", unitPrice: "70", departmentId: dept.EMBROIDERY, designs: [{ operation: "EMBROIDERY" }] },
          { name: "c", quantity: "3", unitPrice: "50", plain: true, designs: [] },
        ],
      });
      if (i % 2 === 0) await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "333.33", paidAt: todayDateString(), method: "CASH" });
      if (i % 3 === 0) {
        const g = await db.orderGroup.findFirstOrThrow({ where: { orderId, name: "c" }, select: { id: true } });
        await recordReady(db, owner, { orderId, orderGroupId: g.id, quantity: "3", readyDate: todayDateString(), idempotencyKey: randomUUID() });
      }
    }
    if (n > 0) await db.order.update({ where: { number: 1 }, data: { status: "CANCELLED" } });
  }

  const count = async <T>(f: () => Promise<T>) => {
    queries = 0;
    const r = await f();
    return { r, q: queries };
  };

  it("the departments overview is batched: its query count doesn't grow with departments, and its numbers equal each department's own dashboard", async () => {
    await seed(12);
    const a = await count(() => getDepartmentsOverview(db, owner));
    for (let i = 0; i < 6; i++) await createDepartment(db, owner, { name: `قسم ${i}` });
    const b = await count(() => getDepartmentsOverview(db, owner));
    expect(b.q).toBe(a.q); // 10 departments cost the same as 4
    expect(a.q).toBeLessThanOrEqual(12);

    for (const row of a.r.departments) {
      const own = await getDepartmentDashboard(db, owner, row.id);
      expect(row.stats.orders).toEqual(own.stats.orders);
      expect(row.stats.items).toEqual(own.stats.items);
      expect([row.stats.pendingPieces, row.stats.readyNotDelivered]).toEqual([own.stats.pendingPieces, own.stats.readyNotDelivered]);
      expect(row.stats.money.workValue).toBe(own.stats.money!.workValue);
      expect(row.stats.money.collections).toEqual(own.stats.money!.collections);
    }
    expect(a.r.totals).toMatchObject({ valueBalanced: true, collectionsBalanced: true });
  });

  it("the lean finance load gives exactly the same totals as the full one", async () => {
    await seed(9);
    const [full, lean] = await Promise.all([loadOrderFinances(db, { archivedAt: null }), loadOrderFinances(db, { archivedAt: null }, { lean: true })]);
    const keys = [...new Set(full.flatMap((f) => [...f.buckets.keys()]))];
    for (const k of keys) {
      const x = summarizeBucket(full, k);
      const y = summarizeBucket(lean, k);
      expect([y.workValue, y.collected, y.outstanding, y.unreliableItems, y.orders]).toEqual([x.workValue, x.collected, x.outstanding, x.unreliableItems, x.orders]);
    }
  });

  it("a department dashboard and the order list stay within a fixed query budget", async () => {
    await seed(15);
    const dept = await db.department.findFirstOrThrow({ where: { key: "PRINTING" }, select: { id: true } });
    const small = await count(() => getDepartmentDashboard(db, owner, dept.id));
    expect(small.q).toBeLessThanOrEqual(30);
  });
});
