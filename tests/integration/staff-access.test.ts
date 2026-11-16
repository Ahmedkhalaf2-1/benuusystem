import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { PERMISSION_PRESETS } from "@/lib/auth/permission-catalog";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/session-token";
import { todayDateString } from "@/lib/dates";
import type { CreateOrderPayload } from "@/lib/validations/order";
import type { Actor } from "@/server/services/actor";
import { validateSessionToken } from "@/server/services/auth-service";
import { getCustomerDetails, listCustomers, searchCustomers } from "@/server/services/customer-service";
import { getCustomerStatement, getOrderInvoiceData } from "@/server/services/customer-documents-service";
import { recordOrderCost } from "@/server/services/cost-service";
import { getFinanceDashboard } from "@/server/services/finance-summary-service";
import { canAccessOrder } from "@/server/services/order-access";
import { archiveOrder } from "@/server/services/order-archive-service";
import {
  createOrder,
  getDashboardOverview,
  getDashboardStats,
  getOrderDetails,
  getOrderForEdit,
  listOrders,
  listOrdersForAction,
  searchOpenOrders,
  updateOrder,
} from "@/server/services/order-service";
import { getOrderAccess, listAssignableStaff, updateOrderAccess } from "@/server/services/order-visibility-service";
import { recordPayment } from "@/server/services/payment-service";
import { getOrderProduction, getProductionDashboard, recordDelivery, recordReady, recordStageProgress } from "@/server/services/production-service";
import { getCashFlow } from "@/server/services/reports-service";
import { createStaffAccount, getAccount, listAccounts, resetStaffPassword, revokeStaffSessions, setStaffActive, updateStaffPermissions } from "@/server/services/staff-access-service";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const READ_ONLY_WORKER = PERMISSION_PRESETS.find((p) => p.key === "production-readonly")!.permissions;
/** Field names and values that must never reach a viewer without price permission. */
const MONEY_KEYS = ["totalPrice", "unitPrice", "lineTotal", "paid", "outstanding", "advance", "amount", "payments", "totals"];

function payload(overrides: Partial<CreateOrderPayload> = {}): CreateOrderPayload {
  return {
    idempotencyKey: randomUUID(),
    customer: { mode: "new", name: "محمود", phone: "01012345678" },
    title: "تيشيرتات محمود",
    productType: "تيشيرت",
    material: "قطن",
    quantity: "100",
    unit: "PIECE",
    pricing: "items",
    groups: [{ name: "تيشيرت أسود", quantity: "100", unitPrice: "137.50", operations: ["DTF"], plain: false }],
    advance: "4321",
    advanceMethod: "CASH",
    receivedDate: TODAY,
    deliveryDate: TODAY,
    ...overrides,
  } as CreateOrderPayload;
}

/** Every key anywhere in a JSON-serialized value. */
function jsonKeys(value: unknown): string[] {
  const keys: string[] = [];
  JSON.stringify(value, (k, v) => {
    if (k) keys.push(k);
    return v;
  });
  return keys;
}

