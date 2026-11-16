import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import type { CreateOrderPayload, UpdateOrderPayload } from "@/lib/validations/order";
import { renderOrderInvoice } from "@/server/documents/customer-documents";
import type { Actor } from "@/server/services/actor";
import { getCustomerStatement, getOrderInvoiceData } from "@/server/services/customer-documents-service";
import { getCustomerDetails } from "@/server/services/customer-service";
import { archiveOrder, getArchiveCheck, restoreOrder } from "@/server/services/order-archive-service";
import { createOrder, getOrderDetails, listOrders, updateOrder, type OrderDetails } from "@/server/services/order-service";
import { recordPayment } from "@/server/services/payment-service";
import { getOrderProduction, recordDelivery, recordReady, recordStageProgress } from "@/server/services/production-service";
import { getReceivables } from "@/server/services/reports-service";
import { recordWorkLog } from "@/server/services/work-service";
import { createWorker } from "@/server/services/worker-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const money = centsToDecimalString;

describe.skipIf(!hasTestDatabase)("named items, item pricing, designs & safe removal (PostgreSQL)", () => {
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

  const design = (o: Record<string, unknown> = {}) => ({ operation: "DTF", placements: [], customPlacements: [], ...o });
  const newOrder = async (o: Partial<CreateOrderPayload> & Record<string, unknown>, actor = staff) => {
    const r = await createOrder(db, actor, {
      idempotencyKey: randomUUID(),
      customer: { mode: "new", name: "AUC" },
      title: "AUC Graduation",
      productType: "تيشيرت",
      material: "قطن",
      unit: "PIECE",
      pricing: "items",
      receivedDate: TODAY,
      deliveryDate: "2099-12-31",
      advance: "0",
      advanceMethod: "CASH",
      groups: [],
      ...o,
    } as CreateOrderPayload);
    return (await getOrderDetails(db, owner, r.orderId))!;
  };
  /** Edit payload that resubmits the order as it is (then override). */
  const editOf = (d: OrderDetails, o: Partial<UpdateOrderPayload> & Record<string, unknown> = {}): UpdateOrderPayload =>
    ({
      orderId: d.id,
      expectedUpdatedAt: d.updatedAt,
      customer: { mode: "existing", id: d.customerId },
      title: d.title,
      productType: d.productType,
      material: d.material,
      unit: d.unit,
      status: d.status === "COMPLETED" ? "IN_PROGRESS" : d.status,
      pricing: d.pricing === "PER_ITEM" ? "items" : "order",
      ...(d.pricing === "PER_ITEM" ? {} : { totalPrice: d.totalPrice }),
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      sizesEnabled: d.sizesEnabled,
      groups: d.groups.map((g) => ({
        id: g.id,
        name: g.name ?? undefined,
        quantity: String(g.quantity),
        material: g.material,
        unitPrice: g.unitPrice ?? undefined,
        operations: g.designs.length ? [] : g.operations,
        plain: g.operations.length === 0,
        designs: g.designs.map((x) => ({ id: x.id, name: x.name ?? undefined, operation: x.operation, placements: x.placements, customPlacements: x.customPlacements, quantity: String(x.quantity), pressesPerUnit: x.pressesPerUnit === null ? "" : String(x.pressesPerUnit) })),
        sizes: g.sizes.map((s) => ({ label: s.label, quantity: String(s.quantity) })),
      })),
      ...o,
    }) as UpdateOrderPayload;
  const stage = (orderId: string, orderGroupId: string, designId: string, operation: string, quantity: number) =>
    recordStageProgress(db, staff, { orderId, orderGroupId, designId, operation, quantity: String(quantity), workDate: TODAY, idempotencyKey: randomUUID() } as never);
  const ready = (orderId: string, orderGroupId: string, quantity: number, confirm = false) =>
    recordReady(db, staff, { orderId, orderGroupId, quantity: String(quantity), readyDate: TODAY, confirmAllOperations: confirm, idempotencyKey: randomUUID() });

  it("AUC: three priced items, 600 pieces, 20,000 — consistent on the order, customer, invoice and statement", async () => {
    const d = await newOrder({
      advance: "5000",
      groups: [
        { name: "رسمة الجامعة", quantity: "200", unitPrice: "25", designs: [design({ name: "لوجو الجامعة", placements: ["CHEST"], pressesPerUnit: "2" })] },
        { name: "رسمة الخريجين", quantity: "200", unitPrice: "35", designs: [design({ operation: "SCREEN_PRINT", placements: ["BACK"] })] },
        { name: "رسمة الدفعة", quantity: "200", unitPrice: "40", designs: [design({ placements: ["CHEST"] }), design({ operation: "EMBROIDERY", placements: ["RIGHT_SLEEVE"], customPlacements: ["تحت الرقبة"] })] },
      ],
    });
    expect(d).toMatchObject({ pricing: "PER_ITEM", quantity: 600, totalPrice: "20000.00", paid: "5000.00", outstanding: "15000.00" });
    expect(d.groups.map((g) => [g.label, g.quantity, g.unitPrice, g.lineTotal])).toEqual([
      ["رسمة الجامعة", 200, "25.00", "5000.00"],
      ["رسمة الخريجين", 200, "35.00", "7000.00"],
      ["رسمة الدفعة", 200, "40.00", "8000.00"],
    ]);
    expect(d.groups[2]!.designs[1]).toMatchObject({ operation: "EMBROIDERY", placements: ["RIGHT_SLEEVE"], customPlacements: ["تحت الرقبة"], quantity: 200 });
    expect(d.groups[0]!.plannedPresses).toBe(400);

    const customer = (await getCustomerDetails(db, owner, d.customerId))!;
    expect(customer.totals).toMatchObject({ agreed: "20000.00", paid: "5000.00", outstanding: "15000.00" });
    const inv = (await getOrderInvoiceData(db, owner, d.id))!;
    expect(inv.pricing).toBe("PER_ITEM");
    expect(money(inv.groups.reduce((s, g) => s + g.lineTotal!, 0n))).toBe("20000.00");
    expect(money(inv.balance.outstanding)).toBe("15000.00");
    const st = (await getCustomerStatement(db, owner, d.customerId, {}))!.statement;
    // One charge per ORDER (not per item), one credit for the advance.
    expect(st.entries.map((e) => [e.kind, money(e.debit), money(e.credit)])).toEqual([
      ["charge", "20000.00", "0.00"],
      ["payment", "0.00", "5000.00"],
    ]);
    const pdf = await renderOrderInvoice(inv);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("two designs on the same 200 shirts: 200 physical pieces, separate progress, presses planned per design", async () => {
    const d = await newOrder({
      groups: [
        {
          name: "تيشيرتات AUC",
          quantity: "200",
          unitPrice: "50",
          designs: [design({ name: "صدر", placements: ["CHEST"], pressesPerUnit: "1" }), design({ name: "ضهر", placements: ["BACK"], pressesPerUnit: "2" })],
        },
      ],
    });
    const g = d.groups[0]!;
    const [chest, back] = g.designs;
    expect(d.quantity).toBe(200);
    expect(g.operations).toEqual(["DTF"]);
    expect(d.totalPrice).toBe("10000.00"); // price is per item, never × designs
    expect(g.plannedPresses).toBe(200 * 1 + 200 * 2);

    await stage(d.id, g.id, chest!.id, "DTF", 150);
    await stage(d.id, g.id, back!.id, "DTF", 80);
    let p = (await getOrderProduction(db, owner, d.id))!;
    expect(p.groups[0]!.design).toEqual({ [chest!.id]: 150, [back!.id]: 80 });
    expect(p.groups[0]!.maxReady).toBe(80);
    expect(p.totals.required).toBe(200);

    // A design can't take more than its pieces, a step without a design is refused.
    await expect(stage(d.id, g.id, chest!.id, "DTF", 51)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g.id, operation: "DTF", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      fieldErrors: { designId: expect.any(Array) },
    });

    // Ready needs the explicit confirmation and can't pass the least-finished design.
    await expect(ready(d.id, g.id, 10)).rejects.toMatchObject({ fieldErrors: { confirmAllOperations: expect.any(Array) } });
    await expect(ready(d.id, g.id, 81, true)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await ready(d.id, g.id, 80, true);
    await recordDelivery(db, staff, { orderId: d.id, orderGroupId: g.id, quantity: "80", deliveredAt: TODAY, idempotencyKey: randomUUID() });
    p = (await getOrderProduction(db, owner, d.id))!;
    expect(p.totals).toMatchObject({ required: 200, ready: 80, delivered: 80 });

    // Both designs are DTF: removing the back design (with progress) is refused by the design guard.
    const cur = (await getOrderDetails(db, owner, d.id))!;
    await expect(updateOrder(db, owner, editOf(cur, { groups: [{ ...editOf(cur).groups[0]!, designs: [editOf(cur).groups[0]!.designs![0]!] }] } as never))).rejects.toMatchObject({ code: "CONFLICT" });

    // Recorded presses come only from worker output in presses.
    const worker = await createWorker(db, owner, { name: "يوسف", job: "DTF_PRINTING", dailyWage: "300", dailyTarget: "300", targetUnit: "PRESS" } as never);
    await recordWorkLog(db, staff, { workerId: worker.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: d.id, orderGroupId: g.id, workType: "DTF", unit: "PRESS", quantity: "310" } as never);
    const after = (await getOrderDetails(db, owner, d.id))!;
    expect(after.groups[0]!).toMatchObject({ plannedPresses: 600, recordedPresses: 310 });
    // A worker's DTF confirmation is ambiguous here (two DTF designs) → refused, nothing recorded.
    await expect(
      recordWorkLog(db, staff, { workerId: worker.id, idempotencyKey: randomUUID(), workDate: TODAY, orderId: d.id, orderGroupId: g.id, workType: "DTF", unit: "PIECE", quantity: "10", stageQuantity: "10" } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("a design on part of the item: ready is bounded by done + pieces that don't need it", async () => {
    const d = await newOrder({ groups: [{ name: "تيشيرت", quantity: "200", unitPrice: "40", designs: [design({ placements: ["CHEST"] }), design({ operation: "SCREEN_PRINT", placements: ["BACK"], quantity: "150" })] }] });
    const g = d.groups[0]!;
    await stage(d.id, g.id, g.designs[0]!.id, "DTF", 200);
    await stage(d.id, g.id, g.designs[1]!.id, "SCREEN_PRINT", 100);
    const p = (await getOrderProduction(db, owner, d.id))!;
    expect(p.groups[0]!.maxReady).toBe(150); // 100 back-printed + 50 that never get the back print
    await expect(ready(d.id, g.id, 151, true)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await ready(d.id, g.id, 150, true);
  });

  it("sized items: per-size work against a design, never more than the size", async () => {
    const d = await newOrder({
      sizesEnabled: true,
      groups: [{ name: "تيشيرت", quantity: "30", unitPrice: "10", sizes: [{ label: "M", quantity: "10" }, { label: "L", quantity: "20" }], designs: [design({ placements: ["CHEST"] })] }],
    });
    const g = d.groups[0]!;
    const sizeId = (l: string) => g.sizes.find((s) => s.label === l)!.id;
    await recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g.id, designId: g.designs[0]!.id, operation: "DTF", sizes: [{ sizeId: sizeId("M"), quantity: "10" }, { sizeId: sizeId("L"), quantity: "5" }], workDate: TODAY, alsoReady: true, idempotencyKey: randomUUID() } as never);
    await expect(
      recordStageProgress(db, staff, { orderId: d.id, orderGroupId: g.id, designId: g.designs[0]!.id, operation: "DTF", sizes: [{ sizeId: sizeId("M"), quantity: "1" }], workDate: TODAY, idempotencyKey: randomUUID() } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const p = (await getOrderProduction(db, owner, d.id))!;
    expect(p.groups[0]!.sizes.map((s) => [s.label, s.design[g.designs[0]!.id], s.ready])).toEqual([
      ["M", 10, 10],
      ["L", 5, 5],
    ]);
  });

  it("older order (one agreed total): unchanged on ordinary edits; owner-only conversion, confirmed when the total changes, audited", async () => {
    const legacy = await newOrder({ pricing: "order", totalPrice: "9000", quantity: "300", groups: [{ quantity: "200", operations: ["DTF"], plain: false }, { quantity: "100", operations: ["EMBROIDERY"], plain: false }] } as never);
    expect(legacy.pricing).toBe("ORDER_TOTAL");
    expect(legacy.groups.map((g) => [g.label, g.unitPrice])).toEqual([
      ["البند 1", null],
      ["البند 2", null],
    ]);
    // An ordinary edit keeps the agreed total exactly.
    await updateOrder(db, staff, editOf(legacy, { notes: "تعديل عادي" }));
    let d = (await getOrderDetails(db, owner, legacy.id))!;
    expect(d.totalPrice).toBe("9000.00");
    expect(d.pricing).toBe("ORDER_TOTAL");

    const withPrices = (a: string, b: string) => ({
      pricing: "items",
      groups: editOf(d).groups.map((g, i) => ({ ...g, name: i === 0 ? "DTF" : "تطريز", unitPrice: i === 0 ? a : b })),
    });
    await expect(updateOrder(db, staff, editOf(d, withPrices("30", "30") as never))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrder(db, owner, editOf(d, withPrices("30", "40") as never))).rejects.toMatchObject({ fieldErrors: { confirmPriceChange: expect.any(Array) } });
    // Same total (200 × 30 + 100 × 30 = 9000): no confirmation needed.
    await updateOrder(db, owner, editOf(d, withPrices("30", "30") as never));
    d = (await getOrderDetails(db, owner, legacy.id))!;
    expect(d).toMatchObject({ pricing: "PER_ITEM", totalPrice: "9000.00" });
    expect(await db.auditLog.count({ where: { action: "ORDER_PRICING_CONVERTED", entityId: legacy.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ORDER_PRICE_CHANGED", entityId: legacy.id } })).toBe(0);
    // Never back to a single total.
    await expect(updateOrder(db, owner, editOf(d, { pricing: "order", totalPrice: "9000" } as never))).rejects.toMatchObject({ code: "CONFLICT" });

    const other = await newOrder({ pricing: "order", totalPrice: "1000", quantity: "10", groups: [{ operations: ["DTF"], plain: false }] } as never);
    await updateOrder(db, owner, editOf(other, { pricing: "items", confirmPriceChange: true, groups: editOf(other).groups.map((g) => ({ ...g, name: "قطع", unitPrice: "120" })) } as never));
    expect((await getOrderDetails(db, owner, other.id))!.totalPrice).toBe("1200.00");
    expect(await db.auditLog.count({ where: { action: "ORDER_PRICE_CHANGED", entityId: other.id } })).toBe(1);
  });

  it("editing after payments and production keeps money and history safe", async () => {
    const d = await newOrder({ advance: "3000", groups: [{ name: "تيشيرت", quantity: "100", unitPrice: "50", designs: [design({ name: "صدر" }), design({ name: "ضهر", operation: "SCREEN_PRINT" })] }] });
    const g = d.groups[0]!;
    // Staff can't change prices; the owner can't go below what's paid.
    await expect(updateOrder(db, staff, editOf(d, { groups: editOf(d).groups.map((x) => ({ ...x, unitPrice: "45" })) } as never))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrder(db, owner, editOf(d, { groups: editOf(d).groups.map((x) => ({ ...x, unitPrice: "20" })) } as never))).rejects.toMatchObject({ fieldErrors: { totalPrice: expect.any(Array) } });

    await stage(d.id, g.id, g.designs[1]!.id, "SCREEN_PRINT", 40);
    const now = (await getOrderDetails(db, owner, d.id))!;
    const designs = editOf(now).groups[0]!.designs!;
    // Remove a design with progress → refused; change its operation → refused; cut below done → refused.
    // (Refused by the operation guard: removing the design would also remove its recorded screen print.)
    await expect(updateOrder(db, owner, editOf(now, { groups: [{ ...editOf(now).groups[0]!, designs: [designs[0]!] }] } as never))).rejects.toMatchObject({ code: expect.stringMatching(/VALIDATION_ERROR|CONFLICT/) });
    expect((await getOrderDetails(db, owner, d.id))!.groups[0]!.designs).toHaveLength(2);
    await expect(updateOrder(db, owner, editOf(now, { groups: [{ ...editOf(now).groups[0]!, designs: [designs[0]!, { ...designs[1]!, operation: "DTF" }] }] } as never))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateOrder(db, owner, editOf(now, { groups: [{ ...editOf(now).groups[0]!, designs: [designs[0]!, { ...designs[1]!, quantity: "39" }] }] } as never))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Renaming, adding a placement and a new design are fine; ids survive.
    await updateOrder(db, owner, editOf(now, { groups: [{ ...editOf(now).groups[0]!, name: "تيشيرت أبيض", designs: [{ ...designs[0]!, placements: ["CHEST", "BADGE"] }, designs[1]!, design({ name: "كم", placements: ["LEFT_SLEEVE"], quantity: "50" })] }] } as never));
    const after = (await getOrderDetails(db, owner, d.id))!;
    expect(after.groups[0]!.designs.map((x) => x.id).slice(0, 2)).toEqual(g.designs.map((x) => x.id));
    expect(after.groups[0]!).toMatchObject({ name: "تيشيرت أبيض", quantity: 100 });
    expect(after.totalPrice).toBe("5000.00");

    // An older item with item-level progress is never split into designs.
    const legacy = await newOrder({ pricing: "order", totalPrice: "500", quantity: "10", groups: [{ operations: ["DTF"], plain: false }] } as never);
    await recordStageProgress(db, staff, { orderId: legacy.id, orderGroupId: legacy.groups[0]!.id, operation: "DTF", quantity: "5", workDate: TODAY, idempotencyKey: randomUUID() });
    const l = (await getOrderDetails(db, owner, legacy.id))!;
    await expect(updateOrder(db, owner, editOf(l, { groups: [{ ...editOf(l).groups[0]!, operations: [], designs: [design()] }] } as never))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("remove order: owner only, untouched orders only, hidden everywhere, audited, restorable", async () => {
    const untouched = await newOrder({ groups: [{ name: "تجربة", quantity: "10", unitPrice: "100", designs: [design()] }] });
    const paid = await newOrder({ advance: "100", groups: [{ name: "حقيقي", quantity: "10", unitPrice: "100", designs: [design()] }] });

    await expect(archiveOrder(db, staff, { orderId: untouched.id, reason: "تجربة" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listOrders(db, staff, { status: "archived" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getArchiveCheck(db, owner, paid.id)).blockers).toEqual([{ kind: "payments", count: 1 }]);
    await expect(archiveOrder(db, owner, { orderId: paid.id, reason: "تجربة" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(archiveOrder(db, owner, { orderId: untouched.id, reason: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const before = (await getCustomerDetails(db, owner, untouched.customerId))!;
    await archiveOrder(db, owner, { orderId: untouched.id, reason: "أوردر تجربة" });
    // Twice is harmless.
    await archiveOrder(db, owner, { orderId: untouched.id, reason: "أوردر تجربة" });
    const audit = await db.auditLog.findMany({ where: { action: "ORDER_ARCHIVED", entityId: untouched.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ number: untouched.number, reason: "أوردر تجربة", totalPrice: "1000.00" });

    expect((await listOrders(db, owner, {})).items.map((o) => o.id)).not.toContain(untouched.id);
    expect((await listOrders(db, owner, { status: "archived" })).items.map((o) => o.id)).toEqual([untouched.id]);
    const after = (await getCustomerDetails(db, owner, untouched.customerId))!;
    expect(after.orders.map((o) => o.id)).not.toContain(untouched.id);
    expect(Number(after.totals.agreed)).toBe(Number(before.totals.agreed) - 1000);
    expect((await getReceivables(db, owner)).items.map((i) => i.orderId)).not.toContain(untouched.id);
    expect(await getOrderInvoiceData(db, owner, untouched.id)).toBeNull();
    // Nothing can be recorded on it.
    await expect(recordPayment(db, staff, { orderId: untouched.id, idempotencyKey: randomUUID(), amount: "10", paidAt: TODAY, method: "CASH" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateOrder(db, owner, editOf((await getOrderDetails(db, owner, untouched.id))!))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Still readable with who/why.
    expect((await getOrderDetails(db, owner, untouched.id))!.archived).toMatchObject({ reason: "أوردر تجربة" });

    await restoreOrder(db, owner, { orderId: untouched.id });
    expect((await listOrders(db, owner, {})).items.map((o) => o.id)).toContain(untouched.id);
    expect(await db.auditLog.count({ where: { action: "ORDER_RESTORED", entityId: untouched.id } })).toBe(1);
  });

  it("idempotent create: a retried submit returns the same order", async () => {
    const key = randomUUID();
    const payload = { idempotencyKey: key, customer: { mode: "new", name: "x" }, title: "t", productType: "p", material: "m", unit: "PIECE", pricing: "items", receivedDate: TODAY, deliveryDate: "2099-12-31", groups: [{ name: "a", quantity: "5", unitPrice: "3", designs: [design()] }] } as unknown as CreateOrderPayload;
    const [a, b] = await Promise.all([createOrder(db, staff, payload), createOrder(db, staff, payload)]);
    expect(a.orderId).toBe(b.orderId);
    expect(await db.order.count()).toBe(1);
    expect(await db.orderGroupDesign.count()).toBe(1);
  });
});
