import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { UpdateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import { createCustomer } from "@/server/services/customer-service";
import { getOrderLabor, getWorkerDetails } from "@/server/services/labor-service";
import { getOrderDetails, listOrders, updateOrder } from "@/server/services/order-service";
import {
  getOrderProduction,
  getProductionDashboard,
  recordDelivery,
  recordReady,
  recordStageProgress,
  voidDelivery,
  voidReady,
  voidStageProgress,
} from "@/server/services/production-service";
import { recordWorkLog } from "@/server/services/work-service";
import { createWorker } from "@/server/services/worker-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase, createSharedOrder } from "../support/test-db";

const TODAY = todayDateString();

describe.skipIf(!hasTestDatabase)("production & partial delivery (PostgreSQL)", () => {
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

  async function order(groups: { quantity?: string; operations: string[]; plain?: boolean }[], quantity: string, customer = "محمود", deliveryDate = "2099-01-15", unit = "PIECE") {
    const c = await createCustomer(db, owner, { name: customer });
    const { orderId } = await createSharedOrder(db, owner, {
      idempotencyKey: randomUUID(),
      customer: { mode: "existing", id: c.id },
      title: `أوردر ${customer}`,
      productType: "تيشيرت",
      material: "قطن",
      quantity,
      unit,
      groups: groups.map((g) => ({ plain: false, ...g })),
      totalPrice: "40000",
      advance: "0",
      receivedDate: "2026-01-01",
      deliveryDate,
    });
    const groupIds = (await getOrderDetails(db, owner, orderId))!.groups.map((g) => g.id);
    return { orderId, groupIds };
  }
  const stage = (orderId: string, orderGroupId: string, operation: string, quantity: number, extra: Record<string, unknown> = {}) =>
    recordStageProgress(db, staff, { orderId, orderGroupId, operation, quantity: String(quantity), workDate: TODAY, idempotencyKey: randomUUID(), ...extra });
  const ready = (orderId: string, orderGroupId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    recordReady(db, staff, { orderId, orderGroupId, quantity: String(quantity), readyDate: TODAY, idempotencyKey: randomUUID(), ...extra });
  const deliver = (orderId: string, orderGroupId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    recordDelivery(db, staff, { orderId, orderGroupId, quantity: String(quantity), deliveredAt: TODAY, idempotencyKey: randomUUID(), ...extra });
  const status = async (orderId: string) => (await db.order.findUniqueOrThrow({ where: { id: orderId } })).status;

  // ─── Scenario A ───

  it("A: 1000 required, 600 finished, deliveries 250 + 150", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF"] }], "1000");
    expect(await status(orderId)).toBe("NEW");
    await stage(orderId, g!, "DTF", 600, { alsoReady: true }); // single step: same save marks them ready
    await deliver(orderId, g!, 250);
    await deliver(orderId, g!, 150);

    const p = (await getOrderProduction(db, staff, orderId))!;
    expect(p.totals).toEqual({ required: 1000, ready: 600, delivered: 400, readyNotDelivered: 200, remaining: 400 });
    expect(p.groups[0]!.stage).toEqual({ DTF: 600 }); // delivery added nothing to production
    expect(await status(orderId)).toBe("IN_PROGRESS");
    expect(p.deliveryHistory.map((d) => d.quantity)).toEqual(expect.arrayContaining([250, 150]));

    await expect(deliver(orderId, g!, 201)).rejects.toMatchObject({ fieldErrors: { quantity: ["الجاهز اللي لسه متسلمش 200 قطعة بس"] } });
  });

  // ─── Scenario B ───

  it("B: three groups; DTF 40 + embroidery 30 on the same shirts → at most 30 ready; 25 confirmed; deliveries", async () => {
    const { orderId, groupIds: [g1, g2, g3] } = await order(
      [
        { quantity: "100", operations: ["DTF"] },
        { quantity: "50", operations: ["EMBROIDERY"] },
        { quantity: "50", operations: ["DTF", "EMBROIDERY"] },
      ],
      "200",
    );
    await stage(orderId, g3!, "DTF", 40);
    await stage(orderId, g3!, "EMBROIDERY", 30);

    let p = (await getOrderProduction(db, staff, orderId))!;
    const grp3 = p.groups[2]!;
    expect(grp3.stage).toEqual({ DTF: 40, EMBROIDERY: 30 });
    expect(grp3.maxReady).toBe(30);
    expect(p.totals.ready).toBe(0); // 70 step-completions are NOT 70 shirts

    // "Also ready" in the same save is only for single-step groups — and the failed save keeps nothing.
    await expect(stage(orderId, g3!, "DTF", 5, { alsoReady: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await getOrderProduction(db, staff, orderId))!.groups[2]!.stage).toEqual({ DTF: 40, EMBROIDERY: 30 });

    // Multi-step: explicit confirmation that the same pieces did both steps.
    await expect(ready(orderId, g3!, 25)).rejects.toMatchObject({ fieldErrors: { confirmAllOperations: expect.any(Array) } });
    await ready(orderId, g3!, 25, { confirmAllOperations: true });
    await expect(ready(orderId, g3!, 35, { confirmAllOperations: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(ready(orderId, g3!, 6, { confirmAllOperations: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" }); // 25 + 6 > 30

    await deliver(orderId, g3!, 20);
    p = (await getOrderProduction(db, staff, orderId))!;
    expect(p.groups[2]).toMatchObject({ ready: 25, delivered: 20, maxReady: 30 });
    expect(p.groups[2]!.quantity - p.groups[2]!.ready).toBe(25); // remaining to finish in group 3
    expect(p.totals).toEqual({ required: 200, ready: 25, delivered: 20, readyNotDelivered: 5, remaining: 175 });

    // More progress, repeat.
    await stage(orderId, g3!, "EMBROIDERY", 20); // 50
    await stage(orderId, g3!, "DTF", 10); // 50
    await ready(orderId, g3!, 25, { confirmAllOperations: true });
    await deliver(orderId, g3!, 30);
    await expect(stage(orderId, g3!, "DTF", 1)).rejects.toMatchObject({ code: "VALIDATION_ERROR" }); // can't exceed 50
    await stage(orderId, g1!, "DTF", 100, { alsoReady: true });
    await stage(orderId, g2!, "EMBROIDERY", 50, { alsoReady: true });
    p = (await getOrderProduction(db, staff, orderId))!;
    expect(p.totals).toEqual({ required: 200, ready: 200, delivered: 50, readyNotDelivered: 150, remaining: 0 });

    // Wrong step for a group is refused.
    await expect(stage(orderId, g1!, "EMBROIDERY", 1)).rejects.toMatchObject({ fieldErrors: { operation: expect.any(Array) } });
  });

  // ─── Status automation ───

  it("status: new → in progress → completed only when everything is delivered; voids roll it back", async () => {
    const { orderId, groupIds: [a, b] } = await order([{ quantity: "10", operations: [], plain: true }, { quantity: "5", operations: ["DTF"] }], "15");
    expect(await status(orderId)).toBe("NEW");
    await ready(orderId, a!, 10); // no tracked step: direct "ready"
    expect(await status(orderId)).toBe("IN_PROGRESS");
    await deliver(orderId, a!, 10);
    expect(await status(orderId)).toBe("IN_PROGRESS"); // group b not delivered
    await stage(orderId, b!, "DTF", 5, { alsoReady: true });
    const last = await deliver(orderId, b!, 5);
    expect(await status(orderId)).toBe("COMPLETED");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).completedAt).not.toBeNull();
    // A completed order no longer counts as overdue/open; editing it is blocked.
    expect((await listOrders(db, owner, { status: "COMPLETED" })).total).toBe(1);

    await voidDelivery(db, owner, { id: last.id, reason: "اتسجل غلط" });
    expect(await status(orderId)).toBe("IN_PROGRESS");
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).completedAt).toBeNull();
    const audits = await db.auditLog.findMany({ where: { action: "ORDER_STATUS_AUTO" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.metadata as { to: string }).to)).toEqual(["IN_PROGRESS", "COMPLETED", "IN_PROGRESS"]);
  });

  it("overdue uses the agreed date and Cairo's today; completed orders are never overdue", async () => {
    const late = await order([{ operations: [], plain: true }], "5", "متأخر", "2026-01-02");
    expect((await listOrders(db, owner, { status: "overdue" })).items.map((o) => o.id)).toEqual([late.orderId]);
    await ready(late.orderId, late.groupIds[0]!, 5);
    await deliver(late.orderId, late.groupIds[0]!, 5);
    expect((await listOrders(db, owner, { status: "overdue" })).total).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: late.orderId } })).deliveryDate.toISOString().slice(0, 10)).toBe("2026-01-02");
  });

  // ─── Concurrency, duplicates, rollback ───

  it("two people delivering the last pieces at once: only one succeeds", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: [], plain: true }], "100");
    await ready(orderId, g!, 50);
    const results = await Promise.allSettled([deliver(orderId, g!, 40), deliver(orderId, g!, 40), deliver(orderId, g!, 40)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getOrderProduction(db, owner, orderId))!.totals.delivered).toBe(40);
  });

  it("simultaneous stage records can't exceed the group quantity", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF"] }], "100");
    const results = await Promise.allSettled([stage(orderId, g!, "DTF", 60), stage(orderId, g!, "DTF", 60)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("repeated taps / retries save production and deliveries once", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF"] }], "100");
    const s = { orderId, orderGroupId: g!, operation: "DTF", quantity: "30", workDate: TODAY, idempotencyKey: randomUUID(), alsoReady: true };
    const [a, b] = await Promise.all([recordStageProgress(db, staff, s), recordStageProgress(db, staff, s)]);
    expect(a.id).toBe(b.id);
    const d = { orderId, orderGroupId: g!, quantity: "10", deliveredAt: TODAY, idempotencyKey: randomUUID() };
    const [x, y] = await Promise.all([recordDelivery(db, staff, d), recordDelivery(db, staff, d)]);
    expect(x.id).toBe(y.id);
    expect((await getOrderProduction(db, owner, orderId))!.totals).toMatchObject({ ready: 30, delivered: 10 });
    expect(await db.productionStageProgress.count()).toBe(1);
    expect(await db.productionReady.count()).toBe(1);
  });

  it("rolls back stage + ready together when part of the save fails", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF"] }], "100");
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_ready() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated'; END; $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_ready BEFORE INSERT ON production_ready FOR EACH ROW EXECUTE FUNCTION test_fail_ready()`);
    try {
      await expect(stage(orderId, g!, "DTF", 10, { alsoReady: true })).rejects.toThrow();
      expect(await db.productionStageProgress.count()).toBe(0);
      expect(await status(orderId)).toBe("NEW");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_ready ON production_ready`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_ready()`);
    }
  });

  // ─── Corrections ───

  it("corrections are owner-only and can't leave delivered > ready > stage", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF", "EMBROIDERY"] }], "50");
    const dtf = await stage(orderId, g!, "DTF", 20);
    await stage(orderId, g!, "EMBROIDERY", 20);
    const r = await ready(orderId, g!, 20, { confirmAllOperations: true });
    const d = await deliver(orderId, g!, 15);

    await expect(voidDelivery(db, staff, { id: d.id, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(voidStageProgress(db, owner, { id: dtf.id, reason: "غلط" })).rejects.toMatchObject({ code: "CONFLICT" }); // ready depends on it
    await expect(voidReady(db, owner, { id: r.id, reason: "غلط" })).rejects.toMatchObject({ code: "CONFLICT" }); // delivered depends on it

    await voidDelivery(db, owner, { id: d.id, reason: "التسليم متسجل غلط" });
    await voidReady(db, owner, { id: r.id, reason: "مش جاهزين" });
    await voidStageProgress(db, owner, { id: dtf.id, reason: "العدد غلط" });
    const p = (await getOrderProduction(db, owner, orderId))!;
    expect(p.totals).toMatchObject({ ready: 0, delivered: 0 });
    expect(p.groups[0]!.stage).toEqual({ DTF: 0, EMBROIDERY: 20 });
    expect(p.deliveryHistory[0]!.voided).toMatchObject({ reason: "التسليم متسجل غلط" });
    const actions = (await db.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["DELIVERY_VOIDED", "PRODUCTION_READY_VOIDED", "PRODUCTION_STAGE_VOIDED"]));
  });

  it("cancelled orders accept no production, and orders with production can't be cancelled", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: ["DTF"] }], "10");
    await stage(orderId, g!, "DTF", 5);
    const d = (await getOrderDetails(db, owner, orderId))!;
    const edit: UpdateOrderPayload = {
      orderId,
      customer: { mode: "existing", id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      quantity: "10",
      unit: d.unit,
      groups: [{ id: g!, operations: ["DTF"], plain: false }],
      totalPrice: "40000",
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: "CANCELLED",
    };
    await expect(updateOrder(db, owner, edit)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ─── Editing after production started ───

  it("edits keep group ids and refuse to break production history", async () => {
    const { orderId, groupIds: [g1, g2] } = await order([{ quantity: "60", operations: ["DTF", "EMBROIDERY"] }, { quantity: "40", operations: ["DTF"] }], "100");
    await stage(orderId, g1!, "EMBROIDERY", 30);
    await stage(orderId, g2!, "DTF", 10, { alsoReady: true });
    let d = (await getOrderDetails(db, owner, orderId))!;
    const base = (over: Partial<UpdateOrderPayload>): UpdateOrderPayload => ({
      orderId,
      expectedUpdatedAt: d.updatedAt,
      customer: { mode: "existing", id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      quantity: "100",
      unit: "PIECE",
      groups: [],
      totalPrice: "40000",
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: "IN_PROGRESS",
      ...over,
    });
    const ok = [
      { id: g1!, quantity: "60", operations: ["DTF", "EMBROIDERY"], plain: false },
      { id: g2!, quantity: "40", operations: ["DTF"], plain: false },
    ];
    // Remove embroidery (has progress) → refused.
    await expect(updateOrder(db, owner, base({ groups: [{ ...ok[0]!, operations: ["DTF"] }, ok[1]!] }))).rejects.toMatchObject({
      fieldErrors: { "groups.0.operations": expect.any(Array) },
    });
    // Cut group 1 below the 30 already embroidered → refused.
    await expect(updateOrder(db, owner, base({ quantity: "69", groups: [{ ...ok[0]!, quantity: "29" }, ok[1]!] }))).rejects.toMatchObject({
      fieldErrors: { "groups.0.quantity": expect.any(Array) },
    });
    // Remove group 2 (has production) → refused.
    await expect(updateOrder(db, owner, base({ quantity: "60", groups: [ok[0]!] }))).rejects.toMatchObject({ code: "CONFLICT" });
    // Change unit / go back to "new" → refused.
    await expect(updateOrder(db, owner, base({ unit: "METER", groups: ok }))).rejects.toMatchObject({ fieldErrors: { unit: expect.any(Array) } });
    await expect(updateOrder(db, owner, base({ status: "NEW", groups: ok }))).rejects.toMatchObject({ fieldErrors: { status: expect.any(Array) } });

    // Adding manufacturing to group 1 and notes is fine; ids and progress survive.
    await updateOrder(db, owner, base({ groups: [{ ...ok[0]!, operations: ["MANUFACTURING", "DTF", "EMBROIDERY"], notes: "خياطة" }, ok[1]!] }));
    d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => g.id)).toEqual([g1, g2]);
    expect(d.groups[0]!.description).toBe("تصنيع + DTF + تطريز");
    const p = (await getOrderProduction(db, owner, orderId))!;
    expect(p.groups[0]!.stage).toEqual({ MANUFACTURING: 0, DTF: 0, EMBROIDERY: 30 });
    expect(p.totals.ready).toBe(10);

    // Reducing group 2 to exactly what was delivered (after delivering it) completes nothing on its own.
    await deliver(orderId, g2!, 10);
    expect(await status(orderId)).toBe("IN_PROGRESS");
  });

  // ─── Worker integration ───

  it("C: worker logs never become finished shirts; an explicit stage confirmation adds 50 pieces, wages unchanged", async () => {
    const youssef = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300", dailyTarget: "300", targetUnit: "PRINT" });
    const mahmoud = await order([{ operations: ["DTF"] }], "200");
    const ahmed = await order([{ operations: ["DTF"] }], "100", "أحمد");
    await recordWorkLog(db, staff, { workerId: youssef.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: mahmoud.orderId, orderGroupId: mahmoud.groupIds[0], workType: "DTF", unit: "PRINT", quantity: "200" });
    await recordWorkLog(db, staff, { workerId: youssef.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: ahmed.orderId, workType: "DTF", unit: "PRINT", quantity: "100" });

    const w = (await getWorkerDetails(db, owner, youssef.id))!;
    expect(w.days[0]!.output).toEqual([{ unit: "PRINT", quantity: 300 }]);
    expect(w.pay!.earnedTotal).toBe("300.00");
    expect((await getOrderLabor(db, owner, mahmoud.orderId)).total).toBe("200.00");
    expect((await getOrderLabor(db, owner, ahmed.orderId)).total).toBe("100.00");
    // 300 prints did NOT become shirts.
    expect((await getOrderProduction(db, owner, mahmoud.orderId))!.groups[0]!.stage).toEqual({ DTF: 0 });
    expect(await status(mahmoud.orderId)).toBe("NEW");

    // The operator explicitly confirms 50 physical shirts finished DTF with this work.
    const extra = await recordWorkLog(db, staff, {
      workerId: youssef.id,
      idempotencyKey: randomUUID(),
      workDate: TODAY,
      orderId: mahmoud.orderId,
      orderGroupId: mahmoud.groupIds[0],
      workType: "DTF",
      unit: "PRINT",
      quantity: "100",
      stageQuantity: "50",
    });
    const p = (await getOrderProduction(db, owner, mahmoud.orderId))!;
    expect(p.groups[0]!.stage).toEqual({ DTF: 50 });
    expect(p.totals.ready).toBe(0); // never auto-ready
    expect(p.stageHistory[0]).toMatchObject({ quantity: 50, fromWorker: "يوسف" });
    expect((await db.productionStageProgress.findFirstOrThrow()).workLogId).toBe(extra.workLogId);
    // Still ONE wage for the day; labour re-split by prints (300 Mahmoud of 400), never doubled.
    expect(await db.workerWorkday.count()).toBe(1);
    expect((await getWorkerDetails(db, owner, youssef.id))!.pay!.earnedTotal).toBe("300.00");
    expect((await getOrderLabor(db, owner, mahmoud.orderId)).total).toBe("225.00");
    expect(await status(mahmoud.orderId)).toBe("IN_PROGRESS");

    // A work type that isn't a tracked step can't confirm stage pieces.
    await expect(
      recordWorkLog(db, staff, { workerId: youssef.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: mahmoud.orderId, orderGroupId: mahmoud.groupIds[0], workType: "PACKING", unit: "PRINT", quantity: "10", stageQuantity: "5" }),
    ).rejects.toMatchObject({ fieldErrors: { stageQuantity: expect.any(Array) } });
    // Exceeding the group is reported on the stage field, and the whole save (incl. the log) rolls back.
    const logsBefore = await db.workerWorkLog.count();
    await expect(
      recordWorkLog(db, staff, { workerId: youssef.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: mahmoud.orderId, orderGroupId: mahmoud.groupIds[0], workType: "DTF", unit: "PRINT", quantity: "10", stageQuantity: "151" }),
    ).rejects.toMatchObject({ fieldErrors: { stageQuantity: expect.any(Array) } });
    expect(await db.workerWorkLog.count()).toBe(logsBefore);
  });

  // ─── Units, dashboard, permissions ───

  it("dashboard counts per unit, never mixing meters and pieces", async () => {
    const pieces = await order([{ operations: [], plain: true }], "10");
    const meters = await order([{ operations: [], plain: true }], "30", "قماش", "2099-01-15", "METER");
    await ready(pieces.orderId, pieces.groupIds[0]!, 10);
    await deliver(pieces.orderId, pieces.groupIds[0]!, 10);
    await ready(meters.orderId, meters.groupIds[0]!, 30);
    await deliver(meters.orderId, meters.groupIds[0]!, 12);
    const dash = await getProductionDashboard(db, staff);
    expect(dash.deliveredThisMonth).toEqual(expect.arrayContaining([{ unit: "PIECE", qty: 10 }, { unit: "METER", qty: 12 }]));
    expect(dash.deliveredThisMonth).toHaveLength(2);
    expect(dash.deliveriesToday).toBe(2);
    expect(dash.completedThisMonth).toBe(1);
  });

  it("permissions are enforced in services", async () => {
    const { orderId, groupIds: [g] } = await order([{ operations: [], plain: true }], "10");
    const nobody = { id: staff.id, role: "UNKNOWN" } as unknown as Actor;
    await expect(ready(orderId, g!, 1, {}).then(() => recordReady(db, nobody, { orderId, orderGroupId: g!, quantity: "1", readyDate: TODAY, idempotencyKey: randomUUID() }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDelivery(db, nobody, { orderId, orderGroupId: g!, quantity: "1", deliveredAt: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOrderProduction(db, nobody, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Staff can record but not correct.
    const del = await deliver(orderId, g!, 1);
    await expect(voidDelivery(db, staff, { id: del.id, reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
