import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { dateFromString, dateToString, todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import { createFirstOwnerAdmin } from "@/server/services/admin-bootstrap-service";
import type { Actor } from "@/server/services/actor";
import { recordOrderCost, voidOrderCost } from "@/server/services/cost-service";
import { recordDepartmentStage, setDepartmentMembership } from "@/server/services/department-service";
import { recordStageProgress } from "@/server/services/production-service";
import { amendCostEntry, closeOrderCosts, getCostWorkspace, listCostAlerts, recordCostEntries, recordCostEntry, removeDraftCost, reopenOrderCosts } from "@/server/services/cost-review-service";
import { getOrderContributions } from "@/server/services/reports-service";
import { getDepartmentsOverview } from "@/server/services/department-service";
import { getMaterialConsumption } from "@/server/services/material-report-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { payPayable } from "@/server/services/outgoing-payment-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import { recordDelivery, recordReady, voidDelivery } from "@/server/services/production-service";
import { getRollWidths, setRollWidth } from "@/server/services/product-preset-service";
import { listOverdueReceivables } from "@/server/services/receivables-alert-service";
import { createSupplier, getSupplierDetails } from "@/server/services/supplier-service";
import { createStaffAccount } from "@/server/services/staff-access-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

/** Order work kinds, linear-meter pricing, cost review, material reports, supplier payables, overdue alerts. */
const TODAY = todayDateString();
const daysAgo = (n: number) => dateToString(new Date(dateFromString(TODAY).getTime() - n * 86_400_000));
const OWNER = { name: "المالك", email: "owner@benuuprint.test", password: "owner-pass-123" };

describe.skipIf(!hasTestDatabase)("work kinds, costs, suppliers & overdue alerts (PostgreSQL)", () => {
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
    await createFirstOwnerAdmin(db, OWNER);
    owner = await db.user.findFirstOrThrow({ where: { role: "OWNER_ADMIN" }, select: { id: true, role: true, permissions: true } });
    staff = await createTestUser(db, "STAFF", undefined, ["orders:view", "orders:view-prices", "orders:create", "orders:edit", "customers:view", "costs:view", "costs:record", "payments:view", "payments:record"]);
  });

  const order = (groups: CreateOrderPayload["groups"], extra: Partial<CreateOrderPayload> = {}) =>
    createOrder(db, owner, { idempotencyKey: randomUUID(), customer: { mode: "new", name: "مطبعة النور" }, title: "شغل للغير", productType: "ورق DTF", pricing: "items", unit: "PIECE", groups, receivedDate: TODAY, deliveryDate: "2099-01-01", ...extra }, { visibility: "ALL_AUTHORIZED_STAFF" });
  const dtf = (variant: string, extra: Record<string, unknown> = {}) => ({ workKind: "DTF_PAPER", variant, name: `DTF ${variant}`, quantity: "10", unitPrice: "120", fileWidthCm: "50", fileLengthCm: "70", rollWidthCm: "60", copiesPerRow: "1", plain: true, designs: [], ...extra });

  // ─── Work kinds & linear meters ───

  it("prices DTF by the linear meter: 50×70 cm × 10 copies on a 60 cm roll at 120 = 7 m = 840 EGP; 80% and 100% are separate lines", async () => {
    const { orderId } = await order([dtf("WHITE_80"), dtf("WHITE_100", { quantity: "5", unitPrice: "150" })]);
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => [g.work.variant, g.work.billableLengthMm, g.lineTotal])).toEqual([
      ["WHITE_80", 7000, "840.00"],
      ["WHITE_100", 3500, "525.00"],
    ]);
    expect(d.money?.totalPrice).toBe("1365.00");
    expect(d.groups.map((g) => g.department?.name)).toEqual(["طباعة", "طباعة"]);
    expect(d.groups[0]!.work).toMatchObject({ workKind: "DTF_PAPER", pricingBasis: "LINEAR_METER", fileWidthMm: 500, fileLengthMm: 700, copiesPerRow: 1, rollWidthMm: 600 });
  });

  it("validates roll width and copies per row; never rotates or nests silently; rounds half up to the piaster", async () => {
    await expect(order([dtf("WHITE_80", { fileWidthCm: "65" })])).rejects.toMatchObject({ fieldErrors: { "groups.0.fileWidthCm": [expect.stringContaining("أكبر من عرض الرول")] } });
    await expect(order([dtf("WHITE_80", { fileWidthCm: "25", copiesPerRow: "3" })])).rejects.toMatchObject({ fieldErrors: { "groups.0.copiesPerRow": [expect.stringContaining("مش هيدخلوا")] } });
    // Two across a 60 cm roll: ceil(10 / 2) = 5 rows × 70 cm = 3.5 m.
    const two = await order([dtf("WHITE_80", { fileWidthCm: "25", copiesPerRow: "2" })]);
    expect((await getOrderDetails(db, owner, two.orderId))!.groups[0]).toMatchObject({ lineTotal: "420.00", work: { billableLengthMm: 3500 } });
    // 3 × 33.3 cm = 99.9 cm at 99.99/m = 99.89001 → 99.89
    const odd = await order([dtf("WHITE_80", { fileWidthCm: "30", fileLengthCm: "33.3", quantity: "3", unitPrice: "99.99" })]);
    expect((await getOrderDetails(db, owner, odd.orderId))!.groups[0]!.lineTotal).toBe("99.89");
    await expect(order([dtf("WHITE_80")], { pricing: "order", totalPrice: "100" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("supports vinyl variants with «أخرى», several printing methods, embroidery threads with colours, heat press without material, and raw materials", async () => {
    const { orderId } = await order([
      { workKind: "VINYL_PAPER", variant: "REFLECTIVE_GRAY", name: "فينيل عاكس", quantity: "4", unitPrice: "200", fileWidthCm: "40", fileLengthCm: "50", rollWidthCm: "50", plain: true, designs: [] },
      { workKind: "VINYL_PAPER", variant: "OTHER", variantText: "فينيل ذهبي", name: "فينيل ذهبي", quantity: "2", unitPrice: "250", fileWidthCm: "40", fileLengthCm: "50", rollWidthCm: "50", plain: true, designs: [] },
      { workKind: "PRINT_FOR_OTHERS", variant: "SUBLIMATION", name: "سبلميشن", quantity: "20", unitPrice: "15", plain: true, designs: [] },
      { workKind: "PRINT_FOR_OTHERS", variant: "SILK_SCREEN", name: "سلك", quantity: "30", unitPrice: "10", plain: true, designs: [] },
      { workKind: "EMBROIDERY_FOR_OTHERS", variant: "POLYESTER", threadColor: "ذهبي", name: "تطريز لوجو", quantity: "12", unitPrice: "25", plain: true, designs: [] },
      { workKind: "EMBROIDERY_FOR_OTHERS", variant: "COTTON", threadColor: "أسود", name: "تطريز اسم", quantity: "12", unitPrice: "20", plain: true, designs: [] },
      { workKind: "HEAT_PRESS_FOR_OTHERS", name: "كبس", quantity: "100", unitPrice: "3", plain: true, designs: [] },
      { workKind: "RAW_MATERIALS", name: "حبر أبيض", saleUnit: "LITER", quantity: "2", unitPrice: "450", plain: true, designs: [] },
    ]);
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => g.lineTotal)).toEqual(["400.00", "250.00", "300.00", "300.00", "300.00", "240.00", "300.00", "900.00"]);
    expect(d.money?.totalPrice).toBe("2990.00");
    expect(d.groups.map((g) => g.department?.name)).toEqual(["طباعة", "طباعة", "طباعة", "طباعة", "تطريز", "تطريز", "طباعة", "طباعة"]);
    expect(d.groups[1]!.work).toMatchObject({ variant: "OTHER", variantText: "فينيل ذهبي" });
    expect(d.groups[4]!.work).toMatchObject({ variant: "POLYESTER", threadColor: "ذهبي" });
    expect(d.groups[6]!.material).toBe("");
    expect(d.groups[7]!.work.saleUnit).toBe("LITER");

    // Required per kind: variant, «أخرى» text, raw material unit; no designs on work-kind lines.
    await expect(order([{ workKind: "VINYL_PAPER", name: "x", quantity: "1", unitPrice: "1", fileWidthCm: "10", fileLengthCm: "10", rollWidthCm: "50", plain: true, designs: [] }])).rejects.toMatchObject({ fieldErrors: { "groups.0.variant": ["اختار نوع الفينيل"] } });
    await expect(order([{ workKind: "VINYL_PAPER", variant: "OTHER", name: "x", quantity: "1", unitPrice: "1", fileWidthCm: "10", fileLengthCm: "10", rollWidthCm: "50", plain: true, designs: [] }])).rejects.toMatchObject({ fieldErrors: { "groups.0.variantText": ["اكتب النوع"] } });
    await expect(order([{ workKind: "RAW_MATERIALS", name: "حبر", quantity: "1", unitPrice: "1", plain: true, designs: [] }])).rejects.toMatchObject({ fieldErrors: { "groups.0.saleUnit": ["اختار الوحدة"] } });
    await expect(order([{ workKind: "HEAT_PRESS_FOR_OTHERS", name: "كبس", quantity: "1", unitPrice: "1", designs: [{ operation: "DTF" }] }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(order([{ workKind: "NOT_A_KIND", name: "x", quantity: "1", unitPrice: "1", plain: true, designs: [] }])).rejects.toMatchObject({ fieldErrors: { "groups.0.workKind": ["نوع الشغل مش معروف"] } });
  });

  it("keeps garment orders and payments exactly as before; edits recompute linear totals and keep department money balanced", async () => {
    const garment = await order([{ name: "تيشيرت", quantity: "10", unitPrice: "100", designs: [{ operation: "DTF" }] }], { productType: "تيشيرت" });
    const g = (await getOrderDetails(db, owner, garment.orderId))!;
    expect(g.groups[0]).toMatchObject({ lineTotal: "1000.00", work: { workKind: null, pricingBasis: "UNIT" } });

    const { orderId } = await order([dtf("WHITE_80")], { advance: "500", advancePaidAt: TODAY });
    const d = (await getOrderDetails(db, owner, orderId))!;
    const item = d.groups[0]!;
    await updateOrder(db, owner, {
      orderId, customer: { mode: "existing", id: d.customerId }, title: d.title, productType: d.productType, pricing: "items", unit: d.unit,
      receivedDate: d.receivedDate, deliveryDate: d.deliveryDate, status: "NEW",
      groups: [{ ...dtf("WHITE_80", { quantity: "20" }), id: item.id, departmentId: item.department!.id }],
    });
    const after = (await getOrderDetails(db, owner, orderId))!;
    expect(after.money).toEqual({ totalPrice: "1680.00", paid: "500.00", outstanding: "1180.00" });
    expect((await getDepartmentsOverview(db, owner)).totals).toMatchObject({ valueBalanced: true, collectionsBalanced: true });
  });

  it("stores the owner's roll width per work kind (no width is assumed)", async () => {
    expect(await getRollWidths(db)).toEqual({});
    await setRollWidth(db, owner, { workKind: "DTF_PAPER", rollWidthCm: "60" });
    expect(await getRollWidths(db)).toEqual({ DTF_PAPER: 600 });
    await expect(setRollWidth(db, owner, { workKind: "HEAT_PRESS_FOR_OTHERS", rollWidthCm: "60" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(setRollWidth(db, staff, { workKind: "DTF_PAPER", rollWidthCm: "50" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ─── Cost review ───

  it("tracks every new order as pending, alerts until closed, and requires an explicit zero-cost confirmation", async () => {
    const a = await order([dtf("WHITE_80")]);
    const b = await order([dtf("WHITE_100")], { title: "طلب صفر تكلفة" });
    let alerts = await listCostAlerts(db, staff);
    expect(alerts.items.map((x) => [x.number, x.costStatus])).toEqual([[1, "PENDING"], [2, "PENDING"]]);
    expect(alerts.counts).toMatchObject({ PENDING: 2 });

    const ws = (await getCostWorkspace(db, owner, b.orderId))!;
    await expect(closeOrderCosts(db, owner, { orderId: b.orderId, expectedVersion: ws.order.costVersion })).rejects.toMatchObject({ fieldErrors: { confirmZero: [expect.any(String)] } });
    await expect(closeOrderCosts(db, staff, { orderId: b.orderId, expectedVersion: ws.order.costVersion, confirmZero: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await closeOrderCosts(db, owner, { orderId: b.orderId, expectedVersion: ws.order.costVersion, confirmZero: true });
    alerts = await listCostAlerts(db, staff);
    expect(alerts.items.map((x) => x.orderId)).toEqual([a.orderId]);
    expect(alerts.counts).toMatchObject({ PENDING: 1, CLOSED: 1 });
    expect(await db.auditLog.findFirst({ where: { action: "COST_REVIEW_CLOSED", entityId: b.orderId } })).toMatchObject({ metadata: expect.objectContaining({ zeroConfirmed: true }) });
  });

  it("closes costs: drafts become supplier payables once (not payments), with the chosen existing supplier; double submits post nothing twice", async () => {
    const supplier = await createSupplier(db, owner, { name: "مورد ورق DTF" });
    const other = await createSupplier(db, owner, { name: "مورد حبر" });
    const { orderId } = await order([dtf("WHITE_80")]);
    const item = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    const entry = (extra: Record<string, unknown>) => recordCostEntry(db, staff, { orderId, idempotencyKey: randomUUID(), orderGroupId: item.id, category: "MATERIALS", materialName: "ورق DTF", materialVariant: "أبيض 80%", usageQuantity: "7.4", usageUnit: "LINEAR_METER", usageUnitCost: "45", costDate: TODAY, ...extra });

    const key = randomUUID();
    const first = await entry({ idempotencyKey: key, supplierId: supplier.id });
    expect(await entry({ idempotencyKey: key, supplierId: supplier.id })).toEqual({ costId: first.costId, created: false }); // double submit
    await entry({ materialName: "حبر أبيض", materialVariant: undefined, usageQuantity: "0.25", usageUnit: "LITER", usageUnitCost: "900" });
    await expect(entry({ usageQuantity: "2", usageUnitCost: "10", amount: "25" })).rejects.toMatchObject({ fieldErrors: { amount: [expect.stringContaining("الكمية × تكلفة الوحدة")] } });

    let ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.order.costStatus).toBe("IN_PROGRESS");
    expect(ws.totals).toEqual({ posted: "0.00", draft: "558.00", paid: "0.00" }); // 7.4 × 45 = 333 ; 0.25 × 900 = 225
    // Drafts aren't payables yet.
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "0.00" });
    await expect(payPayable(db, owner, "cost", { targetId: first.costId, idempotencyKey: randomUUID(), amount: "1", paidAt: TODAY, method: "CASH" })).rejects.toMatchObject({ code: "CONFLICT" });

    // The supplier must be named for every draft (an existing one, or explicitly none).
    const ink = ws.entries.find((e) => e.materialName === "حبر أبيض")!;
    await expect(closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion })).rejects.toMatchObject({ fieldErrors: { [`suppliers.${ink.id}`]: ["اختار المورد"] } });
    await expect(closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion - 1, suppliers: { [ink.id]: other.id } })).rejects.toMatchObject({ code: "CONFLICT" });
    const close = { orderId, expectedVersion: ws.order.costVersion, suppliers: { [ink.id]: other.id } };
    expect(await closeOrderCosts(db, owner, close)).toEqual({ changed: true, posted: 2 });
    expect(await closeOrderCosts(db, owner, close)).toEqual({ changed: false, posted: 0 });

    ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.order.costStatus).toBe("CLOSED");
    expect(ws.totals).toEqual({ posted: "558.00", draft: "0.00", paid: "0.00" });
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "333.00", paid: "0.00", outstanding: "333.00" });
    expect((await getSupplierDetails(db, owner, other.id))!.totals).toMatchObject({ purchased: "225.00", outstanding: "225.00" });
    expect(await db.outgoingPayment.count()).toBe(0); // closing never pays
    // A closed order refuses new entries from both flows.
    await expect(entry({})).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "OTHER", amount: "10", costDate: TODAY, payStatus: "CREDIT" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("amends closed costs with a reason: payable moves by the difference, payments stay, history is kept, stale versions are refused", async () => {
    const supplier = await createSupplier(db, owner, { name: "مورد ورق" });
    const other = await createSupplier(db, owner, { name: "مورد تاني" });
    const { orderId } = await order([dtf("WHITE_80")]);
    const { costId } = await recordCostEntry(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", materialName: "ورق DTF", usageQuantity: "10", usageUnit: "LINEAR_METER", usageUnitCost: "40", costDate: TODAY, supplierId: supplier.id });
    const ws = (await getCostWorkspace(db, owner, orderId))!;
    await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion });
    await payPayable(db, owner, "cost", { targetId: costId, idempotencyKey: randomUUID(), amount: "150", paidAt: TODAY, method: "CASH" });

    await expect(amendCostEntry(db, owner, { costId, expectedVersion: 0, usageQuantity: "8" })).rejects.toMatchObject({ fieldErrors: { reason: ["اكتب سبب التعديل"] } });
    await expect(amendCostEntry(db, staff, { costId, expectedVersion: 0, usageQuantity: "8", reason: "غلط" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(amendCostEntry(db, owner, { costId, expectedVersion: 0, usageQuantity: "3", reason: "تصحيح" })).rejects.toMatchObject({ fieldErrors: { amount: [expect.stringContaining("مينفعش يقل")] } }); // 120 < 150 paid
    await expect(amendCostEntry(db, owner, { costId, expectedVersion: 0, supplierId: other.id, reason: "مورد غلط" })).rejects.toMatchObject({ fieldErrors: { supplierId: [expect.any(String)] } });

    expect(await amendCostEntry(db, owner, { costId, expectedVersion: 0, usageQuantity: "8.5", reason: "الهالك أقل من المتسجل" })).toEqual({ changed: true, version: 1 });
    await expect(amendCostEntry(db, owner, { costId, expectedVersion: 0, usageQuantity: "9", reason: "تاني" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "340.00", paid: "150.00", outstanding: "190.00" });
    const rev = await db.orderCostRevision.findFirstOrThrow({ where: { orderCostId: costId } });
    expect(rev).toMatchObject({ version: 1, reason: "الهالك أقل من المتسجل", before: expect.objectContaining({ amount: "400.00", usageQuantity: "10" }), after: expect.objectContaining({ amount: "340.00", usageQuantity: "8.5" }) });
    expect(await db.auditLog.count({ where: { action: "ORDER_COST_AMENDED", entityId: costId } })).toBe(1);
    expect(await db.orderCost.count()).toBe(1); // amended in place — no duplicated liability
  });

  it("reopens closed costs, and flags «needs review» when a closed order changes", async () => {
    const { orderId } = await order([dtf("WHITE_80")]);
    let ws = (await getCostWorkspace(db, owner, orderId))!;
    await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion, confirmZero: true });
    const d = (await getOrderDetails(db, owner, orderId))!;
    await updateOrder(db, owner, {
      orderId, customer: { mode: "existing", id: d.customerId }, title: d.title, productType: d.productType, pricing: "items", unit: d.unit,
      receivedDate: d.receivedDate, deliveryDate: d.deliveryDate, status: "NEW",
      groups: [{ ...dtf("WHITE_80", { quantity: "12" }), id: d.groups[0]!.id, departmentId: d.groups[0]!.department!.id }],
    });
    ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.order.costStatus).toBe("NEEDS_REVIEW");
    expect((await listCostAlerts(db, owner)).items.map((x) => x.costStatus)).toEqual(["NEEDS_REVIEW"]);
    await expect(reopenOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion, reason: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await reopenOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion, reason: "زودنا الكمية" });
    expect((await getCostWorkspace(db, owner, orderId))!.order.costStatus).toBe("IN_PROGRESS");
    expect(await db.auditLog.count({ where: { action: { in: ["COST_REVIEW_NEEDS_REVIEW", "COST_REVIEW_REOPENED"] }, entityId: orderId } })).toBe(2);
  });

  // ─── Material consumption ───

  it("reports material consumption by consumption date, per material/variant/unit/supplier, never mixing units, with contributing orders", async () => {
    const s1 = await createSupplier(db, owner, { name: "مورد DTF" });
    const s2 = await createSupplier(db, owner, { name: "مورد فينيل" });
    const a = await order([dtf("WHITE_80")]);
    const b = await order([{ workKind: "VINYL_PAPER", variant: "BLACK", name: "فينيل أسود", quantity: "4", unitPrice: "200", fileWidthCm: "40", fileLengthCm: "50", rollWidthCm: "50", plain: true, designs: [] }], { productType: "ورق فينيل" });
    const use = (orderId: string, extra: Record<string, unknown>) => recordCostEntry(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", costDate: TODAY, ...extra });
    await use(a.orderId, { materialName: "ورق DTF", materialVariant: "أبيض 80%", usageQuantity: "7.4", usageUnit: "LINEAR_METER", usageUnitCost: "45", supplierId: s1.id, costDate: daysAgo(40) });
    await use(a.orderId, { materialName: "ورق DTF", materialVariant: "أبيض 80%", usageQuantity: "3", usageUnit: "LINEAR_METER", usageUnitCost: "45", supplierId: s1.id, costDate: daysAgo(5) });
    await use(b.orderId, { materialName: "ورق DTF", materialVariant: "أبيض 80%", usageQuantity: "2", usageUnit: "LINEAR_METER", usageUnitCost: "50", supplierId: s1.id, costDate: daysAgo(3) });
    await use(a.orderId, { materialName: "ورق DTF", materialVariant: "أبيض 80%", usageQuantity: "1", usageUnit: "ROLL", usageUnitCost: "2000", supplierId: s1.id, costDate: daysAgo(2) }); // other unit
    await use(b.orderId, { materialName: "فينيل أسود", usageQuantity: "2.25", usageUnit: "LINEAR_METER", usageUnitCost: "80", supplierId: s2.id, costDate: daysAgo(1) });

    const r = await getMaterialConsumption(db, owner, { from: daysAgo(10), to: TODAY });
    const byKey = r.rows.map((x) => [x.materialName, x.materialVariant, x.unit, x.supplier?.name, x.quantity, x.total]);
    expect(byKey).toEqual([
      ["فينيل أسود", null, "LINEAR_METER", "مورد فينيل", "2.25", "180.00"],
      ["ورق DTF", "أبيض 80%", "LINEAR_METER", "مورد DTF", "5", "235.00"], // 40-days-ago entry is outside the period
      ["ورق DTF", "أبيض 80%", "ROLL", "مورد DTF", "1", "2000.00"],
    ]);
    const dtfRow = r.rows.find((x) => x.unit === "LINEAR_METER" && x.materialName === "ورق DTF")!;
    // Every entry here is still a draft (costs not closed): reported as such, per row and per order.
    expect(dtfRow.draftTotal).toBe(dtfRow.total);
    expect(dtfRow.orders.every((o) => o.draftTotal === o.total)).toBe(true);
    expect(dtfRow.orders.map((o) => [o.number, o.quantity])).toEqual([[1, "3"], [2, "2"]]);
    expect(dtfRow.unitCosts).toEqual(["45.00", "50.00"]);
    expect(r.totals).toEqual({ entries: 4, total: "2415.00" });

    expect((await getMaterialConsumption(db, owner, { from: daysAgo(60), to: TODAY, supplierId: s2.id })).rows).toHaveLength(1);
    // Order b only has vinyl work, so its order-level entries are classified as vinyl (never guessed for mixed orders).
    expect((await getMaterialConsumption(db, owner, { from: daysAgo(60), to: TODAY, workKind: "VINYL_PAPER" })).totals.entries).toBe(2);
    expect((await getMaterialConsumption(db, owner, { from: daysAgo(60), to: TODAY, orderId: a.orderId })).totals.entries).toBe(3);
    expect((await getMaterialConsumption(db, owner, { from: daysAgo(60), to: TODAY, material: "فينيل" })).totals.total).toBe("180.00");
    await expect(getMaterialConsumption(db, owner, { from: TODAY, to: daysAgo(1) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // An amended entry counts with its corrected values.
    const entry = await db.orderCost.findFirstOrThrow({ where: { materialName: "فينيل أسود" }, select: { id: true } });
    await amendCostEntry(db, owner, { costId: entry.id, expectedVersion: 0, usageQuantity: "2" });
    expect((await getMaterialConsumption(db, owner, { from: daysAgo(10), to: TODAY, material: "فينيل" })).rows[0]).toMatchObject({ quantity: "2", total: "160.00" });
  });

  // ─── Overdue receivables ───

  it("alerts 10 calendar days after FULL delivery while money remains; partial delivery, payment and corrections behave", async () => {
    const { orderId } = await order([{ workKind: "HEAT_PRESS_FOR_OTHERS", name: "كبس", quantity: "10", unitPrice: "100", plain: true, designs: [] }], { receivedDate: daysAgo(30), deliveryDate: daysAgo(20), advance: "200", advancePaidAt: daysAgo(30) });
    const g = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    await recordReady(db, owner, { orderId, orderGroupId: g.id, quantity: "10", readyDate: daysAgo(15), idempotencyKey: randomUUID() });
    await recordDelivery(db, owner, { orderId, orderGroupId: g.id, quantity: "4", deliveredAt: daysAgo(14), idempotencyKey: randomUUID() });
    expect(await listOverdueReceivables(db, owner)).toEqual([]); // partial delivery never starts the countdown

    const last = await recordDelivery(db, owner, { orderId, orderGroupId: g.id, quantity: "6", deliveredAt: daysAgo(10), idempotencyKey: randomUUID() });
    expect(await listOverdueReceivables(db, owner)).toEqual([
      { orderId, number: 1, title: "شغل للغير", customerName: "مطبعة النور", fullDeliveryDate: daysAgo(10), daysSinceDelivery: 10, total: "1000.00", collected: "200.00", remaining: "800.00" },
    ]);
    // Day 9 isn't overdue yet.
    expect(await listOverdueReceivables(db, owner, new Date(dateFromString(TODAY).getTime() - 86_400_000 + 12 * 3600_000))).toEqual([]);

    const part = await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "300", paidAt: TODAY, method: "CASH" });
    expect((await listOverdueReceivables(db, owner))[0]).toMatchObject({ collected: "500.00", remaining: "500.00" });
    const rest = await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "500", paidAt: TODAY, method: "CASH" });
    expect(await listOverdueReceivables(db, owner)).toEqual([]); // settled
    await voidPayment(db, owner, { paymentId: rest.paymentId, reason: "اتسجلت غلط" });
    expect((await listOverdueReceivables(db, owner))[0]!.remaining).toBe("500.00");
    void part;

    // Voiding the last delivery reverts completion → no alert.
    await voidDelivery(db, owner, { id: last.id, reason: "اتسجل غلط" });
    expect(await listOverdueReceivables(db, owner)).toEqual([]);
    expect(await db.auditLog.count({ where: { action: { contains: "REMIND" } } })).toBe(0);
  });

  it("guards customer balances and cost data: staff without prices/payments, and partners, are refused", async () => {
    const noMoney = await createTestUser(db, "STAFF", undefined, ["orders:view"]);
    await expect(listOverdueReceivables(db, noMoney)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { userId } = await createStaffAccount(db, owner, { name: "شريك", email: "p@benuuprint.test", password: "partner-pass-123", ownerPassword: OWNER.password, kind: "PARTNER" });
    const partner = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, permissions: true } });
    await expect(listOverdueReceivables(db, partner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCostAlerts(db, partner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMaterialConsumption(db, partner, { from: TODAY, to: TODAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { orderId } = await order([dtf("WHITE_80")]);
    await expect(recordCostEntry(db, partner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", amount: "1", costDate: TODAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Staff see alerts only for orders they may see.
    const hidden = await createOrder(db, owner, { idempotencyKey: randomUUID(), customer: { mode: "new", name: "خاص" }, title: "خاص", productType: "x", pricing: "items", unit: "PIECE", groups: [dtf("WHITE_80")], receivedDate: TODAY, deliveryDate: "2099-01-01" });
    expect((await listCostAlerts(db, staff)).items.map((x) => x.orderId)).not.toContain(hidden.orderId);
  });

  // ─── Release fixes ───

  it("legacy orders (no cost status) show as «needs review», close as reviewed without re-booking their costs", async () => {
    const supplier = await createSupplier(db, owner, { name: "مورد قديم" });
    const { orderId } = await order([dtf("WHITE_80")]);
    await recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", amount: "250", costDate: TODAY, supplier: { mode: "existing", id: supplier.id }, payStatus: "CREDIT" });
    const zero = await order([dtf("WHITE_100")], { title: "قديم بدون تكاليف" });
    // Simulate orders created before cost tracking.
    await db.order.updateMany({ data: { costStatus: null } });

    const alerts = await listCostAlerts(db, owner);
    expect(alerts.items.map((a) => a.costStatus)).toEqual(["LEGACY", "LEGACY"]);
    expect(alerts.counts.LEGACY).toBe(2);
    expect((await listCostAlerts(db, owner, { status: "LEGACY" })).items).toHaveLength(2);

    const ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.order.costStatus).toBeNull();
    expect(await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion })).toEqual({ changed: true, posted: 0 });
    expect(await db.orderCost.count({ where: { orderId } })).toBe(1);
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "250.00", outstanding: "250.00" });

    const zws = (await getCostWorkspace(db, owner, zero.orderId))!;
    await expect(closeOrderCosts(db, owner, { orderId: zero.orderId, expectedVersion: zws.order.costVersion })).rejects.toMatchObject({ fieldErrors: { confirmZero: [expect.any(String)] } });
    await closeOrderCosts(db, owner, { orderId: zero.orderId, expectedVersion: zws.order.costVersion, confirmZero: true });
    expect((await listCostAlerts(db, owner)).items).toEqual([]);
  });

  it("both cost flows share one booking path: explicit booking state, same closed-cost guard, voids reopen review", async () => {
    const supplier = await createSupplier(db, owner, { name: "مورد" });
    const { orderId } = await order([dtf("WHITE_80")]);
    const booked = await recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", amount: "100", costDate: TODAY, supplier: { mode: "existing", id: supplier.id }, payStatus: "CREDIT" });
    const draft = await recordCostEntry(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", amount: "40", costDate: TODAY, supplierId: supplier.id });
    const rows = await db.orderCost.findMany({ where: { orderId }, orderBy: { createdAt: "asc" }, select: { id: true, isDraft: true, postedAt: true } });
    expect(rows.map((r) => [r.id, r.isDraft, r.postedAt !== null])).toEqual([[booked.costId, false, true], [draft.costId, true, false]]);
    // The database refuses a "booked" cost without a booking time, and a draft with one.
    await expect(db.orderCost.update({ where: { id: booked.costId }, data: { postedAt: null } })).rejects.toThrow();
    await expect(db.orderCost.update({ where: { id: draft.costId }, data: { postedAt: new Date() } })).rejects.toThrow();

    const ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.order.costStatus).toBe("IN_PROGRESS");
    await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion });
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "140.00" }); // each booked once
    await expect(recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "OTHER", amount: "5", costDate: TODAY, payStatus: "CREDIT" })).rejects.toMatchObject({ code: "CONFLICT" });
    await voidOrderCost(db, owner, { id: booked.costId, reason: "اتسجلت غلط" });
    expect((await getCostWorkspace(db, owner, orderId))!.order.costStatus).toBe("NEEDS_REVIEW");
    expect((await getSupplierDetails(db, owner, supplier.id))!.totals).toMatchObject({ purchased: "40.00" });
  });

  it("classifies report entries by line, by single-kind order, else as unclassified — never guessed", async () => {
    const single = await order([dtf("WHITE_80")]);
    const mixed = await order([dtf("WHITE_80"), { workKind: "HEAT_PRESS_FOR_OTHERS", name: "كبس", quantity: "5", unitPrice: "3", plain: true, designs: [] }], { title: "مختلط" });
    const garment = await order([{ name: "تيشيرت", quantity: "5", unitPrice: "100", designs: [{ operation: "DTF" }] }], { title: "ملابس", productType: "تيشيرت" });
    const mixedLine = (await getOrderDetails(db, owner, mixed.orderId))!.groups[0]!;
    const use = (orderId: string, extra: Record<string, unknown> = {}) => recordCostEntry(db, owner, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", materialName: "ورق DTF", usageQuantity: "1", usageUnit: "LINEAR_METER", usageUnitCost: "10", costDate: TODAY, ...extra });
    await use(single.orderId); // order-level, one kind → DTF
    await use(mixed.orderId); // order-level, two kinds → unclassified
    await use(mixed.orderId, { orderGroupId: mixedLine.id }); // line-level → DTF
    await use(garment.orderId); // order-level, garment only → GARMENT
    const q = (workKind?: string) => getMaterialConsumption(db, owner, { from: TODAY, to: TODAY, workKind });
    expect((await q("DTF_PAPER")).totals.entries).toBe(2);
    expect((await q("UNCLASSIFIED")).totals.entries).toBe(1);
    expect((await q("GARMENT")).totals.entries).toBe(1);
    expect((await q()).rows[0]!.workKinds).toEqual(["DTF_PAPER", "GARMENT", "UNCLASSIFIED"]);
  });

  it("printing / embroidery for others go through production steps (department partners can record them); paper and material sales stay simple", async () => {
    const { orderId } = await order([
      { workKind: "PRINT_FOR_OTHERS", variant: "SUBLIMATION", name: "سبلميشن", quantity: "20", unitPrice: "15", plain: true, designs: [] },
      { workKind: "EMBROIDERY_FOR_OTHERS", variant: "COTTON", threadColor: "أسود", name: "تطريز", quantity: "10", unitPrice: "20", plain: true, designs: [] },
      dtf("WHITE_80"),
    ]);
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => g.operations)).toEqual([["SUBLIMATION"], ["EMBROIDERY"], []]);
    const [print, emb, paper] = d.groups;
    // Not a ready-made sale: «جاهز» needs the production step first.
    await expect(recordReady(db, owner, { orderId, orderGroupId: print!.id, quantity: "1", readyDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await recordStageProgress(db, owner, { orderId, orderGroupId: print!.id, operation: "SUBLIMATION", quantity: "20", workDate: TODAY, idempotencyKey: randomUUID(), alsoReady: true });
    // Paper goes straight to ready.
    await recordReady(db, owner, { orderId, orderGroupId: paper!.id, quantity: "10", readyDate: TODAY, idempotencyKey: randomUUID() });
    // An embroidery partner records its step on its own line.
    const { userId } = await createStaffAccount(db, owner, { name: "ورشة", email: "emb@benuuprint.test", password: "partner-pass-123", ownerPassword: OWNER.password, kind: "PARTNER" });
    const partner = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, permissions: true } });
    await setDepartmentMembership(db, owner, { userId, departmentId: emb!.department!.id, canViewWork: true, canViewMoney: false, canRecordProduction: true });
    await recordDepartmentStage(db, partner, emb!.department!.id, { orderId, orderGroupId: emb!.id, operation: "EMBROIDERY", quantity: "10", workDate: TODAY, idempotencyKey: randomUUID() });
    await expect(recordDepartmentStage(db, partner, emb!.department!.id, { orderId, orderGroupId: print!.id, operation: "SUBLIMATION", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await getOrderDetails(db, owner, orderId))!.status).toBe("IN_PROGRESS");
  });

  it("sells raw materials in decimal quantities (1.5 m, 2.75 kg) with exact totals; countable units stay whole", async () => {
    const raw = (quantity: string, saleUnit: string, unitPrice: string) => ({ workKind: "RAW_MATERIALS", name: "خامة", saleUnit, quantity, unitPrice, plain: true, designs: [] });
    const { orderId } = await order([raw("2.75", "KG", "120"), raw("1.5", "METER", "33.33"), raw("4", "ROLL", "500")], { advance: "100", advancePaidAt: TODAY });
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => [g.work.pricingBasis, g.work.measuredQuantity, g.quantity, g.lineTotal])).toEqual([
      ["MEASURED", "2.75", 1, "330.00"],
      ["MEASURED", "1.5", 1, "50.00"], // 1.5 × 33.33 = 49.995 → 50.00
      ["UNIT", null, 4, "2000.00"],
    ]);
    expect(d.money).toEqual({ totalPrice: "2380.00", paid: "100.00", outstanding: "2280.00" });
    await expect(order([raw("1.5", "ROLL", "10")])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(order([raw("1.2345", "KG", "10")])).rejects.toMatchObject({ fieldErrors: { "groups.0.quantity": [expect.stringContaining("3 أرقام")] } });
    // Editing keeps the decimal quantity; departments still reconcile.
    const g0 = d.groups[0]!;
    await updateOrder(db, owner, {
      orderId, customer: { mode: "existing", id: d.customerId }, title: d.title, productType: d.productType, pricing: "items", unit: d.unit, receivedDate: d.receivedDate, deliveryDate: d.deliveryDate, status: "NEW",
      groups: d.groups.map((g, i) => ({ id: g.id, ...raw(i === 0 ? "3.125" : i === 1 ? "1.5" : "4", g.work.saleUnit!, i === 0 ? "120" : i === 1 ? "33.33" : "500"), departmentId: g.department!.id })),
    });
    expect((await getOrderDetails(db, owner, orderId))!.groups[0]).toMatchObject({ id: g0.id, lineTotal: "375.00", work: { measuredQuantity: "3.125" } });
    expect((await getDepartmentsOverview(db, owner)).totals).toMatchObject({ valueBalanced: true, collectionsBalanced: true });
  });

  // ─── Multiple cost rows per order ───

  it("holds many independent cost rows on ONE order (Emma Tourism: 1,200 + 500 + 300 + 150 = 2,150), each with its own supplier", async () => {
    const dtfSupplier = await createSupplier(db, owner, { name: "مورد DTF" });
    const embroiderer = await createSupplier(db, owner, { name: "ورشة تطريز" });
    const driver = await createSupplier(db, owner, { name: "نقل" });
    const { orderId } = await order([dtf("WHITE_80")], { title: "Emma Tourism" });
    const row = (extra: Record<string, unknown>) => ({ idempotencyKey: randomUUID(), costDate: TODAY, ...extra });
    const rows = [
      row({ category: "MATERIALS", description: "خامات DTF", materialName: "ورق DTF", usageQuantity: "10", usageUnit: "LINEAR_METER", usageUnitCost: "120", supplierId: dtfSupplier.id }),
      row({ category: "EMBROIDERY", description: "تطريز", amount: "500", supplierId: embroiderer.id }),
      row({ category: "OUTSOURCED_LABOR", description: "مصنعية", amount: "300" }),
      row({ category: "TRANSPORT", description: "نقل", amount: "150", supplierId: driver.id }),
    ];
    const first = await recordCostEntries(db, staff, { orderId, entries: rows });
    expect(first.entries.map((e) => e.created)).toEqual([true, true, true, true]);
    // A repeated submit of the same rows creates nothing new.
    const again = await recordCostEntries(db, staff, { orderId, entries: rows });
    expect(again.entries.map((e) => [e.costId, e.created])).toEqual(first.entries.map((e) => [e.costId, false]));
    expect(await db.orderCost.count({ where: { orderId } })).toBe(4);
    expect(await db.order.count()).toBe(1); // one order, four rows

    // More rows can be added later, and a draft row removed on its own.
    const extra = await recordCostEntries(db, staff, { orderId, entries: [row({ category: "OTHER", amount: "99" })] });
    await removeDraftCost(db, staff, { costId: extra.entries[0]!.costId });
    let ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.entries.filter((e) => !e.voided).map((e) => e.amount)).toEqual(["1200.00", "500.00", "300.00", "150.00"]);
    expect(ws.totals).toEqual({ posted: "0.00", draft: "2150.00", paid: "0.00" });

    // Errors come back per row; nothing is saved when any row is invalid.
    await expect(recordCostEntries(db, staff, { orderId, entries: [row({ category: "OTHER", amount: "10" }), row({ category: "OTHER", usageQuantity: "2", usageUnit: "KG", usageUnitCost: "5", amount: "11" })] })).rejects.toMatchObject({
      fieldErrors: { "entries.1.amount": [expect.stringContaining("الكمية × تكلفة الوحدة")] },
    });
    expect(await db.orderCost.count({ where: { orderId, voidedAt: null } })).toBe(4);

    // Close: each row booked once to its own supplier (or none) — never paid.
    const labor = ws.entries.find((e) => e.amount === "300.00")!;
    await closeOrderCosts(db, owner, { orderId, expectedVersion: ws.order.costVersion, suppliers: { [labor.id]: "none" } });
    ws = (await getCostWorkspace(db, owner, orderId))!;
    expect(ws.totals).toEqual({ posted: "2150.00", draft: "0.00", paid: "0.00" });
    expect((await getSupplierDetails(db, owner, dtfSupplier.id))!.totals).toMatchObject({ purchased: "1200.00", paid: "0.00", outstanding: "1200.00" });
    expect((await getSupplierDetails(db, owner, embroiderer.id))!.totals).toMatchObject({ purchased: "500.00" });
    expect((await getSupplierDetails(db, owner, driver.id))!.totals).toMatchObject({ purchased: "150.00" });
    expect(await db.outgoingPayment.count()).toBe(0);
    // Profitability sees every booked row exactly once.
    const [contribution] = await getOrderContributions(db, owner, { orderIds: [orderId] });
    expect(contribution).toMatchObject({ materials: "1200.00", outside: "800.00", otherCosts: "150.00" });
    // Material usage shows the material row.
    expect((await getMaterialConsumption(db, owner, { from: TODAY, to: TODAY })).rows.map((r) => [r.materialName, r.quantity, r.total, r.draftTotal, r.orders[0]!.draftTotal])).toEqual([["ورق DTF", "10", "1200.00", "0.00", "0.00"]]); // booked after closing

    // After closing: drafts can't be added or removed; amendments adjust the right supplier only.
    await expect(recordCostEntries(db, staff, { orderId, entries: [row({ category: "OTHER", amount: "1" })] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeDraftCost(db, staff, { costId: labor.id })).rejects.toMatchObject({ code: "CONFLICT" });
    const embRow = ws.entries.find((e) => e.supplier?.id === embroiderer.id)!;
    await amendCostEntry(db, owner, { costId: embRow.id, expectedVersion: embRow.version, amount: "450", reason: "خصم من الورشة" });
    expect((await getSupplierDetails(db, owner, embroiderer.id))!.totals).toMatchObject({ purchased: "450.00" });
    expect((await getSupplierDetails(db, owner, dtfSupplier.id))!.totals).toMatchObject({ purchased: "1200.00" });
    expect((await getCostWorkspace(db, owner, orderId))!.totals.posted).toBe("2100.00");
  });
});