describe.skipIf(!hasTestDatabase)("staff permissions & per-order visibility (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;

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
  });

  const staffWith = (permissions: readonly string[], email?: string) => createTestUser(db, "STAFF", email, [...permissions]);
  /** Re-reads an actor the way every request does (permissions come from the database). */
  const fresh = async (a: Actor): Promise<Actor> => db.user.findUniqueOrThrow({ where: { id: a.id }, select: { id: true, role: true, permissions: true } });
  const ownerOrder = async (access?: unknown, overrides: Partial<CreateOrderPayload> = {}) => {
    const { orderId } = await createOrder(db, owner, payload(overrides), access);
    const d = (await getOrderDetails(db, owner, orderId))!;
    return { orderId, groupId: d.groups[0]!.id, customerId: d.customerId };
  };
  const share = (orderId: string, visibility: string, userIds: string[] = [], expectedVersion?: number) =>
    updateOrderAccess(db, owner, { orderId, access: { visibility, userIds, ...(expectedVersion !== undefined ? { expectedVersion } : {}) } });

  // ─── Accounts & permissions ───

  it("owner has full access to every order, including private ones, with prices", async () => {
    const { orderId } = await ownerOrder();
    expect((await getOrderAccess(db, owner, orderId))!.visibility).toBe("PRIVATE");
    const d = (await getOrderDetails(db, owner, orderId))!;
    expect(d.money).toEqual({ totalPrice: "13750.00", paid: "4321.00", outstanding: "9429.00" });
    expect(d.groups[0]).toMatchObject({ unitPrice: "137.50", lineTotal: "13750.00" });
    expect(d.payments).toHaveLength(1);
    expect(d.customerPhone).toBe("01012345678");
    expect((await listOrders(db, owner, {})).total).toBe(1);
  });

  it("a new staff account has zero permissions and sees nothing", async () => {
    const nobody = await staffWith([]);
    await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" });
    await expect(listOrders(db, nobody, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDashboardOverview(db, nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getDashboardStats(db, nobody)).toEqual({ activeOrders: 0, overdueOrders: 0, paymentsThisMonth: null });
    await expect(searchOpenOrders(db, nobody, "")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCustomers(db, nobody, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getFinanceDashboard(db, nobody)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("read-only production worker: operational order view with NO financial data anywhere in the JSON", async () => {
    const worker = await staffWith(READ_ONLY_WORKER);
    const { orderId, groupId } = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" }, {
      groups: [
        {
          name: "تيشيرت أسود",
          quantity: "100",
          unitPrice: "137.50",
          operations: ["DTF"],
          plain: false,
          designs: [{ name: "AUC Logo", operation: "DTF", placements: ["CHEST"] }],
          sizes: [{ label: "M", quantity: "60" }, { label: "L", quantity: "40" }],
        },
      ],
      sizesEnabled: true,
    } as Partial<CreateOrderPayload>);
    const d = (await getOrderDetails(db, worker, orderId))!;
    expect(d).not.toBeNull();
    // What a worker can see:
    expect(d).toMatchObject({ title: "تيشيرتات محمود", customerName: "محمود", quantity: 100, deliveryDate: TODAY });
    expect(d.groups[0]!.label).toBe("تيشيرت أسود");
    expect(d.groups[0]!.designs[0]).toMatchObject({ label: "AUC Logo", operation: "DTF", placements: ["CHEST"] });
    expect(d.groups[0]!.sizes.map((s) => [s.label, s.quantity])).toEqual([["M", 60], ["L", 40]]);
    // What a worker must never get — not hidden, absent:
    expect(d.money).toBeNull();
    expect(d.payments).toBeNull();
    expect(d.customerPhone).toBeNull();
    const json = JSON.stringify(d);
    for (const key of ["totalPrice", "unitPrice", "lineTotal", "paid", "outstanding", "amount"]) expect(jsonKeys(d)).not.toContain(key);
    for (const value of ["13750", "137.5", "4321", "9429", "01012345678"]) expect(json).not.toContain(value);

    // Lists, dashboard and pickers carry no money either.
    const list = await listOrders(db, worker, {});
    expect(list.items).toHaveLength(1);
    const overview = await getDashboardOverview(db, worker);
    for (const value of [list, overview]) {
      expect(JSON.stringify(value)).not.toMatch(/13750|4321|9429/);
      for (const key of MONEY_KEYS) expect(jsonKeys(value)).not.toContain(key);
    }
    expect(list.items[0]!.money).toBeNull();

    // Production and delivery are readable…
    const p = (await getOrderProduction(db, worker, orderId))!;
    expect(p.totals.required).toBe(100);
    // …but nothing can be written.
    await expect(recordStageProgress(db, worker, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordReady(db, worker, { orderId, orderGroupId: groupId, quantity: "1", readyDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDelivery(db, worker, { orderId, orderGroupId: groupId, quantity: "1", deliveredAt: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordPayment(db, worker, { orderId, idempotencyKey: randomUUID(), amount: "1", paidAt: TODAY, method: "CASH" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordOrderCost(db, worker, { orderId, idempotencyKey: randomUUID(), category: "MATERIALS", description: "x", amount: "1", costDate: TODAY } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOrderForEdit(db, worker, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrder(db, worker, { orderId } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listOrdersForAction(db, worker, "production", "")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listOrdersForAction(db, worker, "payment", "")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("production read without write, and delivery read without write, are independent", async () => {
    const { orderId, groupId } = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" });
    await recordStageProgress(db, owner, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "30", workDate: TODAY, idempotencyKey: randomUUID(), alsoReady: true });
    await recordDelivery(db, owner, { orderId, orderGroupId: groupId, quantity: "10", deliveredAt: TODAY, idempotencyKey: randomUUID() });

    const productionOnly = await staffWith(["orders:view", "production:view"]);
    const deliveriesOnly = await staffWith(["orders:view", "deliveries:view"]);
    const recorder = await staffWith(["orders:view", "deliveries:view", "deliveries:record"]);

    const a = (await getOrderProduction(db, productionOnly, orderId))!;
    expect(a.totals).toMatchObject({ ready: 30, delivered: 10, remaining: 70 });
    expect(a.stageHistory).toHaveLength(1);
    expect(a.deliveryHistory).toEqual([]);
    const b = (await getOrderProduction(db, deliveriesOnly, orderId))!;
    expect(b.stageHistory).toEqual([]);
    expect(b.deliveryHistory).toHaveLength(1);

    await expect(recordDelivery(db, deliveriesOnly, { orderId, orderGroupId: groupId, quantity: "1", deliveredAt: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordStageProgress(db, recorder, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await recordDelivery(db, recorder, { orderId, orderGroupId: groupId, quantity: "5", deliveredAt: TODAY, idempotencyKey: randomUUID() });
    expect((await getOrderProduction(db, owner, orderId))!.totals.delivered).toBe(15);
  });

  // ─── Per-order visibility ───

  it("PRIVATE orders are invisible to staff everywhere: lists, search, counts, dashboard, customers, pickers, direct IDs", async () => {
    const staff = await staffWith(["orders:view", "orders:view-prices", "production:view", "production:record", "deliveries:view", "deliveries:record", "customers:view", "customers:view-contact", "payments:view", "payments:record", "work:record", "workers:view"]);
    const { orderId, groupId, customerId } = await ownerOrder(); // PRIVATE by default
    await recordStageProgress(db, owner, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "20", workDate: TODAY, idempotencyKey: randomUUID(), alsoReady: true });
    await recordDelivery(db, owner, { orderId, orderGroupId: groupId, quantity: "5", deliveredAt: TODAY, idempotencyKey: randomUUID() });

    expect(await getOrderDetails(db, staff, orderId)).toBeNull();
    expect(await getOrderProduction(db, staff, orderId)).toBeNull();
    expect(await canAccessOrder(db, staff, orderId)).toBe(false);
    expect((await listOrders(db, staff, {})).total).toBe(0);
    expect((await listOrders(db, staff, { query: "محمود" })).items).toEqual([]);
    expect((await listOrders(db, staff, { query: "#1" })).items).toEqual([]);
    expect(await searchOpenOrders(db, staff, "")).toEqual([]);
    expect(await listOrdersForAction(db, staff, "production", "")).toEqual([]);
    expect(await listOrdersForAction(db, staff, "delivery", "")).toEqual([]);
    expect(await listOrdersForAction(db, staff, "payment", "")).toEqual([]);
    expect(await getDashboardStats(db, staff)).toMatchObject({ activeOrders: 0, overdueOrders: 0 });
    const overview = await getDashboardOverview(db, staff);
    expect(overview).toMatchObject({ newCount: 0, inProgressCount: 0, readyToDeliverCount: 0, attention: [], readyWaiting: [], dueToday: [], recent: [] });
    expect(await getProductionDashboard(db, staff)).toMatchObject({ deliveriesToday: 0, deliveredThisMonth: [] });
    const customer = (await getCustomerDetails(db, staff, customerId))!;
    expect(customer.orders).toEqual([]);
    expect(customer.totals).toEqual({ agreed: "0.00", paid: "0.00", outstanding: "0.00" });
    expect((await listCustomers(db, staff, {})).items[0]!.orderCount).toBe(0);
    // Writes on a guessed ID look exactly like a missing order — nothing about it leaks.
    await expect(recordDelivery(db, staff, { orderId, orderGroupId: groupId, quantity: "1", deliveredAt: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordStageProgress(db, staff, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "1", workDate: TODAY, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordPayment(db, staff, { orderId, idempotencyKey: randomUUID(), amount: "1", paidAt: TODAY, method: "CASH" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A random UUID behaves the same.
    expect(await getOrderDetails(db, staff, randomUUID())).toBeNull();

    // The owner still sees it all.
    expect((await getDashboardOverview(db, owner)).readyToDeliverCount).toBe(1);
    expect((await getProductionDashboard(db, owner)).deliveriesToday).toBe(1);
  });

  it("SELECTED_STAFF: the chosen account sees the order, others don't; assignment is by user id and audited", async () => {
    const ali = await staffWith(READ_ONLY_WORKER, "ali@benuuprint.test");
    const omar = await staffWith(READ_ONLY_WORKER, "omar@benuuprint.test");
    const { orderId } = await ownerOrder({ visibility: "SELECTED_STAFF", userIds: [ali.id] });

    expect(await getOrderDetails(db, ali, orderId)).not.toBeNull();
    expect(await getOrderDetails(db, omar, orderId)).toBeNull();
    expect((await listOrders(db, ali, {})).total).toBe(1);
    expect((await listOrders(db, omar, {})).total).toBe(0);
    expect((await getDashboardOverview(db, omar)).recent).toEqual([]);

    // Swap who sees it; stale versions are refused.
    const v = (await getOrderAccess(db, owner, orderId))!.version;
    await share(orderId, "SELECTED_STAFF", [omar.id], v);
    await expect(share(orderId, "SELECTED_STAFF", [ali.id], v)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getOrderDetails(db, ali, orderId)).toBeNull();
    expect(await getOrderDetails(db, omar, orderId)).not.toBeNull();
    expect((await getOrderAccess(db, owner, orderId))!.userIds).toEqual([omar.id]);

    // Payroll workers or unknown/inactive accounts can't be assigned; owners can't be "assigned".
    await expect(share(orderId, "SELECTED_STAFF", [randomUUID()])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(share(orderId, "SELECTED_STAFF", [owner.id])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(share(orderId, "SELECTED_STAFF", [])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Leaving SELECTED_STAFF removes the assignment rows.
    await share(orderId, "PRIVATE");
    expect(await db.orderAccess.count({ where: { orderId } })).toBe(0);
    expect(await getOrderDetails(db, omar, orderId)).toBeNull();

    const audit = await db.auditLog.findMany({ where: { entityId: orderId, action: { in: ["ORDER_VISIBILITY_CHANGED", "ORDER_ACCESS_CHANGED"] } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["ORDER_VISIBILITY_CHANGED", "ORDER_ACCESS_CHANGED", "ORDER_ACCESS_CHANGED", "ORDER_VISIBILITY_CHANGED", "ORDER_ACCESS_CHANGED"]);
    expect(audit[2]!.metadata).toMatchObject({ added: [omar.id], removed: [ali.id] });
  });

  it("ALL_AUTHORIZED_STAFF: every staff member with orders:view sees it — nobody without it", async () => {
    const a = await staffWith(READ_ONLY_WORKER);
    const b = await staffWith(["orders:view"]);
    const c = await staffWith(["customers:view"]);
    const { orderId } = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" });
    expect(await getOrderDetails(db, a, orderId)).not.toBeNull();
    expect(await getOrderDetails(db, b, orderId)).not.toBeNull();
    await expect(getOrderDetails(db, c, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listCustomers(db, c, {})).items[0]!.orderCount).toBeNull();
    // orders:view alone does not reveal production (needs production:view).
    await expect(getOrderProduction(db, b, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a staff member's own new order is visible to them only; staff can't set visibility", async () => {
    const desk = await staffWith(PERMISSION_PRESETS.find((p) => p.key === "front-desk")!.permissions);
    const other = await staffWith(PERMISSION_PRESETS.find((p) => p.key === "front-desk")!.permissions);
    const { orderId } = await createOrder(db, desk, payload());
    expect(await getOrderDetails(db, desk, orderId)).not.toBeNull();
    expect(await getOrderDetails(db, other, orderId)).toBeNull();
    expect((await getOrderAccess(db, owner, orderId))!).toMatchObject({ visibility: "SELECTED_STAFF", userIds: [desk.id] });

    await expect(createOrder(db, desk, payload(), { visibility: "ALL_AUTHORIZED_STAFF" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateOrderAccess(db, desk, { orderId, access: { visibility: "ALL_AUTHORIZED_STAFF" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAssignableStaff(db, desk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const d = (await getOrderDetails(db, desk, orderId))!;
    await expect(
      updateOrder(db, desk, { orderId, expectedUpdatedAt: d.updatedAt } as never, { visibility: "ALL_AUTHORIZED_STAFF" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("archived orders stay out of reach for staff without the archive permission", async () => {
    const worker = await staffWith(READ_ONLY_WORKER);
    const { orderId } = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" }, { advance: "0" });
    await archiveOrder(db, owner, { orderId, reason: "اتسجل مرتين" });
    expect(await getOrderDetails(db, worker, orderId)).toBeNull();
    expect((await listOrders(db, worker, {})).total).toBe(0);
    await expect(listOrders(db, worker, { status: "archived" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getOrderDetails(db, owner, orderId)).not.toBeNull();
  });

  // ─── Financial documents ───

  it("staff can't reach financial PDFs; with the grant they still only get orders they may see", async () => {
    const worker = await staffWith(READ_ONLY_WORKER);
    const shared = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" });
    const hidden = await ownerOrder(undefined, { customer: { mode: "existing", id: shared.customerId } } as Partial<CreateOrderPayload>);
    await expect(getOrderInvoiceData(db, worker, shared.orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCustomerStatement(db, worker, shared.customerId, {})).rejects.toMatchObject({ code: "FORBIDDEN" });

    const accountant = await staffWith(["orders:view", "orders:view-prices", "payments:view", "customers:view", "customers:view-contact", "documents:customer-financial"]);
    expect(await getOrderInvoiceData(db, accountant, shared.orderId)).not.toBeNull();
    expect(await getOrderInvoiceData(db, accountant, hidden.orderId)).toBeNull();
    const statement = (await getCustomerStatement(db, accountant, shared.customerId, {}))!;
    expect(statement.statement.closing).toBe((await getCustomerStatement(db, owner, shared.customerId, {}))!.statement.closing / 2n);
  });

  it("customer phones need their own permission, also in search", async () => {
    const noContact = await staffWith(["customers:view"]);
    await ownerOrder();
    expect((await searchCustomers(db, noContact, "محمود"))[0]).toMatchObject({ name: "محمود", phone: null });
    expect(await searchCustomers(db, noContact, "0101234")).toEqual([]);
    expect((await listCustomers(db, noContact, {})).items[0]!.phone).toBeNull();
    const withContact = await staffWith(["customers:view", "customers:view-contact"]);
    expect((await searchCustomers(db, withContact, "0101234"))[0]!.phone).toBe("01012345678");
  });

  it("staff granted the monthly money summary don't get the owner's accounting reports", async () => {
    const s = await staffWith(["finance:view-summary"]);
    const card = await getFinanceDashboard(db, s);
    expect(card.supplierOutstanding).toBeNull();
    expect(card.expensesThisMonth).toBeNull();
    await expect(getCashFlow(db, s, { from: TODAY, to: TODAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getFinanceDashboard(db, owner)).supplierOutstanding).toBe("0.00");
  });

  // ─── Owner management ───

  it("only the owner manages permissions; nobody edits their own account or an owner; bad sets are refused", async () => {
    const staff = await staffWith(["orders:view"]);
    await expect(listAccounts(db, staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAccount(db, staff, staff.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaffPermissions(db, staff, { userId: staff.id, permissions: ["orders:view", "orders:view-prices"], expectedVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeStaffSessions(db, staff, { userId: staff.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setStaffActive(db, staff, { userId: staff.id, active: true, expectedVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(updateStaffPermissions(db, owner, { userId: owner.id, permissions: [], expectedVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const owner2 = await createTestUser(db, "OWNER_ADMIN");
    await expect(updateStaffPermissions(db, owner, { userId: owner2.id, permissions: [], expectedVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setStaffActive(db, owner, { userId: owner2.id, active: false, expectedVersion: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(updateStaffPermissions(db, owner, { userId: staff.id, permissions: ["users:manage"], expectedVersion: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateStaffPermissions(db, owner, { userId: staff.id, permissions: ["deliveries:record"], expectedVersion: 0 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateStaffPermissions(db, owner, { userId: staff.id, permissions: ["orders:view"], expectedVersion: 7 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await fresh(staff)).permissions).toEqual(["orders:view"]);
  });

  it("permission changes apply on the very next request, are audited, and can sign the account out", async () => {
    const staff = await staffWith(READ_ONLY_WORKER);
    const { orderId } = await ownerOrder({ visibility: "ALL_AUTHORIZED_STAFF" });
    const token = generateSessionToken();
    await db.session.create({ data: { tokenHash: hashSessionToken(token), userId: staff.id, expiresAt: new Date(Date.now() + 86_400_000) } });

    const before = (await validateSessionToken(db, token))!.user;
    expect(await getOrderDetails(db, before, orderId)).not.toBeNull();

    // Grant prices: visible next request.
    await updateStaffPermissions(db, owner, { userId: staff.id, permissions: [...READ_ONLY_WORKER, "orders:view-prices"], expectedVersion: 0 });
    expect((await getOrderDetails(db, (await validateSessionToken(db, token))!.user, orderId))!.money).not.toBeNull();

    // Revoke order access: the same session is refused at once.
    await updateStaffPermissions(db, owner, { userId: staff.id, permissions: [], expectedVersion: 1 });
    const after = (await validateSessionToken(db, token))!.user;
    expect(after.permissions).toEqual([]);
    await expect(getOrderDetails(db, after, orderId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Optional sign-out everywhere with a change.
    await updateStaffPermissions(db, owner, { userId: staff.id, permissions: ["orders:view"], expectedVersion: 2, revokeSessions: true });
    expect(await validateSessionToken(db, token)).toBeNull();

    const audit = await db.auditLog.findMany({ where: { entityId: staff.id, action: "USER_PERMISSIONS_CHANGED" }, orderBy: { createdAt: "asc" } });
    expect(audit).toHaveLength(3);
    expect(audit[0]!.userId).toBe(owner.id);
    expect(audit[1]!.metadata).toMatchObject({ removed: ["orders:view", "orders:view-prices", "production:view", "deliveries:view"], reduced: true });
  });

  it("deactivation blocks the account and ends its sessions; reactivation keeps its permissions", async () => {
    const staff = await staffWith(READ_ONLY_WORKER);
    const token = generateSessionToken();
    await db.session.create({ data: { tokenHash: hashSessionToken(token), userId: staff.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const r = await setStaffActive(db, owner, { userId: staff.id, active: false, expectedVersion: 0 });
    expect(r.sessionsRevoked).toBe(1);
    expect(await validateSessionToken(db, token)).toBeNull();
    expect(await listAssignableStaff(db, owner)).toEqual([]);
    await setStaffActive(db, owner, { userId: staff.id, active: true, expectedVersion: 1 });
    expect((await fresh(staff)).permissions).toEqual(READ_ONLY_WORKER);
    expect(await db.auditLog.count({ where: { entityId: staff.id, action: { in: ["USER_DEACTIVATED", "USER_ACTIVATED"] } } })).toBe(2);
  });

  // ─── Integrity ───

  it("visibility and permission changes never touch totals, payments, production or deliveries", async () => {
    const worker = await staffWith(READ_ONLY_WORKER);
    const { orderId, groupId } = await ownerOrder();
    await recordStageProgress(db, owner, { orderId, orderGroupId: groupId, operation: "DTF", quantity: "40", workDate: TODAY, idempotencyKey: randomUUID(), alsoReady: true });
    await recordDelivery(db, owner, { orderId, orderGroupId: groupId, quantity: "15", deliveredAt: TODAY, idempotencyKey: randomUUID() });
    const snapshot = async () => {
      const [o, payments, stages, ready, deliveries, groups] = await Promise.all([
        db.order.findUniqueOrThrow({ where: { id: orderId }, select: { totalPrice: true, status: true, quantity: true, pricing: true } }),
        db.orderPayment.findMany({ where: { orderId }, select: { id: true, amount: true, voidedAt: true } }),
        db.productionStageProgress.findMany({ where: { orderId }, select: { id: true, quantity: true } }),
        db.productionReady.findMany({ where: { orderId }, select: { id: true, quantity: true } }),
        db.delivery.findMany({ where: { orderId }, select: { id: true, quantity: true } }),
        db.orderGroup.findMany({ where: { orderId }, select: { id: true, unitPrice: true, designs: { select: { id: true } }, sizes: { select: { id: true } } } }),
      ]);
      return JSON.stringify({ o, payments, stages, ready, deliveries, groups });
    };
    const before = await snapshot();
    await share(orderId, "SELECTED_STAFF", [worker.id]);
    await share(orderId, "ALL_AUTHORIZED_STAFF");
    await updateStaffPermissions(db, owner, { userId: worker.id, permissions: ["orders:view"], expectedVersion: 0 });
    await share(orderId, "PRIVATE");
    expect(await snapshot()).toBe(before);
    expect((await getOrderDetails(db, owner, orderId))!.money).toEqual({ totalPrice: "13750.00", paid: "4321.00", outstanding: "9429.00" });
  });

  it("owner creates staff accounts and resets passwords from the browser — re-authenticated, rate limited, audited", async () => {
    await db.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword("owner-secret-1") } });
    const base = { name: "علي", email: "Ali@Benuuprint.test", password: "staff-pass-1" };

    await expect(createStaffAccount(db, owner, { ...base, ownerPassword: "wrong" })).rejects.toMatchObject({ fieldErrors: { ownerPassword: expect.any(Array) } });
    const { userId } = await createStaffAccount(db, owner, { ...base, ownerPassword: "owner-secret-1" });
    const created = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(created).toMatchObject({ role: "STAFF", email: "ali@benuuprint.test", permissions: [], isActive: true });
    await expect(createStaffAccount(db, owner, { ...base, ownerPassword: "owner-secret-1" })).rejects.toMatchObject({ code: "CONFLICT" });

    // Staff can never create accounts or reset passwords.
    const staff = await staffWith(["orders:view"]);
    await expect(createStaffAccount(db, staff, { ...base, email: "x@benuuprint.test", ownerPassword: "owner-secret-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resetStaffPassword(db, staff, { userId, password: "new-pass-123", ownerPassword: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Reset signs the account out everywhere.
    await db.session.create({ data: { tokenHash: hashSessionToken(generateSessionToken()), userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    expect((await resetStaffPassword(db, owner, { userId, password: "new-pass-123", ownerPassword: "owner-secret-1" })).sessionsRevoked).toBe(1);
    expect(await verifyPassword((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash, "new-pass-123")).toBe(true);
    await expect(resetStaffPassword(db, owner, { userId: owner.id, password: "new-pass-123", ownerPassword: "owner-secret-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Repeated wrong owner passwords lock re-authentication.
    for (let i = 0; i < 4; i++) await expect(createStaffAccount(db, owner, { ...base, email: `t${i}@benuuprint.test`, ownerPassword: "nope" })).rejects.toBeTruthy();
    await expect(createStaffAccount(db, owner, { ...base, email: "t9@benuuprint.test", ownerPassword: "owner-secret-1" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await db.auditLog.count({ where: { userId: owner.id, action: "USER_CREATED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: owner.id, action: "OWNER_REAUTH_FAILED" } })).toBe(5);
  });
});
