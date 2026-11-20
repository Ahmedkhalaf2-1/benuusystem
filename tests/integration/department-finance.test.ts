import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import { createFirstOwnerAdmin } from "@/server/services/admin-bootstrap-service";
import type { Actor } from "@/server/services/actor";
import { recordOrderCost } from "@/server/services/cost-service";
import {
  getDepartmentCollections,
  getDepartmentDashboard,
  getDepartmentOrder,
  getDepartmentsOverview,
  listDepartmentOrders,
  recordDepartmentStage,
  setDepartmentMembership,
} from "@/server/services/department-service";
import { setItemValueSplit, setOrderHiddenFromDepartments } from "@/server/services/order-department-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { payPayable, voidOutgoingPayment } from "@/server/services/outgoing-payment-service";
import { getDepartmentSettlements, getMySettlement, getPartnerAccountSettlement, linkPartnerSupplier } from "@/server/services/partner-settlement-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import { createPreset, listActivePresetNames, listPresetsForAdmin, updatePreset } from "@/server/services/product-preset-service";
import { createStaffAccount } from "@/server/services/staff-access-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

/**
 * Phase 3 — department finance (allocated collections), mixed-department
 * orders, partner settlements, financial permissions and presets.
 */
const TODAY = todayDateString();
const OWNER = { name: "المالك", email: "owner@benuuprint.test", password: "owner-pass-123" };

function flatten(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v instanceof Date) return;
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.push(k);
        walk(x);
      }
      return;
    }
    out.push(String(v));
  };
  walk(value);
  return out;
}

