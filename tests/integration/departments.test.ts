import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasPermission, homePathFor, permissionsFor } from "@/lib/auth/permissions";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import { createFirstOwnerAdmin } from "@/server/services/admin-bootstrap-service";
import type { Actor } from "@/server/services/actor";
import { login, validateSessionToken } from "@/server/services/auth-service";
import { archiveOrder } from "@/server/services/order-archive-service";
import {
  createDepartment,
  getDepartmentDashboard,
  getDepartmentOrder,
  getDepartmentsOverview,
  listDepartmentOrders,
  listMyDepartments,
  recordDepartmentReady,
  recordDepartmentStage,
  revokeDepartmentMembership,
  setDepartmentMembership,
  updateDepartment,
} from "@/server/services/department-service";
import { createOrder, getDashboardOverview, getOrderDetails, listOrders, updateOrder } from "@/server/services/order-service";
import { listAssignableStaff } from "@/server/services/order-visibility-service";
import { recordPayment } from "@/server/services/payment-service";
import { recordDelivery, recordReady, recordStageProgress } from "@/server/services/production-service";
import { createStaffAccount, getAccount, setStaffActive, updateStaffPermissions } from "@/server/services/staff-access-service";
import { listAccountOptions } from "@/server/services/treasury-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

/**
 * Phase 2 — departments, partner accounts and strict department isolation.
 */
const TODAY = todayDateString();
const OWNER = { name: "المالك", email: "owner@benuuprint.test", password: "owner-pass-123" };
const ctx = { ipAddress: "203.0.113.20" };

/** Every key and string value in a JSON-able value (for leak scans). */
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

