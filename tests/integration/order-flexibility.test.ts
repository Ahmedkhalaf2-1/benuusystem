import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import { createOrder, getOrderDetails, listOrders, recentMaterials, updateOrder } from "@/server/services/order-service";
import { recordPayment } from "@/server/services/payment-service";
import { recordDelivery, recordReady } from "@/server/services/production-service";
import { createAccount, getTreasuryOverview } from "@/server/services/treasury-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase, shareWithAllStaff } from "../support/test-db";

/**
 * Phase 1 — order flexibility and backdating: historical receipt dates, the
 * advance's own payment date (and its treasury rule), optional material and
 * manufacturing details, and ready-made product items.
 */
const TODAY = todayDateString();
const daysAgo = (n: number) => dateToString(new Date(dateFromString(TODAY).getTime() - n * 86_400_000));
const TOMORROW = dateToString(new Date(dateFromString(TODAY).getTime() + 86_400_000));

function payload(overrides: Partial<CreateOrderPayload> = {}): CreateOrderPayload {
  return {
    idempotencyKey: randomUUID(),
    customer: { mode: "new", name: "إيما" },
    title: "Emma Tourism",
    productType: "تيشيرت",
    pricing: "items",
    unit: "PIECE",
    groups: [{ name: "تيشيرت لوجو", quantity: "50", unitPrice: "120", designs: [{ operation: "DTF" }] }],
    advance: "0",
    advanceMethod: "CASH",
    receivedDate: TODAY,
    deliveryDate: "2099-12-31",
    ...overrides,
  };
}