describe.skipIf(!hasTestDatabase)("department finance & partner settlements (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;
  let dept: Record<"EMBROIDERY" | "COVERS" | "PRINTING" | "GARMENTS", string>;

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
    staff = await createTestUser(db, "STAFF");
    dept = Object.fromEntries((await db.department.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id])) as typeof dept;
  });

  async function newPartner(name = "ورشة التطريز") {
    const { userId } = await createStaffAccount(db, owner, { name, email: `p-${randomUUID().slice(0, 8)}@benuuprint.test`, password: "partner-pass-123", ownerPassword: OWNER.password, kind: "PARTNER" });
    return db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, permissions: true } });
  }
  const grant = (userId: string, departmentId: string, flags: Partial<Record<"canViewWork" | "canViewMoney" | "canRecordProduction" | "canViewCollections" | "canViewSettlements", boolean>> = {}) =>
    setDepartmentMembership(db, owner, { userId, departmentId, canViewWork: true, canViewMoney: false, canRecordProduction: false, canViewCollections: false, canViewSettlements: false, ...flags });

  /** Embroidery 50 × 200 = 10,000 and printing 100 × 120 = 12,000 → total 22,000. */
  function payload(overrides: Partial<CreateOrderPayload> = {}): CreateOrderPayload {
    return {
      idempotencyKey: randomUUID(),
      customer: { mode: "new", name: "فندق النيل", phone: "01012345678" },
      title: "Emma Tourism",
      productType: "تيشيرت",
      pricing: "items",
      unit: "PIECE",
      groups: [
        { name: "تيشيرت مطرز", quantity: "50", unitPrice: "200", departmentId: dept.EMBROIDERY, designs: [{ operation: "EMBROIDERY" }] },
        { name: "تيشيرت مطبوع", quantity: "100", unitPrice: "120", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }] },
      ],
      receivedDate: TODAY,
      deliveryDate: "2099-12-31",
      ...overrides,
    };
  }
  const pay = (orderId: string, amount: string, extra: Record<string, unknown> = {}) =>
    recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount, paidAt: TODAY, method: "CASH", ...extra });

  // ─── Allocation ───

  it("allocates every valid payment pro-rata to the priced department work, exactly, and reconciles", async () => {
    const { orderId } = await createOrder(db, owner, payload({ advance: "5000", advancePaidAt: TODAY }));
    await pay(orderId, "3333.33");
    const o = await getDepartmentsOverview(db, owner);
    const emb = o.departments.find((d) => d.id === dept.EMBROIDERY)!.stats.money;
    const prn = o.departments.find((d) => d.id === dept.PRINTING)!.stats.money;
    // 5,000 → 2,272.73 / 2,727.27 ; 3,333.33 → 1,515.15 / 1,818.18 (largest remainder, exact piasters)
    expect(emb).toMatchObject({ workValue: "10000.00", collections: { collected: "3787.88", outstanding: "6212.12", orders: { PAID: 0, PARTIAL: 1, UNPAID: 0 } } });
    expect(prn).toMatchObject({ workValue: "12000.00", collections: { collected: "4545.45", outstanding: "7454.55" } });
    expect(o.totals).toEqual({ departmentsValue: "22000.00", ordersTotal: "22000.00", departmentsCollected: "8333.33", paymentsTotal: "8333.33", valueBalanced: true, collectionsBalanced: true });

    // The payments themselves are untouched, and no treasury row was invented.
    expect((await getOrderDetails(db, owner, orderId))!.money).toEqual({ totalPrice: "22000.00", paid: "8333.33", outstanding: "13666.67" });
    expect(await db.treasuryMovement.count()).toBe(0);
    expect(await db.orderPayment.count()).toBe(2);

    // Fully paid → each department exactly its value.
    await pay(orderId, "13666.67");
    const full = await getDepartmentsOverview(db, owner);
    expect(full.departments.map((d) => [d.id, d.stats.money.collections!.collected, d.stats.money.collections!.outstanding]).filter(([id]) => id === dept.EMBROIDERY || id === dept.PRINTING)).toEqual([
      [dept.EMBROIDERY, "10000.00", "0.00"],
      [dept.PRINTING, "12000.00", "0.00"],
    ]);
  });

  it("respects voided payments, and records the allocation snapshot in the payment audit", async () => {
    const { orderId } = await createOrder(db, owner, payload());
    const p = await pay(orderId, "1100");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "PAYMENT_RECORDED", entityId: p.paymentId } });
    expect((log.metadata as { departmentAllocation: Record<string, string> }).departmentAllocation).toEqual({ [dept.EMBROIDERY]: "500.00", [dept.PRINTING]: "600.00" });
    await voidPayment(db, owner, { paymentId: p.paymentId, reason: "اتسجلت غلط" });
    const o = await getDepartmentsOverview(db, owner);
    expect(o.totals).toMatchObject({ departmentsCollected: "0.00", paymentsTotal: "0.00", collectionsBalanced: true });
  });

  it("never pushes ambiguous money into a department: no department, single-total orders and stale splits stay UNALLOCATED", async () => {
    const legacy = await createOrder(db, owner, { ...payload(), pricing: "order", totalPrice: "9000", groups: [{ operations: ["DTF"], plain: false, quantity: "10" }] });
    await pay(legacy.orderId, "3000");
    const noDept = await createOrder(db, owner, payload());
    await db.orderGroup.updateMany({ where: { orderId: noDept.orderId, departmentId: dept.PRINTING }, data: { departmentId: null } });
    await pay(noDept.orderId, "2200");

    const o = await getDepartmentsOverview(db, owner);
    // Legacy 9,000 + printing item without department 12,000 = 21,000 unallocated value.
    expect(o.unallocated).toEqual({ value: "21000.00", collected: "4200.00" }); // 3,000 + 2,200 × 12/22
    expect(o.departments.find((d) => d.id === dept.EMBROIDERY)!.stats.money.collections!.collected).toBe("1000.00");
    expect(o.totals).toMatchObject({ valueBalanced: true, collectionsBalanced: true, paymentsTotal: "5200.00" });
    // The legacy order's item is flagged as not reliably allocatable for its department.
    expect(o.departments.find((d) => d.id === dept.PRINTING)!.stats.money.unreliableItems).toBe(1);
  });

  it("rounds three-way splits exactly to the piaster", async () => {
    const { orderId } = await createOrder(db, owner, payload({
      groups: [
        { name: "أ", quantity: "1", unitPrice: "1", departmentId: dept.EMBROIDERY, designs: [{ operation: "EMBROIDERY" }] },
        { name: "ب", quantity: "1", unitPrice: "1", departmentId: dept.COVERS, plain: true, designs: [] },
        { name: "ج", quantity: "1", unitPrice: "1", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }] },
      ],
    }));
    await pay(orderId, "1.00");
    const o = await getDepartmentsOverview(db, owner);
    const c = Object.fromEntries(o.departments.map((d) => [d.id, d.stats.money.collections!.collected]));
    expect([c[dept.EMBROIDERY], c[dept.COVERS], c[dept.PRINTING]]).toEqual(["0.34", "0.33", "0.33"]); // first department (sort order) gets the extra piaster
    expect(o.totals.collectionsBalanced).toBe(true);
  });

  // ─── Explicit split of a shared item ───

  it("splits a shared item's value explicitly (owner only, exact), and allocations follow the split; a stale split is flagged", async () => {
    const { orderId } = await createOrder(db, owner, payload({
      groups: [{ name: "تيشيرت مطبوع ومطرز", quantity: "10", unitPrice: "300", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] }],
    }));
    const item = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    const split = (shares: { departmentId: string; amount: string }[]) => setItemValueSplit(db, owner, { orderId, orderGroupId: item.id, shares });

    await expect(split([{ departmentId: dept.PRINTING, amount: "2000" }, { departmentId: dept.EMBROIDERY, amount: "999" }])).rejects.toMatchObject({ fieldErrors: { shares: [expect.stringContaining("لازم يساوي قيمة البند")] } });
    await expect(split([{ departmentId: dept.PRINTING, amount: "3000" }])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(setItemValueSplit(db, staff, { orderId, orderGroupId: item.id, shares: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await split([{ departmentId: dept.PRINTING, amount: "1800" }, { departmentId: dept.EMBROIDERY, amount: "1200" }]);
    expect(await db.auditLog.count({ where: { action: "ORDER_VALUE_SPLIT_SET", entityId: item.id } })).toBe(1);

    await pay(orderId, "1000");
    let o = await getDepartmentsOverview(db, owner);
    const money = (id: string) => o.departments.find((d) => d.id === id)!.stats.money;
    expect(money(dept.PRINTING)).toMatchObject({ workValue: "1800.00", collections: { collected: "600.00" } });
    expect(money(dept.EMBROIDERY)).toMatchObject({ workValue: "1200.00", collections: { collected: "400.00" } });
    expect(o.totals).toMatchObject({ departmentsValue: "3000.00", ordersTotal: "3000.00", valueBalanced: true, collectionsBalanced: true });

    // An embroidery partner (money switch) sees its share of the printing item — the item stays a printing item for work.
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY, { canViewMoney: true });
    await expect(getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId)).rejects.toMatchObject({ code: "NOT_FOUND" }); // no embroidery item to work on
    const dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats.money!.workValue).toBe("1200.00");
    expect(dash.stats.orders.total).toBe(0); // physical work isn't double-counted

    // Price change → the split no longer adds up → not trusted (unallocated) until re-saved.
    const d = (await getOrderDetails(db, owner, orderId))!;
    await updateOrder(db, owner, {
      orderId, customer: { mode: "existing", id: d.customerId }, title: d.title, productType: d.productType, pricing: "items", unit: d.unit,
      receivedDate: d.receivedDate, deliveryDate: d.deliveryDate, status: d.status as "NEW",
      groups: [{ id: item.id, name: item.name ?? "", quantity: "10", unitPrice: "350", departmentId: dept.PRINTING, designs: item.designs.map((x) => ({ id: x.id, operation: x.operation })) }],
    });
    o = await getDepartmentsOverview(db, owner);
    expect(o.unallocated.value).toBe("3500.00");
    expect(money(dept.PRINTING)).toMatchObject({ workValue: "0.00", unreliableItems: 1 });
    expect(o.totals).toMatchObject({ valueBalanced: true, collectionsBalanced: true });
  });

  // ─── Permissions ───

  it("work value, collections and settlements are separate switches; collections need the value switch", async () => {
    const partner = await newPartner();
    const { orderId } = await createOrder(db, owner, payload());
    await pay(orderId, "2200");

    await grant(partner.id, dept.EMBROIDERY);
    let dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats.money).toBeNull();
    expect(dash.collectionHistory).toBeNull();
    await expect(getDepartmentCollections(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getMySettlement(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Collections switched on without the value switch: still nothing (an outstanding balance would reveal the value).
    await grant(partner.id, dept.EMBROIDERY, { canViewCollections: true });
    dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats.money).toBeNull();
    await expect(getDepartmentCollections(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await grant(partner.id, dept.EMBROIDERY, { canViewMoney: true, canViewCollections: true });
    dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats.money).toMatchObject({ workValue: "10000.00", collections: { collected: "1000.00", outstanding: "9000.00" } });
    expect(dash.collectionHistory!.map((h) => h.amount)).toEqual(["1000.00"]);
    const view = await getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId);
    expect(view.money).toMatchObject({ value: "10000.00", collected: "1000.00", outstanding: "9000.00", status: "PARTIAL", allocations: [{ amount: "1000.00" }] });
    const list = await listDepartmentOrders(db, partner, dept.EMBROIDERY, { filter: "all" });
    expect(list.items[0]!.money).toMatchObject({ collected: "1000.00", status: "PARTIAL" });

    // Never the whole-order payment, total or the other department's share.
    for (const out of [dash, view, list, await getDepartmentCollections(db, partner, dept.EMBROIDERY)]) {
      const w = flatten(JSON.parse(JSON.stringify(out)));
      for (const leaked of ["2200.00", "22000.00", "1200.00", "12000.00", "totalPrice", "paymentId", "01012345678"]) expect(w).not.toContain(leaked);
    }
    // Another department stays out of reach.
    await expect(getDepartmentCollections(db, partner, dept.PRINTING)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("orders hidden from departments disappear for members (work, value, collections, production) but not for the owner", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY, { canViewMoney: true, canViewCollections: true, canRecordProduction: true });
    const { orderId } = await createOrder(db, owner, payload());
    await pay(orderId, "2200");
    await setOrderHiddenFromDepartments(db, owner, { orderId, hidden: true });
    await expect(setOrderHiddenFromDepartments(db, staff, { orderId, hidden: false })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats.orders.total).toBe(0);
    expect(dash.stats.money).toMatchObject({ workValue: "0.00", collections: { collected: "0.00" } });
    const g = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    await expect(recordDepartmentStage(db, partner, dept.EMBROIDERY, { orderId, orderGroupId: g.id, designId: g.designs[0]!.id, operation: "EMBROIDERY", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDepartmentDashboard(db, owner, dept.EMBROIDERY)).stats.orders.total).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ORDER_DEPARTMENT_VISIBILITY_CHANGED", entityId: orderId } })).toBe(1);
  });

  // ─── Settlements ───

  it("tracks a partner's settlement from recorded jobs and payouts — separate from customer collections", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY, { canViewSettlements: true });
    expect(await getMySettlement(db, partner, dept.EMBROIDERY)).toEqual({ linked: false });

    const { supplierId } = await linkPartnerSupplier(db, owner, { userId: partner.id, supplierId: "new" });
    expect(await db.auditLog.count({ where: { action: "PARTNER_SUPPLIER_LINKED", entityId: partner.id } })).toBe(1);
    const { orderId } = await createOrder(db, owner, payload({ advance: "22000", advancePaidAt: TODAY }));

    // A customer paying in full pays no partner.
    expect(await getMySettlement(db, partner, dept.EMBROIDERY)).toMatchObject({ linked: true, totals: { payable: "0.00", paid: "0.00", remaining: "0.00" } });

    // Job per piece: 50 × 35 = 1,750 (amount must match exactly).
    const job = (extra: Record<string, unknown>) =>
      recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "EMBROIDERY", amount: "1750", costDate: TODAY, supplier: { mode: "existing", id: supplierId! }, payStatus: "CREDIT", departmentId: dept.EMBROIDERY, quantity: "50", unitCost: "35", ...extra });
    await expect(job({ amount: "1700" })).rejects.toMatchObject({ fieldErrors: { amount: ["المبلغ لازم يساوي عدد القطع × تكلفة القطعة"] } });
    await expect(job({ departmentId: dept.COVERS })).rejects.toMatchObject({ fieldErrors: { departmentId: ["الأوردر ده مفيهوش شغل للقسم ده"] } });
    const cost = await job({});
    // An agreed job price (no per-piece) for the same partner.
    await recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "EMBROIDERY", amount: "250", costDate: TODAY, supplier: { mode: "existing", id: supplierId! }, payStatus: "CREDIT", departmentId: dept.EMBROIDERY, description: "تطريز اسم" });
    // A cost for the same supplier with no department is the owner's business only.
    await recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "OTHER", amount: "99", costDate: TODAY, supplier: { mode: "existing", id: supplierId! }, payStatus: "CREDIT" });

    // Partial settlement, then a voided payout.
    await payPayable(db, owner, "cost", { targetId: cost.costId, idempotencyKey: randomUUID(), amount: "1000", paidAt: TODAY, method: "CASH" });
    const wrong = await payPayable(db, owner, "cost", { targetId: cost.costId, idempotencyKey: randomUUID(), amount: "100", paidAt: TODAY, method: "CASH" });
    await voidOutgoingPayment(db, owner, { id: wrong.paymentId, reason: "غلط" });

    const s = await getMySettlement(db, partner, dept.EMBROIDERY);
    expect(s).toMatchObject({ linked: true, totals: { payable: "2000.00", paid: "1000.00", remaining: "1000.00", jobs: 2 } });
    if (!s.linked) throw new Error();
    expect(s.jobs.find((j) => j.quantity === 50)).toMatchObject({ unitCost: "35.00", amount: "1750.00", paid: "1000.00", remaining: "750.00", orderTitle: "Emma Tourism" });
    expect(s.payments.map((p) => p.amount)).toEqual(["1000.00"]);
    // The settlement never carries customer money.
    const w = flatten(JSON.parse(JSON.stringify(s)));
    for (const leaked of ["22000.00", "10000.00", "collected", "99.00"]) expect(w).not.toContain(leaked);

    // Customer collections are unchanged by partner payouts.
    const o = await getDepartmentsOverview(db, owner);
    expect(o.departments.find((d) => d.id === dept.EMBROIDERY)!.stats.money.collections!.collected).toBe("10000.00");

    // Owner views.
    const ds = await getDepartmentSettlements(db, owner, dept.EMBROIDERY);
    expect(ds.totals).toMatchObject({ payable: "2000.00", paid: "1000.00", remaining: "1000.00" });
    expect(ds.rows[0]).toMatchObject({ supplierId, partnerName: "ورشة التطريز" });
    const acc = (await getPartnerAccountSettlement(db, owner, partner.id))!;
    expect(acc.settlement!.totals).toMatchObject({ payable: "2099.00", remaining: "1099.00" }); // all of the supplier's costs
    await expect(getDepartmentSettlements(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a partner never sees another partner's settlement; hidden orders are masked; one supplier per partner", async () => {
    const a = await newPartner("ورشة أ");
    const b = await newPartner("ورشة ب");
    await grant(a.id, dept.EMBROIDERY, { canViewSettlements: true });
    await grant(b.id, dept.EMBROIDERY, { canViewSettlements: true });
    const { supplierId: sa } = await linkPartnerSupplier(db, owner, { userId: a.id, supplierId: "new" });
    await linkPartnerSupplier(db, owner, { userId: b.id, supplierId: "new" });
    await expect(linkPartnerSupplier(db, owner, { userId: b.id, supplierId: sa })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(linkPartnerSupplier(db, owner, { userId: staff.id, supplierId: "new" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { orderId } = await createOrder(db, owner, payload());
    await recordOrderCost(db, owner, { orderId, idempotencyKey: randomUUID(), category: "EMBROIDERY", amount: "500", costDate: TODAY, supplier: { mode: "existing", id: sa! }, payStatus: "CREDIT", departmentId: dept.EMBROIDERY });
    expect(await getMySettlement(db, b, dept.EMBROIDERY)).toMatchObject({ totals: { payable: "0.00", jobs: 0 } });
    expect(await getMySettlement(db, a, dept.EMBROIDERY)).toMatchObject({ totals: { payable: "500.00", jobs: 1 } });

    await setOrderHiddenFromDepartments(db, owner, { orderId, hidden: true });
    const masked = await getMySettlement(db, a, dept.EMBROIDERY);
    if (!masked.linked) throw new Error();
    expect(masked.jobs[0]!.orderTitle).toBeNull(); // still owed, but the order's details stay hidden
    // Losing the department removes the settlement view on the next request.
    await grant(a.id, dept.EMBROIDERY, { canViewSettlements: false });
    await expect(getMySettlement(db, a, dept.EMBROIDERY)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ─── Presets ───

  it("the owner manages the ready-made preset list; the order form gets the active names in order", async () => {
    expect(await listActivePresetNames(db, owner)).toEqual(["تيشيرت", "هودي", "سويت شيرت", "بولو", "كاب", "شنطة"]);
    const { presetId } = await createPreset(db, owner, { name: "جاكيت" });
    await expect(createPreset(db, owner, { name: "هودي" })).rejects.toMatchObject({ fieldErrors: { name: ["المنتج ده موجود في القايمة"] } });
    const all = await listPresetsForAdmin(db, owner);
    await updatePreset(db, owner, { presetId: all.find((p) => p.name === "كاب")!.id, isActive: false });
    await updatePreset(db, owner, { presetId, move: -1 });
    await updatePreset(db, owner, { presetId: all.find((p) => p.name === "بولو")!.id, name: "بولو شيرت" });
    expect(await listActivePresetNames(db, staff)).toEqual(["تيشيرت", "هودي", "سويت شيرت", "بولو شيرت", "جاكيت", "شنطة"]);
    await expect(createPreset(db, staff, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.auditLog.count({ where: { action: { in: ["PRODUCT_PRESET_CREATED", "PRODUCT_PRESET_UPDATED"] } } })).toBe(4);
    const partner = await newPartner();
    await expect(listActivePresetNames(db, partner)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
