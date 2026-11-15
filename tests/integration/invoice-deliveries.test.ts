import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import { renderOrderInvoice } from "@/server/documents/customer-documents";
import type { Actor } from "@/server/services/actor";
import { getOrderInvoiceData } from "@/server/services/customer-documents-service";
import { createOrder, getOrderDetails } from "@/server/services/order-service";
import { getOrderProduction, recordDelivery, recordReady, recordStageProgress, voidDelivery } from "@/server/services/production-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasTestDatabase)("invoice delivery history (PostgreSQL)", () => {
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

  const newOrder = async (o: Partial<CreateOrderPayload>) => {
    const r = await createOrder(db, staff, {
      idempotencyKey: randomUUID(),
      customer: { mode: "new", name: "عميل التسليمات" },
      title: "تيشيرتات DTF + تطريز",
      productType: "تيشيرت",
      material: "قطن",
      quantity: "70",
      unit: "PIECE",
      groups: [{ operations: ["DTF", "EMBROIDERY"], plain: false }],
      totalPrice: "7000",
      advance: "0",
      advanceMethod: "CASH",
      receivedDate: daysAgo(30),
      deliveryDate: "2099-12-31",
      ...o,
    } as CreateOrderPayload);
    return (await getOrderDetails(db, owner, r.orderId))!;
  };
  const deliver = (orderId: string, orderGroupId: string, extra: Record<string, unknown>, date: string) =>
    recordDelivery(db, staff, { orderId, orderGroupId, deliveredAt: date, idempotencyKey: randomUUID(), ...extra });

  it("the 70-piece order with DTF + embroidery: three deliveries, counted once each, never from production stages", async () => {
    const d = await newOrder({});
    const g = d.groups[0]!.id;
    // Both operations recorded for all 70 pieces, then 70 ready: still 70 garments.
    for (const operation of ["DTF", "EMBROIDERY"] as const)
      await recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g, operation, quantity: "70", workDate: daysAgo(20), idempotencyKey: randomUUID() });
    await recordReady(db, staff, { orderId: d.id, orderGroupId: g, quantity: "70", readyDate: daysAgo(19), confirmAllOperations: true, idempotencyKey: randomUUID() });

    let inv = (await getOrderInvoiceData(db, owner, d.id))!;
    expect(inv.deliveries).toMatchObject({ total: 70, delivered: 0, remaining: 70, status: "none", entries: [] });

    await deliver(d.id, g, { quantity: "20" }, daysAgo(10));
    await deliver(d.id, g, { quantity: "30" }, daysAgo(8));
    await deliver(d.id, g, { quantity: "20" }, daysAgo(5));
    inv = (await getOrderInvoiceData(db, owner, d.id))!;
    expect(inv.deliveries.entries.map((e) => [e.quantity, e.cumulative, e.remaining])).toEqual([
      [20, 20, 50],
      [30, 50, 20],
      [20, 70, 0],
    ]);
    expect(inv.deliveries).toMatchObject({ total: 70, delivered: 70, remaining: 0, status: "complete", lastDate: daysAgo(5) });
    // Same figure as the production screen; the order completed itself.
    expect((await getOrderProduction(db, owner, d.id))!.totals.delivered).toBe(70);
    expect(inv.order.status).toBe("COMPLETED");
    // Money is untouched by deliveries.
    expect(inv.balance).toMatchObject({ paid: 0n, outstanding: 700_000n });
  });

  it("sized groups: one form = one handover with its sizes; same-day forms stay separate; voided deliveries excluded", async () => {
    const d = await newOrder({
      quantity: "60",
      sizesEnabled: true,
      groups: [
        { operations: ["DTF"], plain: false, quantity: "40", material: "قطن أبيض", sizes: [{ label: "S", quantity: "10" }, { label: "M", quantity: "20" }, { label: "XL", quantity: "10" }] },
        { operations: ["SCREEN_PRINT"], plain: false, quantity: "20", material: "قطن أسود", sizes: [{ label: "L", quantity: "20" }] },
      ],
    } as Partial<CreateOrderPayload>);
    const [g1, g2] = d.groups;
    const sizesOf = (g: typeof g1, m: Record<string, number>) =>
      Object.entries(m).map(([label, quantity]) => ({ sizeId: g!.sizes.find((s) => s.label === label)!.id, quantity: String(quantity) }));
    const sizes = (m: Record<string, number>) => sizesOf(g1, m);
    await recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g1!.id, operation: "DTF", sizes: sizes({ S: 10, M: 20, XL: 10 }), workDate: daysAgo(9), alsoReady: true, idempotencyKey: randomUUID() });

    await deliver(d.id, g1!.id, { sizes: sizes({ S: 5, M: 10, XL: 5 }) }, daysAgo(3));
    await deliver(d.id, g1!.id, { sizes: sizes({ M: 4 }) }, daysAgo(3));
    const wrong = await deliver(d.id, g1!.id, { sizes: sizes({ S: 2 }) }, daysAgo(2));
    await voidDelivery(db, owner, { id: wrong.id, reason: "اتسجل غلط" });

    // Second group (one step): made and ready in one save, then a delivery with a note.
    await recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g2!.id, operation: "SCREEN_PRINT", sizes: sizesOf(g2, { L: 20 }), workDate: daysAgo(4), alsoReady: true, idempotencyKey: randomUUID() });
    await deliver(d.id, g2!.id, { sizes: sizesOf(g2, { L: 15 }), notes: "استلمها المندوب" }, daysAgo(1));

    const inv = (await getOrderInvoiceData(db, owner, d.id))!;
    const h = inv.deliveries;
    expect(h.entries.map((e) => ({ g: e.groupPosition, q: e.quantity, sizes: e.sizes.map((s) => `${s.label}:${s.quantity}`).join(" "), notes: e.notes }))).toEqual([
      { g: g1!.position, q: 20, sizes: "S:5 M:10 XL:5", notes: null },
      { g: g1!.position, q: 4, sizes: "M:4", notes: null },
      { g: g2!.position, q: 15, sizes: "L:15", notes: "استلمها المندوب" },
    ]);
    expect(h).toMatchObject({ total: 60, delivered: 39, remaining: 21, status: "partial" });
    expect(inv.voidedDeliveries).toBe(1);
    expect((await getOrderProduction(db, owner, d.id))!.totals.delivered).toBe(39);
  });

  it("renders the delivery section (also across pages) and stays owner-only", async () => {
    const d = await newOrder({ quantity: "60", groups: [{ operations: ["DTF"], plain: false }] });
    const g = d.groups[0]!.id;
    await recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g, operation: "DTF", quantity: "60", workDate: daysAgo(29), alsoReady: true, idempotencyKey: randomUUID() });
    for (let i = 0; i < 45; i++) await deliver(d.id, g, { quantity: "1" }, daysAgo(28 - Math.floor(i / 2)));

    const inv = (await getOrderInvoiceData(db, owner, d.id))!;
    expect(inv.deliveries.entries).toHaveLength(45);
    expect(inv.deliveries.entries.at(-1)).toMatchObject({ cumulative: 45, remaining: 15 });
    const pdf = await renderOrderInvoice(inv);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1);

    const empty = await newOrder({ quantity: "10" });
    const pdfEmpty = await renderOrderInvoice((await getOrderInvoiceData(db, owner, empty.id))!);
    expect(pdfEmpty.subarray(0, 5).toString()).toBe("%PDF-");

    await expect(getOrderInvoiceData(db, staff, d.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