describe.skipIf(!hasTestDatabase)("order flexibility & backdating (PostgreSQL)", () => {
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

  const create = async (actor: Actor, overrides: Partial<CreateOrderPayload> = {}) => {
    const result = await createOrder(db, actor, payload(overrides));
    await shareWithAllStaff(db, result.orderId);
    return result;
  };

  // 1. Normal order, with the order name.
  it("creates a normal order named «Emma Tourism» with item pricing", async () => {
    const { orderId, number } = await create(owner);
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(number).toBe(1);
    expect(d.title).toBe("Emma Tourism");
    expect(d.money).toMatchObject({ totalPrice: "6000.00", paid: "0.00", outstanding: "6000.00" });
    expect(d.receivedDate).toBe(TODAY);
  });

  // 2. Historical receipt date — no lookback limit, system timestamps untouched.
  it("accepts any past receipt date, keeps createdAt real, and audits the receipt date", async () => {
    const before = Date.now();
    const old = "2019-03-07";
    const { orderId } = await create(owner, { receivedDate: old, deliveryDate: "2019-03-20" });
    const row = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { receivedDate: true, createdAt: true, updatedAt: true } });
    expect(dateToString(row.receivedDate)).toBe(old);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_CREATED", entityId: orderId } });
    expect(log.metadata).toMatchObject({ receivedDate: old, deliveryDate: "2019-03-20" });
    expect((log.metadata as { entryLagDays: number }).entryLagDays).toBeGreaterThan(2000);
    expect(log.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refuses a future receipt date on create, and on edit only when the date changes", async () => {
    await expect(create(owner, { receivedDate: TOMORROW })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { receivedDate: ["تاريخ الاستلام مينفعش يكون في المستقبل"] },
    });

    const { orderId } = await create(owner, { receivedDate: daysAgo(3) });
    const d = (await getOrderDetails(db, owner, orderId))!;
    const base = {
      orderId,
      customer: { mode: "existing" as const, id: d.customerId },
      title: d.title,
      productType: d.productType,
      pricing: "items" as const,
      unit: d.unit,
      groups: d.groups.map((g) => ({ id: g.id, name: g.name ?? "", quantity: String(g.quantity), unitPrice: "120", designs: g.designs.map((x) => ({ id: x.id, operation: x.operation })) })),
      deliveryDate: d.deliveryDate,
      status: "NEW" as const,
    };
    await expect(updateOrder(db, owner, { ...base, receivedDate: TOMORROW })).rejects.toMatchObject({
      fieldErrors: { receivedDate: ["تاريخ الاستلام مينفعش يكون في المستقبل"] },
    });
    // Moving it further back is fine, and the edit is audited with the receipt date.
    await updateOrder(db, owner, { ...base, receivedDate: daysAgo(40), title: "Emma Tourism — Hurghada" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_UPDATED", entityId: orderId } });
    expect(log.metadata).toMatchObject({
      receivedDate: daysAgo(40),
      changes: { receivedDate: { from: daysAgo(3), to: daysAgo(40) }, title: { from: "Emma Tourism", to: "Emma Tourism — Hurghada" } },
    });
  });

  // 3. Advance with its own payment date.
  it("dates the advance on its real payment day, not the receipt date", async () => {
    const received = daysAgo(20);
    const { orderId } = await create(owner, { receivedDate: received, advance: "1000", advancePaidAt: daysAgo(2) });
    const pay = await db.orderPayment.findFirstOrThrow({ where: { orderId } });
    expect(dateToString(pay.paidAt)).toBe(daysAgo(2));
    expect(pay.isAdvance).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "PAYMENT_RECORDED", entityId: pay.id } });
    expect(log.metadata).toMatchObject({ paidAt: daysAgo(2), advance: true });
    const created = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_CREATED", entityId: orderId } });
    expect(created.metadata).toMatchObject({ receivedDate: received, advancePaidAt: daysAgo(2) });

    // No date sent (older callers): today — never silently the historical receipt date.
    const other = await create(owner, { receivedDate: received, advance: "500" });
    const p2 = await db.orderPayment.findFirstOrThrow({ where: { orderId: other.orderId } });
    expect(dateToString(p2.paidAt)).toBe(TODAY);

    // The advance may be paid on the receipt day itself when that is the truth.
    const same = await create(owner, { receivedDate: received, advance: "500", advancePaidAt: received });
    expect(dateToString((await db.orderPayment.findFirstOrThrow({ where: { orderId: same.orderId } })).paidAt)).toBe(received);
  });

  it("refuses an advance dated in the future or an invalid date", async () => {
    await expect(create(owner, { advance: "100", advancePaidAt: TOMORROW })).rejects.toMatchObject({
      fieldErrors: { advancePaidAt: ["تاريخ دفع المقدم مينفعش يكون في المستقبل"] },
    });
    await expect(create(owner, { advance: "100", advancePaidAt: "2026-02-30" })).rejects.toMatchObject({
      fieldErrors: { advancePaidAt: ["اختار تاريخ دفع المقدم"] },
    });
    expect(await db.order.count()).toBe(0);
  });

  // 10. Treasury rule follows the advance's payment date.
  it("applies the treasury cutover to the advance's payment date, not the receipt date", async () => {
    const cutover = daysAgo(10);
    const cash = (await createAccount(db, owner, { name: "الخزنة", type: "CASH", openingBalance: "1000", countDate: cutover, basis: "START_OF_DAY", confirmed: true })).id;

    // Received before the cutover, paid after it: the advance needs an account and counts in the treasury.
    await expect(create(owner, { receivedDate: daysAgo(30), advance: "800", advancePaidAt: daysAgo(1) })).rejects.toMatchObject({
      fieldErrors: { advanceAccountId: ["اختار الحساب اللي الفلوس دخلت فيه / خرجت منه"] },
    });
    const late = await create(owner, { receivedDate: daysAgo(30), advance: "800", advancePaidAt: daysAgo(1), advanceAccountId: cash });
    expect((await db.orderPayment.findFirstOrThrow({ where: { orderId: late.orderId } })).accountId).toBe(cash);

    // Paid before the cutover: already inside the opening balance — no account, not counted twice.
    await expect(create(owner, { receivedDate: daysAgo(30), advance: "300", advancePaidAt: daysAgo(25), advanceAccountId: cash })).rejects.toMatchObject({
      fieldErrors: { advanceAccountId: [expect.stringContaining("قبل بداية حساب الخزنة")] },
    });
    const early = await create(owner, { receivedDate: daysAgo(30), advance: "300", advancePaidAt: daysAgo(25) });
    expect((await db.orderPayment.findFirstOrThrow({ where: { orderId: early.orderId } })).accountId).toBeNull();

    const overview = await getTreasuryOverview(db, owner, { from: daysAgo(30), to: TODAY });
    expect(overview.accounts.find((a) => a.id === cash)!.balance).toBe("1800.00");
  });

  // 4. Order without optional manufacturing details or material.
  it("saves a simple order with no material and no design details", async () => {
    const { orderId } = await create(staff, {
      groups: [{ name: "تيشيرت", quantity: "30", unitPrice: "100", designs: [{ operation: "EMBROIDERY" }] }],
    });
    const d = (await getOrderDetails(db, staff, orderId))!;
    expect(d.material).toBe("");
    expect(d.groups[0]).toMatchObject({ material: "", quantity: 30, operations: ["EMBROIDERY"] });
    expect(d.groups[0]!.designs[0]).toMatchObject({ name: null, placements: [], customPlacements: [], quantity: 30, pressesPerUnit: null, notes: null });
    // An empty material is never offered as a suggestion.
    await create(owner, { material: "قطن" });
    expect(await recentMaterials(db, owner)).toEqual(["قطن"]);
  });

  it("still requires the essentials: customer, name, product, quantity, work type, prices, dates", async () => {
    await expect(create(owner, { title: " " })).rejects.toMatchObject({ fieldErrors: { title: ["اكتب اسم الأوردر"] } });
    await expect(create(owner, { groups: [{ name: "تيشيرت", quantity: "10", unitPrice: "", designs: [{ operation: "DTF" }] }] })).rejects.toMatchObject({
      fieldErrors: { "groups.0.unitPrice": ["اكتب سعر القطعة"] },
    });
    await expect(create(owner, { groups: [{ name: "تيشيرت", quantity: "10", unitPrice: "10", plain: false }] })).rejects.toMatchObject({
      fieldErrors: { "groups.0.operations": [expect.any(String)] },
    });
    await expect(create(owner, { deliveryDate: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // 5 & 6. Ready-made T-shirt and Hoodie orders.
  it("creates ready-made T-shirt and Hoodie orders with no work type, and delivers them at once", async () => {
    const tshirts = await create(staff, {
      title: "تيشيرتات جاهزة",
      groups: [{ name: "تيشيرت", quantity: "12", unitPrice: "150", plain: true, designs: [] }],
    });
    const hoodies = await create(staff, {
      title: "هوديز جاهزة",
      productType: "هودي",
      sizesEnabled: true,
      groups: [{ name: "هودي", quantity: "5", unitPrice: "450", plain: true, designs: [], sizes: [{ label: "L", quantity: "3" }, { label: "XL", quantity: "2" }] }],
    });

    const t = (await getOrderDetails(db, owner, tshirts.orderId))!;
    expect(t.money?.totalPrice).toBe("1800.00");
    expect(t.groups[0]).toMatchObject({ name: "تيشيرت", operations: [], designs: [], description: "بدون طباعة أو تطريز" });
    const h = (await getOrderDetails(db, owner, hoodies.orderId))!;
    expect(h.money?.totalPrice).toBe("2250.00");
    expect(h.groups[0]!.sizes.map((s) => [s.label, s.quantity])).toEqual([["L", 3], ["XL", 2]]);

    // No production stages needed: ready, then delivered, then completed.
    const g = t.groups[0]!.id;
    await recordReady(db, owner, { orderId: t.id, orderGroupId: g, quantity: "12", readyDate: TODAY, idempotencyKey: randomUUID() });
    await recordDelivery(db, owner, { orderId: t.id, orderGroupId: g, quantity: "12", deliveredAt: TODAY, idempotencyKey: randomUUID() });
    expect((await getOrderDetails(db, owner, t.id))!.status).toBe("COMPLETED");
  });

  it("mixes a ready-made item and a printed item in one order", async () => {
    const { orderId } = await create(owner, {
      groups: [
        { name: "تيشيرت مطبوع", quantity: "20", unitPrice: "200", designs: [{ operation: "SCREEN_PRINT", placements: ["CHEST"] }] },
        { name: "كاب", quantity: "20", unitPrice: "80", plain: true, designs: [] },
      ],
    });
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.quantity).toBe(40);
    expect(d.money?.totalPrice).toBe("5600.00");
    expect(d.groups.map((g) => g.operations)).toEqual([["SCREEN_PRINT"], []]);
  });

  // 7 & 8. Editing, searching and sorting by receipt date.
  it("sorts «newest» by receipt date with deterministic ties, and «recorded» by entry time", async () => {
    const a = await create(owner, { title: "أ", receivedDate: daysAgo(1) });
    const b = await create(owner, { title: "ب", receivedDate: daysAgo(30) }); // backdated, entered later
    const c = await create(owner, { title: "ج", receivedDate: daysAgo(1) }); // same day as «أ», entered after it
    const ids = async (sort: "newest" | "oldest" | "recorded") => (await listOrders(db, owner, { sort })).items.map((o) => o.id);

    expect(await ids("newest")).toEqual([c.orderId, a.orderId, b.orderId]);
    expect(await ids("oldest")).toEqual([b.orderId, a.orderId, c.orderId]);
    expect(await ids("recorded")).toEqual([c.orderId, b.orderId, a.orderId]);
    expect((await listOrders(db, owner, {})).items.map((o) => o.receivedDate)).toEqual([daysAgo(1), daysAgo(1), daysAgo(30)]);
  });

  it("finds orders by their name and keeps numbering after edits", async () => {
    const { orderId } = await create(owner);
    await create(owner, { title: "Nile Cruise", customer: { mode: "new", name: "سارة" } });
    expect((await listOrders(db, owner, { query: "emma" })).items.map((o) => o.id)).toEqual([orderId]);
    expect((await listOrders(db, staff, { query: "Tourism" })).total).toBe(1);
    expect((await listOrders(db, owner, { query: "#0002" })).items[0]!.title).toBe("Nile Cruise");
  });

  // 9. Totals stay consistent with payments.
  it("keeps totals and outstanding consistent across advance and later payments", async () => {
    const { orderId } = await create(owner, { receivedDate: daysAgo(5), advance: "2000", advancePaidAt: daysAgo(5) });
    await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "1500", paidAt: TODAY, method: "CASH" });
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.money).toEqual({ totalPrice: "6000.00", paid: "3500.00", outstanding: "2500.00" });
    expect(d.payments!.map((p) => [p.paidAt, p.amount, p.isAdvance])).toEqual([
      [daysAgo(5), "2000.00", true],
      [TODAY, "1500.00", false],
    ]);
    await expect(create(owner, { advance: "6000.01" })).rejects.toMatchObject({ fieldErrors: { advance: ["المقدم أكبر من إجمالي سعر الأوردر"] } });
  });
});
