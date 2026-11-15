import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import {
  createCustomer,
  getCustomerDetails,
  listCustomers,
  searchCustomers,
  updateCustomer,
} from "@/server/services/customer-service";
import {
  createOrder,
  getDashboardStats,
  getOrderDetails,
  listOrders,
  updateOrder,
} from "@/server/services/order-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import {
  createTestPrisma,
  createTestUser,
  hasTestDatabase,
  migrateTestDatabase,
  resetDatabase,
} from "../support/test-db";

const TODAY = todayDateString();

function orderPayload(overrides: Partial<CreateOrderPayload> = {}): CreateOrderPayload {
  return {
    idempotencyKey: randomUUID(),
    customer: { mode: "new", name: "محمود" },
    title: "تيشيرتات محمود",
    productType: "تيشيرت",
    material: "قطن",
    quantity: "200",
    unit: "PIECE",
    groups: [{ operations: ["DTF"], plain: false }],
    totalPrice: "40000",
    advance: "0",
    advanceMethod: "CASH",
    receivedDate: TODAY,
    deliveryDate: "2099-12-31",
    ...overrides,
  };
}

function payment(orderId: string, amount: string, extra: Record<string, unknown> = {}) {
  return { orderId, idempotencyKey: randomUUID(), amount, paidAt: TODAY, method: "CASH", ...extra };
}