describe.skipIf(!hasTestDatabase)("departments & partners (PostgreSQL)", () => {
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
    const rows = await db.department.findMany({ select: { id: true, key: true } });
    dept = Object.fromEntries(rows.map((r) => [r.key, r.id])) as typeof dept;
  });

  /** A partner account created the real way (owner re-authenticates), as an Actor. */
  async function newPartner(email = `partner-${randomUUID().slice(0, 6)}@benuuprint.test`) {
    const { userId } = await createStaffAccount(db, owner, { name: "شريك التطريز", email, password: "partner-pass-123", ownerPassword: OWNER.password, kind: "PARTNER" });
    const actor = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, permissions: true } });
    return { ...actor, email };
  }
  const grant = (userId: string, departmentId: string, flags: Partial<{ canViewWork: boolean; canViewMoney: boolean; canRecordProduction: boolean }> = {}) =>
    setDepartmentMembership(db, owner, { userId, departmentId, canViewWork: true, canViewMoney: false, canRecordProduction: false, ...flags });

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
      advance: "0",
      advanceMethod: "CASH",
      receivedDate: TODAY,
      deliveryDate: "2099-12-31",
      notes: "ملاحظة داخلية: السعر الخاص للعميل",
      ...overrides,
    };
  }

  // ─── Departments ───

  it("seeds four departments; the owner adds, renames and deactivates them (audited); nobody else can", async () => {
    expect((await db.department.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } })).map((d) => d.name)).toEqual(["تطريز", "كوفرات", "طباعة", "ملابس / منتج كامل"]);
    const { departmentId } = await createDepartment(db, owner, { name: "  هدايا  " });
    await expect(createDepartment(db, owner, { name: "هدايا" })).rejects.toMatchObject({ fieldErrors: { name: ["في قسم بنفس الاسم"] } });
    await updateDepartment(db, owner, { departmentId, name: "هدايا ومطبوعات", isActive: false });
    expect(await db.department.findUniqueOrThrow({ where: { id: departmentId }, select: { name: true, isActive: true } })).toEqual({ name: "هدايا ومطبوعات", isActive: false });
    expect(await db.auditLog.count({ where: { action: { in: ["DEPARTMENT_CREATED", "DEPARTMENT_UPDATED"] }, entityId: departmentId } })).toBe(2);

    const partner = await newPartner();
    await expect(createDepartment(db, staff, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createDepartment(db, partner, { name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateDepartment(db, partner, { departmentId: dept.COVERS, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gives every item exactly one department: explicit, kept on edit, or the documented suggestion", async () => {
    const { orderId } = await createOrder(db, owner, payload({
      productType: "جراب موبايل",
      groups: [
        { name: "لوجو مطرز", quantity: "10", unitPrice: "50", designs: [{ operation: "EMBROIDERY" }] },
        { name: "طباعة صدر", quantity: "10", unitPrice: "50", designs: [{ operation: "SCREEN_PRINT" }] },
        { name: "هودي جاهز", quantity: "10", unitPrice: "50", plain: true, designs: [] },
        { name: "جراب آيفون", quantity: "10", unitPrice: "50", plain: true, designs: [] },
        { name: "مختلط", quantity: "10", unitPrice: "50", designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] },
      ],
    }));
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.groups.map((g) => g.department?.name)).toEqual(["تطريز", "طباعة", "ملابس / منتج كامل", "كوفرات", "طباعة"]);

    // Explicit choice wins; an edit that sends no department keeps the current one.
    const base = {
      orderId,
      customer: { mode: "existing" as const, id: d.customerId },
      title: d.title,
      productType: d.productType,
      pricing: "items" as const,
      unit: d.unit,
      receivedDate: d.receivedDate,
      deliveryDate: d.deliveryDate,
      status: "NEW" as const,
    };
    const groups = d.groups.map((g) => ({ id: g.id, name: g.name ?? "", quantity: String(g.quantity), unitPrice: "50", plain: g.designs.length === 0, designs: g.designs.map((x) => ({ id: x.id, operation: x.operation })) }));
    await updateOrder(db, owner, { ...base, groups: groups.map((g, i) => (i === 4 ? { ...g, departmentId: dept.EMBROIDERY } : g)) });
    const after = (await getOrderDetails(db, owner, orderId))!;
    expect(after.groups.map((g) => g.department?.name)).toEqual(["تطريز", "طباعة", "ملابس / منتج كامل", "كوفرات", "تطريز"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "ORDER_UPDATED", entityId: orderId } });
    expect(JSON.stringify(log.metadata)).toContain(dept.EMBROIDERY);

    // Unknown or inactive departments are refused.
    await expect(createOrder(db, owner, payload({ groups: [{ name: "x", quantity: "1", unitPrice: "1", departmentId: randomUUID(), designs: [{ operation: "DTF" }] }] }))).rejects.toMatchObject({
      fieldErrors: { "groups.0.departmentId": ["القسم ده مش موجود أو متوقف — اختار قسم تاني"] },
    });
    await updateDepartment(db, owner, { departmentId: dept.COVERS, isActive: false });
    await expect(createOrder(db, owner, payload({ groups: [{ name: "x", quantity: "1", unitPrice: "1", departmentId: dept.COVERS, plain: true, designs: [] }] }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // …but an existing item may keep its (now inactive) department on edit.
    await updateOrder(db, owner, { ...base, expectedUpdatedAt: undefined, groups: groups.map((g, i) => ({ ...g, departmentId: (after.groups[i]!.department!.id) })) });
  });

  // ─── Partner accounts ───

  it("creates partner accounts that sign in independently and land on their departments", async () => {
    const partner = await newPartner("emb.partner@benuuprint.test");
    expect(partner.role).toBe("PARTNER");
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "USER_CREATED", entityId: partner.id } })).toMatchObject({ userId: owner.id, metadata: expect.objectContaining({ role: "PARTNER" }) });
    const r = await login(db, { email: "emb.partner@benuuprint.test", password: "partner-pass-123" }, ctx);
    expect(r.ok).toBe(true);
    const session = await validateSessionToken(db, r.ok ? r.token : null);
    expect(session?.user.role).toBe("PARTNER");
    expect(homePathFor(session!.user)).toBe("/departments");
    expect(homePathFor(owner)).toBe("/dashboard");

    // Owner re-authentication is required; wrong kinds are refused.
    await expect(createStaffAccount(db, owner, { name: "x", email: "x@benuuprint.test", password: "partner-pass-123", ownerPassword: "wrong", kind: "PARTNER" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createStaffAccount(db, owner, { name: "x", email: "y@benuuprint.test", password: "partner-pass-123", ownerPassword: OWNER.password, kind: "OWNER_ADMIN" })).rejects.toMatchObject({ fieldErrors: { kind: ["اختار نوع الحساب"] } });

    // Deactivation ends the partner's sessions.
    const acc = (await getAccount(db, owner, partner.id))!;
    await setStaffActive(db, owner, { userId: partner.id, active: false, expectedVersion: acc.version });
    expect(await validateSessionToken(db, r.ok ? r.token : null)).toBeNull();
  });

  it("partners hold no company-wide permission — even if grants are stored on the row", async () => {
    const partner = await newPartner();
    await db.user.update({ where: { id: partner.id }, data: { permissions: ["orders:view", "orders:view-prices", "payments:view", "customers:view-contact"] } });
    const p = await db.user.findUniqueOrThrow({ where: { id: partner.id }, select: { id: true, role: true, permissions: true } });
    expect(permissionsFor(p)).toEqual([]);
    expect(hasPermission(p, "dashboard:view")).toBe(false);

    const { orderId } = await createOrder(db, owner, payload(), { visibility: "ALL_AUTHORIZED_STAFF" });
    await expect(listOrders(db, p, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOrderDetails(db, p, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDashboardOverview(db, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createOrder(db, p, payload())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordPayment(db, p, { orderId, idempotencyKey: randomUUID(), amount: "1", paidAt: TODAY, method: "CASH" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAccountOptions(db, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDepartmentsOverview(db, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setDepartmentMembership(db, p, { userId: p.id, departmentId: dept.EMBROIDERY, canViewWork: true, canViewMoney: true, canRecordProduction: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // General production endpoints refuse partners (they write only through their department).
    const g = (await getOrderDetails(db, owner, orderId))!.groups[0]!;
    await expect(recordStageProgress(db, p, { orderId, orderGroupId: g.id, designId: g.designs[0]!.id, operation: "EMBROIDERY", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDelivery(db, p, { orderId, orderGroupId: g.id, quantity: "1", deliveredAt: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The owner can't give a partner general permissions, and partners can't be assigned orders.
    const acc = (await getAccount(db, owner, partner.id))!;
    await expect(updateStaffPermissions(db, owner, { userId: partner.id, permissions: ["orders:view"], expectedVersion: acc.version })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listAssignableStaff(db, owner)).map((s) => s.id)).not.toContain(partner.id);
  });

  // ─── Isolation ───

  it("a partner sees only its department's items of a shared order — no totals, other items, phones, notes or payments", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY);
    const { orderId } = await createOrder(db, owner, payload({ advance: "1000" }));
    await recordPayment(db, owner, { orderId, idempotencyKey: randomUUID(), amount: "2500", paidAt: TODAY, method: "CASH" });
    const whole = (await getOrderDetails(db, owner, orderId))!;
    const printed = whole.groups[1]!;

    expect((await listMyDepartments(db, partner)).map((d) => d.name)).toEqual(["تطريز"]);
    const view = await getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId);
    expect(view.order).toMatchObject({ number: 1, title: "Emma Tourism", customerName: "فندق النيل" });
    expect(view.items.map((i) => i.label)).toEqual(["تيشيرت مطرز"]);

    const words = flatten(JSON.parse(JSON.stringify(view)));
    for (const leaked of ["totalPrice", "paid", "outstanding", "payments", "customerPhone", "phone", "01012345678", "ملاحظة داخلية: السعر الخاص للعميل", "تيشيرت مطبوع", printed.id, "22000.00", "3500.00", "unitPrice", "value", "money", "collected"]) {
      expect(words).not.toContain(leaked);
    }
    // Same for the list and the dashboard.
    for (const payloadOut of [await listDepartmentOrders(db, partner, dept.EMBROIDERY, { filter: "all" }), await getDepartmentDashboard(db, partner, dept.EMBROIDERY)]) {
      const w = flatten(JSON.parse(JSON.stringify(payloadOut)));
      for (const leaked of ["totalPrice", "payments", "phone", "01012345678", "تيشيرت مطبوع", printed.id, "21000.00", "workValue"]) expect(w).not.toContain(leaked);
    }
  });

  it("denies other departments, unknown ids, malformed ids and orders without the department's items (NOT_FOUND)", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY);
    const mixed = await createOrder(db, owner, payload());
    const printOnly = await createOrder(db, owner, payload({ title: "طباعة بس", groups: [{ name: "x", quantity: "5", unitPrice: "10", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }] }] }));

    for (const id of [dept.COVERS, dept.PRINTING, randomUUID(), "not-a-uuid", "../../orders"]) {
      await expect(getDepartmentDashboard(db, partner, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(listDepartmentOrders(db, partner, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getDepartmentOrder(db, partner, id, mixed.orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(getDepartmentOrder(db, partner, dept.EMBROIDERY, printOnly.orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDepartmentOrder(db, partner, dept.EMBROIDERY, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Enumeration: the list only contains orders with embroidery items.
    const list = await listDepartmentOrders(db, partner, dept.EMBROIDERY, { filter: "all" });
    expect(list.items.map((o) => o.orderId)).toEqual([mixed.orderId]);
    expect((await getDepartmentDashboard(db, partner, dept.EMBROIDERY)).stats.orders.total).toBe(1);

    // A second partner on another department never sees the first one's work.
    const covers = await newPartner();
    await grant(covers.id, dept.COVERS);
    await expect(getDepartmentOrder(db, covers, dept.EMBROIDERY, mixed.orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDepartmentDashboard(db, covers, dept.COVERS)).stats.orders.total).toBe(0);

    // Archived orders disappear from department views.
    await archiveOrder(db, owner, { orderId: mixed.orderId, reason: "اتسجل غلط" });
    await expect(getDepartmentOrder(db, partner, dept.EMBROIDERY, mixed.orderId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("revocation, «work off» and a deactivated department take effect on the next request", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY, { canViewMoney: true });
    await getDepartmentDashboard(db, partner, dept.EMBROIDERY);

    await grant(partner.id, dept.EMBROIDERY, { canViewWork: false });
    await expect(getDepartmentDashboard(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await grant(partner.id, dept.EMBROIDERY);
    await updateDepartment(db, owner, { departmentId: dept.EMBROIDERY, isActive: false });
    await expect(getDepartmentDashboard(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDepartmentDashboard(db, owner, dept.EMBROIDERY)).department.isActive).toBe(false); // the owner still sees it
    await updateDepartment(db, owner, { departmentId: dept.EMBROIDERY, isActive: true });

    await revokeDepartmentMembership(db, owner, { userId: partner.id, departmentId: dept.EMBROIDERY });
    await expect(getDepartmentDashboard(db, partner, dept.EMBROIDERY)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMyDepartments(db, partner)).toEqual([]);
    const actions = (await db.auditLog.findMany({ where: { entityId: partner.id, action: { startsWith: "DEPARTMENT_ACCESS" } }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(["DEPARTMENT_ACCESS_CHANGED", "DEPARTMENT_ACCESS_CHANGED", "DEPARTMENT_ACCESS_CHANGED", "DEPARTMENT_ACCESS_REVOKED"]);

    // Nobody edits their own access or an owner's.
    await expect(setDepartmentMembership(db, owner, { userId: owner.id, departmentId: dept.EMBROIDERY, canViewWork: true, canViewMoney: true, canRecordProduction: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ─── Money ───

  it("shows department work value only with the money switch, never the order total or collections", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY);
    const { orderId } = await createOrder(db, owner, payload({ advance: "5000" }));

    const noMoney = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(noMoney.stats.money).toBeNull();
    expect(noMoney.access.canViewMoney).toBe(false);

    await grant(partner.id, dept.EMBROIDERY, { canViewMoney: true });
    const dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    // Work value only — collections need their own switch.
    expect(dash.stats.money).toEqual({ workValue: "10000.00", unreliableItems: 0, collections: null });
    const view = await getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId);
    expect(view.money).toEqual({ value: "10000.00" }); // 50 × 200 — not the 22,000 order total
    expect(view.items[0]).toMatchObject({ unitPrice: "200.00", value: "10000.00" });
    const words = flatten(JSON.parse(JSON.stringify(view)));
    for (const leaked of ["22000.00", "5000.00", "17000.00", "totalPrice", "paid", "outstanding", "collected", "allocations"]) expect(words).not.toContain(leaked);
  });

  it("never double-counts: each item's value belongs to one department and they add up to the order totals", async () => {
    await createOrder(db, owner, payload());
    await createOrder(db, owner, payload({ groups: [
      { name: "كوفر", quantity: "30", unitPrice: "75", departmentId: dept.COVERS, plain: true, designs: [] },
      { name: "تيشيرت مطرز ومطبوع", quantity: "20", unitPrice: "300", departmentId: dept.PRINTING, designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] },
    ] }));
    const cancelled = await createOrder(db, owner, payload({ title: "ملغي" }));
    const c = (await getOrderDetails(db, owner, cancelled.orderId))!;
    await updateOrder(db, owner, {
      orderId: c.id, customer: { mode: "existing", id: c.customerId }, title: c.title, productType: c.productType, pricing: "items", unit: c.unit,
      receivedDate: c.receivedDate, deliveryDate: c.deliveryDate, status: "CANCELLED",
      groups: c.groups.map((g) => ({ id: g.id, name: g.name ?? "", quantity: String(g.quantity), unitPrice: g.unitPrice!, departmentId: g.department!.id, designs: g.designs.map((d) => ({ id: d.id, operation: d.operation })) })),
    });

    const o = await getDepartmentsOverview(db, owner);
    const byName = Object.fromEntries(o.departments.map((d) => [d.name, d.stats.money!.workValue]));
    expect(byName).toEqual({ "تطريز": "10000.00", "كوفرات": "2250.00", "طباعة": "18000.00", "ملابس / منتج كامل": "0.00" });
    expect(o.unallocated).toEqual({ value: "0.00", collected: "0.00" });
    expect(o.totals).toMatchObject({ departmentsValue: "30250.00", ordersTotal: "30250.00", valueBalanced: true, collectionsBalanced: true });
    expect(o.departments.find((d) => d.name === "تطريز")!.stats.orders).toEqual({ total: 2, active: 1, completed: 0, cancelled: 1 });
  });

  // ─── Production from a department ───

  it("lets a partner record production and «جاهز» on its own items only, audited; never deliveries or other items", async () => {
    const partner = await newPartner();
    await grant(partner.id, dept.EMBROIDERY);
    const { orderId } = await createOrder(db, owner, payload());
    const d = (await getOrderDetails(db, owner, orderId))!;
    const [emb, prn] = d.groups;
    const stage = (groupId: string, designId: string, op: "EMBROIDERY" | "DTF", qty = "10") =>
      ({ orderId, orderGroupId: groupId, designId, operation: op, quantity: qty, workDate: TODAY, idempotencyKey: randomUUID() });

    // Viewing isn't recording.
    await expect(recordDepartmentStage(db, partner, dept.EMBROIDERY, stage(emb!.id, emb!.designs[0]!.id, "EMBROIDERY"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await grant(partner.id, dept.EMBROIDERY, { canRecordProduction: true });

    const r = await recordDepartmentStage(db, partner, dept.EMBROIDERY, stage(emb!.id, emb!.designs[0]!.id, "EMBROIDERY", "30"));
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PRODUCTION_STAGE_RECORDED", entityId: r.id } });
    expect(audit).toMatchObject({ userId: partner.id, metadata: expect.objectContaining({ departmentId: dept.EMBROIDERY, via: "department" }) });
    await recordDepartmentReady(db, partner, dept.EMBROIDERY, { orderId, orderGroupId: emb!.id, quantity: "30", readyDate: TODAY, idempotencyKey: randomUUID() });

    // Another department's item of the same order, or another department, is out of reach.
    await expect(recordDepartmentStage(db, partner, dept.EMBROIDERY, stage(prn!.id, prn!.designs[0]!.id, "DTF"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recordDepartmentStage(db, partner, dept.PRINTING, stage(prn!.id, prn!.designs[0]!.id, "DTF"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordDepartmentReady(db, partner, dept.PRINTING, { orderId, orderGroupId: prn!.id, quantity: "1", readyDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordReady(db, partner, { orderId, orderGroupId: emb!.id, quantity: "1", readyDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Existing rules still apply (no more than the design's pieces).
    await expect(recordDepartmentStage(db, partner, dept.EMBROIDERY, stage(emb!.id, emb!.designs[0]!.id, "EMBROIDERY", "21"))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const view = await getDepartmentOrder(db, partner, dept.EMBROIDERY, orderId);
    expect(view.items[0]).toMatchObject({ ready: 30, delivered: 0, status: "IN_PRODUCTION" });
    const dash = await getDepartmentDashboard(db, partner, dept.EMBROIDERY);
    expect(dash.stats).toMatchObject({ pendingPieces: 20, readyNotDelivered: 30 });
    expect(dash.activity.map((a) => [a.kind, a.quantity])).toEqual([["READY", 30], ["STAGE", 30]]);
    // The whole order's status follows the real records (in progress), prices and payments untouched.
    const whole = (await getOrderDetails(db, owner, orderId))!;
    expect(whole.status).toBe("IN_PROGRESS");
    expect(whole.money).toEqual({ totalPrice: "22000.00", paid: "0.00", outstanding: "22000.00" });
  });

  // ─── Owner & staff ───

  it("the owner sees every department; a staff member with a membership gets only that department", async () => {
    const { orderId } = await createOrder(db, owner, payload());
    for (const id of Object.values(dept)) await getDepartmentDashboard(db, owner, id);
    expect((await listMyDepartments(db, owner)).length).toBe(4);
    expect((await getDepartmentOrder(db, owner, dept.PRINTING, orderId)).items.map((i) => i.label)).toEqual(["تيشيرت مطبوع"]);

    await expect(getDepartmentDashboard(db, staff, dept.PRINTING)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await grant(staff.id, dept.PRINTING);
    expect((await getDepartmentDashboard(db, staff, dept.PRINTING)).stats.orders.total).toBe(1);
    await expect(getDepartmentDashboard(db, staff, dept.EMBROIDERY)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The membership doesn't change the staff member's normal order access (still per order visibility).
    expect((await listOrders(db, staff, {})).total).toBe(0);
  });

  it("existing orders, payments and Phase 1 flows keep working", async () => {
    const { orderId } = await createOrder(db, staff, payload({ receivedDate: "2026-01-05", advance: "4000", advancePaidAt: "2026-01-10" }));
    await recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount: "1000", paidAt: TODAY, method: "CASH" });
    const d = (await getOrderDetails(db, staff, orderId))!;
    expect(d.money).toEqual({ totalPrice: "22000.00", paid: "5000.00", outstanding: "17000.00" });
    expect(d.payments!.map((p) => p.paidAt)).toEqual(["2026-01-10", TODAY]);
    expect(d.groups.map((g) => g.department?.name)).toEqual(["تطريز", "طباعة"]);
  });
});

describe.skipIf(!hasTestDatabase)("Phase 2 backfill SQL (PostgreSQL)", () => {
  let db: PrismaClient;
  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  it("assigns existing items the same department the app suggests", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { suggestDepartmentKey } = await import("@/lib/departments/suggest");
    await resetDatabase(db);
    const owner = await createTestUser(db, "OWNER_ADMIN");
    const items: CreateOrderPayload["groups"] = [
      { name: "لوجو مطرز", quantity: "1", unitPrice: "1", designs: [{ operation: "EMBROIDERY" }] },
      { name: "طباعة", quantity: "1", unitPrice: "1", designs: [{ operation: "DTF" }, { operation: "EMBROIDERY" }] },
      { name: "جراب", quantity: "1", unitPrice: "1", plain: true, designs: [] },
      { name: "", quantity: "1", unitPrice: "1", plain: true, designs: [] },
    ];
    const { orderId } = await createOrder(db, owner, {
      idempotencyKey: randomUUID(), customer: { mode: "new", name: "x" }, title: "x", productType: "تيشيرت", pricing: "items", unit: "PIECE",
      groups: items.map((g, i) => ({ ...g, name: g.name || undefined, ...(i === 3 ? { name: "منتج" } : {}) })), receivedDate: TODAY, deliveryDate: "2099-01-01",
    });
    // An "older" item with item-level operations only.
    const legacy = await db.orderGroup.create({ data: { orderId, position: 9, quantity: 1, material: "", operations: { create: [{ operation: "SCREEN_PRINT" }, { operation: "EMBROIDERY" }] } }, select: { id: true } });
    await db.orderGroup.updateMany({ where: { orderId }, data: { departmentId: null } });

    const dir = path.resolve(__dirname, "../../prisma/migrations");
    const file = readdirSync(dir).find((d) => d.endsWith("_departments_partners"))!;
    const backfill = readFileSync(path.join(dir, file, "migration.sql"), "utf8").split("WITH primary_op AS")[1]!;
    await db.$executeRawUnsafe(`WITH primary_op AS ${backfill}`);

    const rows = await db.orderGroup.findMany({
      where: { orderId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, department: { select: { key: true } }, designs: { orderBy: { position: "asc" }, select: { operation: true } }, operations: { select: { operation: true } } },
    });
    for (const r of rows) {
      expect(r.department?.key).toBe(suggestDepartmentKey({ name: r.name, productType: "تيشيرت", designs: r.designs, operations: r.operations.map((o) => o.operation) }));
    }
    expect(rows.find((r) => r.id === legacy.id)!.department?.key).toBe("PRINTING");
  });
});
