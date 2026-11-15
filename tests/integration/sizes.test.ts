import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload, UpdateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import { createCustomer } from "@/server/services/customer-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { recordPayment } from "@/server/services/payment-service";
import {
  getOrderProduction,
  recordDelivery,
  recordReady,
  recordStageProgress,
  voidDelivery,
  voidReady,
  voidStageProgress,
} from "@/server/services/production-service";
import { recordWorkLog } from "@/server/services/work-service";
import { createWorker } from "@/server/services/worker-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
type G = { quantity?: string; operations: string[]; plain?: boolean; sizes?: { label: string; quantity: string }[] };

describe.skipIf(!hasTestDatabase)("garment sizes (PostgreSQL)", () => {
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

  async function order(groups: G[], quantity: string, opts: Partial<CreateOrderPayload> = {}) {
    const c = await createCustomer(db, owner, { name: "محمود" });
    const { orderId } = await createOrder(db, owner, {
      idempotencyKey: randomUUID(),
      customer: { mode: "existing", id: c.id },
      title: "200 تيشيرت",
      productType: "تيشيرت",
      material: "قطن",
      quantity,
      unit: "PIECE",
      sizesEnabled: true,
      groups: groups.map((g) => ({ plain: false, sizes: [], ...g })),
      totalPrice: "40000",
      advance: "20000",
      receivedDate: TODAY,
      deliveryDate: "2099-01-15",
      ...opts,
    });
    return { orderId, details: (await getOrderDetails(db, owner, orderId))! };
  }
  const sizeId = (d: Awaited<ReturnType<typeof order>>["details"], groupIndex: number, label: string) =>
    d.groups[groupIndex]!.sizes.find((s) => s.label === label)!.id;
  const lines = (d: Awaited<ReturnType<typeof order>>["details"], groupIndex: number, entries: Record<string, number>) =>
    Object.entries(entries).map(([label, quantity]) => ({ sizeId: sizeId(d, groupIndex, label), quantity: String(quantity) }));

  const acceptanceGroups: G[] = [
    { quantity: "100", operations: ["DTF"], sizes: [{ label: "S", quantity: "25" }, { label: "M", quantity: "25" }, { label: "L", quantity: "25" }, { label: "XL", quantity: "25" }] },
    { quantity: "50", operations: ["EMBROIDERY"], sizes: [{ label: "S", quantity: "10" }, { label: "M", quantity: "10" }, { label: "L", quantity: "15" }, { label: "XL", quantity: "15" }] },
    { quantity: "50", operations: ["DTF", "EMBROIDERY"], sizes: [{ label: "S", quantity: "15" }, { label: "M", quantity: "15" }, { label: "L", quantity: "10" }, { label: "XL", quantity: "10" }] },
  ];

  it("acceptance: one order, three groups, sizes per group; per-size production and partial delivery", async () => {
    const { orderId, details: d } = await order(acceptanceGroups, "200");
    expect(d.sizesEnabled).toBe(true);
    expect(d.groups.map((g) => [g.quantity, g.description, g.sizes.map((s) => `${s.label}:${s.quantity}`).join(" ")])).toEqual([
      [100, "DTF", "S:25 M:25 L:25 XL:25"],
      [50, "تطريز", "S:10 M:10 L:15 XL:15"],
      [50, "DTF + تطريز", "S:15 M:15 L:10 XL:10"],
    ]);
    // Size totals per label across groups: S 50 · M 50 · L 50 · XL 50 = 200 physical shirts.
    const byLabel: Record<string, number> = {};
    for (const g of d.groups) for (const s of g.sizes) byLabel[s.label] = (byLabel[s.label] ?? 0) + s.quantity;
    expect(byLabel).toEqual({ S: 50, M: 50, L: 50, XL: 50 });

    // Group 3 (DTF + embroidery): S gets DTF 15 and embroidery 12 → at most 12 S ready.
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[2]!.id, operation: "DTF", sizes: lines(d, 2, { S: 15, M: 10 }), workDate: TODAY, idempotencyKey: randomUUID() });
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[2]!.id, operation: "EMBROIDERY", sizes: lines(d, 2, { S: 12 }), workDate: TODAY, idempotencyKey: randomUUID() });
    let p = (await getOrderProduction(db, staff, orderId))!;
    const s3 = p.groups[2]!.sizes.find((s) => s.label === "S")!;
    expect(s3).toMatchObject({ quantity: 15, stage: { DTF: 15, EMBROIDERY: 12 }, maxReady: 12, ready: 0 });
    expect(p.groups[2]!.stage).toEqual({ DTF: 25, EMBROIDERY: 12 }); // group = sum of its sizes
    expect(p.totals.ready).toBe(0); // step completions are not shirts

    await expect(
      recordReady(db, staff, { orderId, orderGroupId: d.groups[2]!.id, sizes: lines(d, 2, { S: 13 }), readyDate: TODAY, confirmAllOperations: true, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ fieldErrors: { [`size:${sizeId(d, 2, "S")}`]: expect.any(Array) } });
    await recordReady(db, staff, { orderId, orderGroupId: d.groups[2]!.id, sizes: lines(d, 2, { S: 12 }), readyDate: TODAY, confirmAllOperations: true, idempotencyKey: randomUUID() });

    // Group 1 (DTF only): finish S 30? no — S is 25: 20 S + 25 M + 10 L made and ready in one save.
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[0]!.id, operation: "DTF", sizes: lines(d, 0, { S: 20, M: 25, L: 10 }), workDate: TODAY, alsoReady: true, idempotencyKey: randomUUID() });
    // Deliver several sizes in one submission.
    await recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 15, M: 20, L: 10 }), deliveredAt: TODAY, idempotencyKey: randomUUID() });

    p = (await getOrderProduction(db, staff, orderId))!;
    const g1 = Object.fromEntries(p.groups[0]!.sizes.map((s) => [s.label, [s.quantity, s.ready, s.delivered, s.ready - s.delivered, s.quantity - s.ready]]));
    expect(g1).toEqual({ S: [25, 20, 15, 5, 5], M: [25, 25, 20, 5, 0], L: [25, 10, 10, 0, 15], XL: [25, 0, 0, 0, 25] });
    expect(p.totals).toEqual({ required: 200, ready: 67, delivered: 45, readyNotDelivered: 22, remaining: 133 });
    expect(p.deliveryHistory.map((h) => `${h.sizeLabel}:${h.quantity}`).sort()).toEqual(["L:10", "M:20", "S:15"]);

    // Money untouched by sizes.
    expect((await getOrderDetails(db, owner, orderId))!).toMatchObject({ totalPrice: "40000.00", paid: "20000.00", outstanding: "20000.00" });
    await recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount: "5000", paidAt: TODAY, method: "CASH" });
    expect((await getOrderDetails(db, owner, orderId))!.outstanding).toBe("15000.00");
  });

  it("S ordered 50 → finished 30 → delivered 20: ready 10, remaining 20", async () => {
    const { orderId, details: d } = await order([{ operations: [], plain: true, sizes: [{ label: "S", quantity: "50" }] }], "50");
    await recordReady(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 30 }), readyDate: TODAY, idempotencyKey: randomUUID() });
    await recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 20 }), deliveredAt: TODAY, idempotencyKey: randomUUID() });
    const s = (await getOrderProduction(db, staff, orderId))!.groups[0]!.sizes[0]!;
    expect([s.quantity, s.ready, s.delivered, s.ready - s.delivered, s.quantity - s.ready]).toEqual([50, 30, 20, 10, 20]);
  });

  it("normalizes labels without changing meaning, accepts custom sizes, refuses duplicates", async () => {
    const { details: d } = await order(
      [{ operations: ["DTF"], sizes: [{ label: " xl ", quantity: "10" }, { label: "2 xl", quantity: "10" }, { label: "١٠ سنين", quantity: "5" }, { label: "38", quantity: "5" }, { label: "XXL", quantity: "5" }] }],
      "35",
    );
    expect(d.groups[0]!.sizes.map((s) => s.label)).toEqual(["XL", "2XL", "10 سنين", "38", "XXL"]);
    await expect(order([{ operations: ["DTF"], sizes: [{ label: "xl", quantity: "5" }, { label: "XL", quantity: "5" }] }], "10")).rejects.toMatchObject({
      fieldErrors: { "groups.0.sizes": ["المقاس XL متكرر"] },
    });
  });

  it("each group's sizes must add up to that group (frontend + backend share the rule)", async () => {
    await expect(
      order([{ quantity: "100", operations: ["DTF"], sizes: [{ label: "S", quantity: "50" }, { label: "M", quantity: "30" }] }, { quantity: "100", operations: ["EMBROIDERY"], sizes: [{ label: "S", quantity: "100" }] }], "200"),
    ).rejects.toMatchObject({ fieldErrors: { "groups.0.sizes": ["لسه 20 قطعة محتاجة توزيع على المقاسات"] } });
    await expect(order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "60" }] }], "50")).rejects.toMatchObject({
      fieldErrors: { "groups.0.sizes": ["المقاسات زيادة 10 قطعة عن كمية المجموعة"] },
    });
    await expect(order([{ operations: ["DTF"], sizes: [] }], "50")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("sizes switched off: nothing stored, unsized order works as before", async () => {
    const { orderId, details: d } = await order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "999" }] }], "100", { sizesEnabled: false });
    expect(d.sizesEnabled).toBe(false);
    expect(d.groups[0]!.sizes).toEqual([]);
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[0]!.id, operation: "DTF", quantity: "40", workDate: TODAY, alsoReady: true, idempotencyKey: randomUUID() });
    await recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, quantity: "30", deliveredAt: TODAY, idempotencyKey: randomUUID() });
    expect((await getOrderProduction(db, staff, orderId))!.totals).toMatchObject({ ready: 40, delivered: 30 });
    // An unsized group refuses size lines; a sized group refuses a plain quantity.
    await expect(
      recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: [{ sizeId: randomUUID(), quantity: "1" }], deliveredAt: TODAY, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const sized = await order([{ operations: [], plain: true, sizes: [{ label: "M", quantity: "10" }] }], "10");
    await expect(recordReady(db, staff, { orderId: sized.orderId, orderGroupId: sized.details.groups[0]!.id, quantity: "5", readyDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      fieldErrors: { sizes: expect.any(Array) },
    });
  });

  // ─── Editing ───

  function editPayload(d: Awaited<ReturnType<typeof order>>["details"], over: Partial<UpdateOrderPayload>): UpdateOrderPayload {
    return {
      orderId: d.id,
      expectedUpdatedAt: d.updatedAt,
      customer: { mode: "existing", id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      quantity: String(d.quantity),
      unit: d.unit,
      sizesEnabled: true,
      groups: d.groups.map((g) => ({ id: g.id, quantity: String(g.quantity), operations: g.operations, plain: g.operations.length === 0, sizes: g.sizes.map((s) => ({ label: s.label, quantity: String(s.quantity) })) })),
      totalPrice: "40000",
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: d.status === "COMPLETED" ? "IN_PROGRESS" : (d.status as "NEW"),
      ...over,
    };
  }

  it("before production: sizes can be changed, added and removed; unchanged labels keep their ids; edits are audited", async () => {
    const { orderId, details: d } = await order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "50" }, { label: "M", quantity: "50" }] }], "100");
    const mId = sizeId(d, 0, "M");
    await updateOrder(db, owner, editPayload(d, { groups: [{ id: d.groups[0]!.id, operations: ["DTF"], plain: false, sizes: [{ label: "M", quantity: "40" }, { label: "L", quantity: "60" }] }] }));
    const after = (await getOrderDetails(db, owner, orderId))!;
    expect(after.groups[0]!.sizes.map((s) => `${s.label}:${s.quantity}`)).toEqual(["M:40", "L:60"]);
    expect(sizeId(after, 0, "M")).toBe(mId);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_UPDATED" } });
    expect(JSON.stringify(log.metadata)).toContain("L:60");
  });

  it("after production: sizes with records can't be removed or cut below production; history is never re-split", async () => {
    const { orderId, details: d } = await order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "50" }, { label: "M", quantity: "50" }] }], "100");
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[0]!.id, operation: "DTF", sizes: lines(d, 0, { S: 30 }), workDate: TODAY, idempotencyKey: randomUUID() });
    const fresh = (await getOrderDetails(db, owner, orderId))!;
    const g = fresh.groups[0]!.id;
    await expect(updateOrder(db, owner, editPayload(fresh, { groups: [{ id: g, operations: ["DTF"], plain: false, sizes: [{ label: "M", quantity: "100" }] }] }))).rejects.toMatchObject({
      fieldErrors: { "groups.0.sizes": [expect.stringContaining("المقاس S")] },
    });
    await expect(
      updateOrder(db, owner, editPayload(fresh, { groups: [{ id: g, operations: ["DTF"], plain: false, sizes: [{ label: "S", quantity: "29" }, { label: "M", quantity: "71" }] }] })),
    ).rejects.toMatchObject({ fieldErrors: { "groups.0.sizes": [expect.stringContaining("30")] } });
    await expect(updateOrder(db, owner, editPayload(fresh, { sizesEnabled: false }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Moving quantity between untouched sizes is fine.
    await updateOrder(db, owner, editPayload(fresh, { groups: [{ id: g, operations: ["DTF"], plain: false, sizes: [{ label: "S", quantity: "30" }, { label: "M", quantity: "70" }] }] }));
    expect((await getOrderProduction(db, owner, orderId))!.groups[0]!.sizes.map((s) => `${s.label}:${s.quantity}:${s.stage.DTF}`)).toEqual(["S:30:30", "M:70:0"]);
  });

  it("a group with unsized production can't be split into sizes afterwards (no invented history)", async () => {
    const { orderId, details: d } = await order([{ operations: ["DTF"] }], "100", { sizesEnabled: false });
    await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[0]!.id, operation: "DTF", quantity: "10", workDate: TODAY, idempotencyKey: randomUUID() });
    const fresh = (await getOrderDetails(db, owner, orderId))!;
    await expect(
      updateOrder(db, owner, editPayload(fresh, { groups: [{ id: fresh.groups[0]!.id, operations: ["DTF"], plain: false, sizes: [{ label: "S", quantity: "100" }] }] })),
    ).rejects.toMatchObject({ fieldErrors: { "groups.0.sizes": [expect.stringContaining("من غير مقاسات")] } });
  });

  // ─── Safety ───

  it("over-delivery of one size rejects the whole multi-size submission", async () => {
    const { orderId, details: d } = await order([{ operations: [], plain: true, sizes: [{ label: "S", quantity: "20" }, { label: "M", quantity: "20" }] }], "40");
    await recordReady(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 10, M: 5 }), readyDate: TODAY, idempotencyKey: randomUUID() });
    await expect(
      recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 10, M: 6 }), deliveredAt: TODAY, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ fieldErrors: { [`size:${sizeId(d, 0, "M")}`]: ["مقاس M: الجاهز اللي لسه متسلمش 5 قطعة بس"] } });
    expect(await db.delivery.count()).toBe(0); // S 10 rolled back too
  });

  it("concurrent multi-size deliveries can't deliver the same pieces twice; retries save once", async () => {
    const { orderId, details: d } = await order([{ operations: [], plain: true, sizes: [{ label: "S", quantity: "20" }, { label: "M", quantity: "20" }] }], "40");
    await recordReady(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 10, M: 10 }), readyDate: TODAY, idempotencyKey: randomUUID() });
    const deliverAll = () => recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 8, M: 8 }), deliveredAt: TODAY, idempotencyKey: randomUUID() });
    const results = await Promise.allSettled([deliverAll(), deliverAll(), deliverAll()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const same = { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 2, M: 2 }), deliveredAt: TODAY, idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([recordDelivery(db, staff, same), recordDelivery(db, staff, same)]);
    expect(a.id).toBe(b.id);
    const p = (await getOrderProduction(db, staff, orderId))!;
    expect(p.groups[0]!.sizes.map((s) => s.delivered)).toEqual([10, 10]);
    expect(await db.delivery.count({ where: { voidedAt: null } })).toBe(4);
  });

  it("owner corrections check dependencies per size", async () => {
    const { orderId, details: d } = await order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "10" }, { label: "M", quantity: "10" }] }], "20");
    const st = await recordStageProgress(db, staff, { orderId, orderGroupId: d.groups[0]!.id, operation: "DTF", sizes: lines(d, 0, { S: 5 }), workDate: TODAY, alsoReady: true, idempotencyKey: randomUUID() });
    const del = await recordDelivery(db, staff, { orderId, orderGroupId: d.groups[0]!.id, sizes: lines(d, 0, { S: 5 }), deliveredAt: TODAY, idempotencyKey: randomUUID() });
    const ready = await db.productionReady.findFirstOrThrow();
    await expect(voidStageProgress(db, owner, { id: st.id, reason: "غلط" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(voidReady(db, owner, { id: ready.id, reason: "غلط" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(voidDelivery(db, staff, { id: del.id, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidDelivery(db, owner, { id: del.id, reason: "متسجل غلط" });
    await voidReady(db, owner, { id: ready.id, reason: "مش جاهز" });
    await voidStageProgress(db, owner, { id: st.id, reason: "العدد غلط" });
    expect((await getOrderProduction(db, owner, orderId))!.totals).toMatchObject({ ready: 0, delivered: 0 });
    const actions = (await db.auditLog.findMany({ where: { action: { in: ["DELIVERY_VOIDED", "PRODUCTION_READY_VOIDED"] } } })).map((a) => (a.metadata as { size: string }).size);
    expect(actions).toEqual(["S", "S"]);
  });

  it("worker output can't confirm stage pieces on a sized group (record sizes from the order page)", async () => {
    const w = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300" });
    const { orderId, details: d } = await order([{ operations: ["DTF"], sizes: [{ label: "S", quantity: "10" }] }], "10");
    await expect(
      recordWorkLog(db, staff, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId, orderGroupId: d.groups[0]!.id, workType: "DTF", unit: "PRINT", quantity: "50", stageQuantity: "5" }),
    ).rejects.toMatchObject({ fieldErrors: { stageQuantity: [expect.stringContaining("بمقاسات")] } });
    // Plain productivity logging still works on that group.
    await recordWorkLog(db, staff, { workerId: w.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId, orderGroupId: d.groups[0]!.id, workType: "DTF", unit: "PRINT", quantity: "50" });
    expect((await getOrderProduction(db, owner, orderId))!.totals.ready).toBe(0);
  });
});