describe.skipIf(!hasTestDatabase)("customers & orders (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;

  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    owner = await createTestUser(db, "OWNER_ADMIN");
    staff = await createTestUser(db, "STAFF");
  });

  // ─── Customers ───

  it("creates a customer (Arabic digits in phone normalized) and audits it", async () => {
    const customer = await createCustomer(db, staff, { name: "  محمود  ", phone: "٠١٠١٢٣٤٥٦٧٨" });
    expect(customer.name).toBe("محمود");
    expect(customer.phone).toBe("01012345678");
    expect(await db.auditLog.count({ where: { action: "CUSTOMER_CREATED", entityId: customer.id } })).toBe(1);
  });

  it("allows duplicate customer names and rejects an empty name", async () => {
    await createCustomer(db, staff, { name: "محمود" });
    await createCustomer(db, staff, { name: "محمود" });
    expect(await db.customer.count({ where: { name: "محمود" } })).toBe(2);
    await expect(createCustomer(db, staff, { name: "   " })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("searches customers by part of the name or phone (including Arabic digits)", async () => {
    await createCustomer(db, staff, { name: "محمود علي", phone: "01012345678" });
    await createCustomer(db, staff, { name: "سارة", phone: "01255555555" });

    expect((await searchCustomers(db, staff, "محمو")).map((c) => c.name)).toEqual(["محمود علي"]);
    expect((await searchCustomers(db, staff, "2345")).map((c) => c.name)).toEqual(["محمود علي"]);
    expect((await searchCustomers(db, staff, "٥٥٥٥")).map((c) => c.name)).toEqual(["سارة"]);
    expect((await listCustomers(db, staff, { query: "سار" })).total).toBe(1);
  });

  it("edits a customer and audits the change", async () => {
    const customer = await createCustomer(db, staff, { name: "محمود" });
    await updateCustomer(db, staff, customer.id, { name: "محمود حسن", phone: "01000000000" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "CUSTOMER_UPDATED" } });
    expect(log.metadata).toMatchObject({ changes: { name: { from: "محمود", to: "محمود حسن" } } });
  });

  // ─── Acceptance scenario ───

  it("acceptance: Mahmoud's 200 T-shirts in 3 groups, advance, then a second payment", async () => {
    const mahmoud = await createCustomer(db, owner, { name: "محمود" });
    const result = await createOrder(
      db,
      owner,
      orderPayload({
        customer: { mode: "existing", id: mahmoud.id },
        title: "200 تيشيرت",
        quantity: "200",
        material: "قطن",
        groups: [
          { quantity: "100", operations: ["DTF"], plain: false },
          { quantity: "50", operations: ["EMBROIDERY"], plain: false },
          { quantity: "50", operations: ["DTF", "EMBROIDERY"], plain: false },
        ],
        totalPrice: "40,000",
        advance: "20000",
        deliveryDate: "2099-01-15",
      }),
    );
    expect(result).toMatchObject({ number: 1, created: true });

    let details = (await getOrderDetails(db, owner, result.orderId))!;
    expect(details.quantity).toBe(200);
    expect(details.groups.map((g) => [g.quantity, g.material, g.description])).toEqual([
      [100, "قطن", "DTF"],
      [50, "قطن", "تطريز"],
      [50, "قطن", "DTF + تطريز"],
    ]);
    // Physical pieces are not duplicated by having two operations.
    expect(details.groups.reduce((sum, g) => sum + g.quantity, 0)).toBe(200);
    expect(details.totalPrice).toBe("40000.00");
    expect(details.paid).toBe("20000.00");
    expect(details.outstanding).toBe("20000.00");
    expect(details.payments).toHaveLength(1);
    expect(details.payments[0]).toMatchObject({ isAdvance: true, amount: "20000.00" });
    expect(details.deliveryDate).toBe("2099-01-15");

    const list = await listOrders(db, staff, {});
    expect(list.items.map((o) => [o.customerName, o.paid, o.outstanding])).toEqual([
      ["محمود", "20000.00", "20000.00"],
    ]);

    await recordPayment(db, staff, payment(result.orderId, "5000"));
    details = (await getOrderDetails(db, owner, result.orderId))!;
    expect(details.paid).toBe("25000.00");
    expect(details.outstanding).toBe("15000.00");

    const customer = (await getCustomerDetails(db, staff, mahmoud.id))!;
    expect(customer.totals).toEqual({ agreed: "40000.00", paid: "25000.00", outstanding: "15000.00" });
    expect(customer.orders).toHaveLength(1);
  });

  // ─── Order creation rules ───

  it("creates the customer inline in the same transaction", async () => {
    const result = await createOrder(db, staff, orderPayload({ customer: { mode: "new", name: "عميل جديد", phone: "01011112222" } }));
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId }, include: { customer: true } });
    expect(order.customer).toMatchObject({ name: "عميل جديد", phone: "01011112222" });
  });

  it("uses the order quantity and material for a single group, and stores 'plain' as no operations", async () => {
    const result = await createOrder(
      db,
      staff,
      orderPayload({ quantity: "75", groups: [{ operations: [], plain: true, quantity: "999" }] }),
    );
    const groups = await db.orderGroup.findMany({ where: { orderId: result.orderId }, include: { operations: true } });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ quantity: 75, material: "قطن" });
    expect(groups[0]!.operations).toHaveLength(0);
  });

  it("rejects groups whose quantities do not add up to the order quantity", async () => {
    await expect(
      createOrder(
        db,
        staff,
        orderPayload({
          groups: [
            { quantity: "100", operations: ["DTF"], plain: false },
            { quantity: "50", operations: ["EMBROIDERY"], plain: false },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { groups: ["مجموع كميات المجموعات (150) لازم يساوي الكمية المطلوبة (200)"] },
    });
    expect(await db.order.count()).toBe(0);
  });

  it("requires choosing the work type for every group", async () => {
    await expect(
      createOrder(db, staff, orderPayload({ groups: [{ operations: [], plain: false }] })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fieldErrors: { "groups.0.operations": expect.any(Array) } });
  });

  it("rejects an advance larger than the price, and a delivery date before receipt", async () => {
    await expect(createOrder(db, staff, orderPayload({ advance: "40000.01" }))).rejects.toMatchObject({
      fieldErrors: { advance: ["المقدم أكبر من إجمالي سعر الأوردر"] },
    });
    await expect(
      createOrder(db, staff, orderPayload({ receivedDate: "2026-05-10", deliveryDate: "2026-05-09" })),
    ).rejects.toMatchObject({ fieldErrors: { deliveryDate: expect.any(Array) } });
  });

  it("numbers orders sequentially", async () => {
    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await createOrder(db, staff, orderPayload())).number);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("gives concurrent orders unique, gapless numbers", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => createOrder(db, staff, orderPayload())));
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("protects against double submit: the same request creates ONE order", async () => {
    const payload = orderPayload({ advance: "1000" });
    const [a, b, c] = await Promise.all([
      createOrder(db, staff, payload),
      createOrder(db, staff, payload),
      createOrder(db, staff, payload),
    ]);
    expect(new Set([a.orderId, b.orderId, c.orderId]).size).toBe(1);
    expect([a, b, c].filter((r) => r.created)).toHaveLength(1);
    // A later retry also returns the same order.
    expect((await createOrder(db, staff, payload)).orderId).toBe(a.orderId);
    expect(await db.order.count()).toBe(1);
    expect(await db.customer.count()).toBe(1);
    expect(await db.orderPayment.count()).toBe(1);
  });

  it("rolls back everything (customer, order, groups, counter) when a later step fails", async () => {
    // Make the advance-payment insert fail inside the transaction.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_payment() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END; $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_payment BEFORE INSERT ON order_payments FOR EACH ROW EXECUTE FUNCTION test_fail_payment()`,
    );
    try {
      await expect(
        createOrder(db, staff, orderPayload({ customer: { mode: "new", name: "مؤقت" }, advance: "500" })),
      ).rejects.toThrow();
      expect(await db.customer.count()).toBe(0);
      expect(await db.order.count()).toBe(0);
      expect(await db.orderGroup.count()).toBe(0);
      expect((await db.counter.findUniqueOrThrow({ where: { key: "order_number" } })).value).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_payment ON order_payments`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_payment()`);
    }
    // The next order still gets #1: no gap.
    expect((await createOrder(db, staff, orderPayload())).number).toBe(1);
  });

  // ─── Payments ───

  it("accepts multiple partial payments and keeps money exact (no floating point)", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload({ totalPrice: "100.30" }));
    for (let i = 0; i < 3; i++) await recordPayment(db, staff, payment(orderId, "33.43"));
    const details = (await getOrderDetails(db, staff, orderId))!;
    expect(details.paid).toBe("100.29");
    expect(details.outstanding).toBe("0.01");
  });

  it("rejects overpayment, zero and negative amounts", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload({ totalPrice: "1000", advance: "600" }));
    await expect(recordPayment(db, staff, payment(orderId, "400.01"))).rejects.toMatchObject({
      fieldErrors: { amount: ["المبلغ أكبر من المتبقي على الأوردر (400 ج.م)"] },
    });
    await expect(recordPayment(db, staff, payment(orderId, "0"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recordPayment(db, staff, payment(orderId, "-5"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await recordPayment(db, staff, payment(orderId, "400"));
    await expect(recordPayment(db, staff, payment(orderId, "1"))).rejects.toMatchObject({
      fieldErrors: { amount: ["الأوردر ده متدفع بالكامل"] },
    });
  });

  it("does not let two simultaneous payments overpay together", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload({ totalPrice: "1000" }));
    const results = await Promise.allSettled([
      recordPayment(db, staff, payment(orderId, "700")),
      recordPayment(db, staff, payment(orderId, "700")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getOrderDetails(db, staff, orderId))!.paid).toBe("700.00");
  });

  it("protects payments against double submit", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload());
    const same = payment(orderId, "5000");
    const results = await Promise.all([recordPayment(db, staff, same), recordPayment(db, staff, same)]);
    expect(results[0]!.paymentId).toBe(results[1]!.paymentId);
    expect(await db.orderPayment.count()).toBe(1);
  });

  it("rejects payments dated in the future", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload());
    await expect(recordPayment(db, staff, payment(orderId, "10", { paidAt: "2099-01-01" }))).rejects.toMatchObject({
      fieldErrors: { paidAt: expect.any(Array) },
    });
  });

  // ─── Authorization & corrections ───

  it("lets only the owner void a payment; the voided payment stays visible and stops counting", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload({ advance: "20000" }));
    const paymentId = (await db.orderPayment.findFirstOrThrow({ where: { orderId } })).id;

    await expect(voidPayment(db, staff, { paymentId, reason: "غلط في المبلغ" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidPayment(db, owner, { paymentId, reason: "غلط في المبلغ" });

    const details = (await getOrderDetails(db, owner, orderId))!;
    expect(details.paid).toBe("0.00");
    expect(details.outstanding).toBe("40000.00");
    expect(details.payments).toHaveLength(1);
    expect(details.payments[0]!.voided).toMatchObject({ reason: "غلط في المبلغ" });
    expect(await db.auditLog.count({ where: { action: "PAYMENT_VOIDED" } })).toBe(1);
    await expect(voidPayment(db, owner, { paymentId, reason: "تاني" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("only the owner can change the agreed price, never below what was paid, and it is audited", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload({ advance: "20000" }));
    const details = (await getOrderDetails(db, staff, orderId))!;
    const edit = (overrides: Record<string, unknown>) => ({
      orderId,
      customer: { mode: "existing" as const, id: details.customerId },
      title: details.title,
      productType: details.productType,
      material: details.material,
      quantity: String(details.quantity),
      unit: details.unit,
      groups: [{ operations: ["DTF"], plain: false }],
      totalPrice: "40000",
      receivedDate: details.receivedDate,
      deliveryDate: details.deliveryDate,
      status: "NEW" as const,
      ...overrides,
    });

    await expect(updateOrder(db, staff, edit({ totalPrice: "35000" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrder(db, owner, edit({ totalPrice: "19999" }))).rejects.toMatchObject({
      fieldErrors: { totalPrice: expect.any(Array) },
    });
    await updateOrder(db, owner, edit({ totalPrice: "35000" }));
    expect((await getOrderDetails(db, owner, orderId))!.outstanding).toBe("15000.00");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_PRICE_CHANGED" } });
    expect(log.metadata).toMatchObject({ from: "40000.00", to: "35000.00" });

    // Staff can still edit non-financial details; the change is audited.
    await updateOrder(db, staff, edit({ totalPrice: "35000", title: "اسم جديد", status: "IN_PROGRESS" }));
    expect((await getOrderDetails(db, staff, orderId))!).toMatchObject({ title: "اسم جديد", status: "IN_PROGRESS" });
    expect(await db.auditLog.count({ where: { action: "ORDER_STATUS_CHANGED" } })).toBe(1);

    // Cancelling: owner only, and not while payments exist.
    await expect(updateOrder(db, staff, edit({ totalPrice: "35000", status: "CANCELLED" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrder(db, owner, edit({ totalPrice: "35000", status: "CANCELLED" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("replaces groups on edit and rejects a mismatched split", async () => {
    const { orderId } = await createOrder(db, staff, orderPayload());
    const d = (await getOrderDetails(db, staff, orderId))!;
    const base = {
      orderId,
      customer: { mode: "existing" as const, id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      quantity: "200",
      unit: d.unit,
      totalPrice: "40000",
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: "NEW" as const,
    };
    await updateOrder(db, staff, {
      ...base,
      groups: [
        { quantity: "120", operations: ["SCREEN_PRINT"], plain: false },
        { quantity: "80", operations: [], plain: true, material: "بوليستر" },
      ],
    });
    const after = (await getOrderDetails(db, staff, orderId))!;
    expect(after.groups.map((g) => [g.quantity, g.material, g.description])).toEqual([
      [120, "قطن", "سلك سكرين"],
      [80, "بوليستر", "بدون طباعة أو تطريز"],
    ]);
    await expect(
      updateOrder(db, staff, { ...base, groups: [{ quantity: "1", operations: ["DTF"], plain: false }, { quantity: "1", operations: ["DTF"], plain: false }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("checks permissions in every service", async () => {
    const noRights = { id: staff.id, role: "UNKNOWN_ROLE" } as unknown as Actor;
    await expect(createCustomer(db, noRights, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createOrder(db, noRights, orderPayload())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listOrders(db, noRights, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(searchCustomers(db, noRights, "")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ─── Lists & dashboard ───

  it("filters, searches and flags overdue orders; dashboard counts are real", async () => {
    const late = await createOrder(db, staff, orderPayload({ title: "أوردر متأخر", receivedDate: "2026-01-01", deliveryDate: "2026-01-02", advance: "100" }));
    await createOrder(db, staff, orderPayload({ title: "أوردر عادي", customer: { mode: "new", name: "سارة", phone: "01099998888" } }));

    const overdue = await listOrders(db, staff, { status: "overdue" });
    expect(overdue.items.map((o) => o.id)).toEqual([late.orderId]);
    expect(overdue.items[0]!.overdue).toBe(true);

    expect((await listOrders(db, staff, { query: "سارة" })).total).toBe(1);
    expect((await listOrders(db, staff, { query: "9998888" })).total).toBe(1);
    expect((await listOrders(db, staff, { query: "#0001" })).items[0]!.id).toBe(late.orderId);
    expect((await listOrders(db, staff, { query: "١" })).items[0]!.id).toBe(late.orderId);
    expect((await listOrders(db, staff, { sort: "delivery" })).items[0]!.id).toBe(late.orderId);

    const stats = await getDashboardStats(db, staff);
    expect(stats.activeOrders).toBe(2);
    expect(stats.overdueOrders).toBe(1);
    // The 100 EGP advance was dated 2026-01-01; only payments dated this month count.
    expect(stats.paymentsThisMonth).toBe(TODAY.startsWith("2026-01") ? "100.00" : "0.00");
  });
});
