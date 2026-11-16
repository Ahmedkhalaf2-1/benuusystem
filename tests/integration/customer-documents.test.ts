import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { todayDateString } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import type { CreateOrderPayload } from "@/lib/validations/order";
import { renderOrderInvoice, renderOrdersSummary, renderStatement } from "@/server/documents/customer-documents";
import { pdfResponse } from "@/server/documents/pdf-response";
import type { Actor } from "@/server/services/actor";
import { getCustomerDetails } from "@/server/services/customer-service";
import {
  getCustomerOrdersSummary,
  getCustomerStatement,
  getOrderInvoiceData,
  parsePeriod,
} from "@/server/services/customer-documents-service";
import { createOrder, getOrderDetails, updateOrder } from "@/server/services/order-service";
import { recordPayment, voidPayment } from "@/server/services/payment-service";
import { createTestPrisma, createTestUser, hasTestDatabase, migrateTestDatabase, resetDatabase } from "../support/test-db";

const TODAY = todayDateString();
const money = centsToDecimalString;

describe.skipIf(!hasTestDatabase)("customer PDF documents (PostgreSQL)", () => {
  let db: PrismaClient;
  let owner: Actor;
  let staff: Actor;
  let customerId: string;
  let mainOrder: string;
  let cancelledOrder: string;

  beforeAll(async () => {
    migrateTestDatabase();
    db = createTestPrisma();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const payload = (o: Partial<CreateOrderPayload>): CreateOrderPayload => ({
    idempotencyKey: randomUUID(),
    customer: { mode: "existing", id: customerId },
    title: "تيشيرتات (لوجو أمامي) DTF",
    productType: "تيشيرت",
    material: "قطن",
    quantity: "60",
    unit: "PIECE",
    groups: [{ operations: ["DTF", "EMBROIDERY"], plain: false }],
    totalPrice: "10000.50",
    advance: "0",
    advanceMethod: "CASH",
    receivedDate: TODAY,
    deliveryDate: "2099-12-31",
    ...o,
  });

  beforeEach(async () => {
    await resetDatabase(db);
    owner = await createTestUser(db, "OWNER_ADMIN");
    staff = await createTestUser(db, "STAFF");
    const first = await createOrder(db, staff, {
      ...payload({ advance: "3000", advanceMethod: "INSTAPAY" }),
      customer: { mode: "new", name: "شركة النور Stars", phone: "01001234567" },
      sizesEnabled: true,
      groups: [
        { operations: ["DTF"], plain: false, quantity: "40", material: "قطن أبيض", sizes: [{ label: "M", quantity: "15" }, { label: "XL", quantity: "25" }] },
        { operations: ["EMBROIDERY"], plain: false, quantity: "20", material: "بولو", sizes: [{ label: "L", quantity: "20" }] },
      ],
    } as CreateOrderPayload);
    mainOrder = first.orderId;
    customerId = (await db.order.findUniqueOrThrow({ where: { id: mainOrder } })).customerId;
    await recordPayment(db, staff, { orderId: mainOrder, idempotencyKey: randomUUID(), amount: "2000", paidAt: TODAY, method: "CASH" });
    const wrong = await recordPayment(db, staff, { orderId: mainOrder, idempotencyKey: randomUUID(), amount: "999", paidAt: TODAY, method: "CASH" });
    await voidPayment(db, owner, { paymentId: wrong.paymentId, reason: "اتسجلت غلط" });

    // Fully paid by its advance. (Over-payment can't be recorded — the app refuses
    // a payment above what is still owed; over-payment rules are unit-tested.)
    await createOrder(db, staff, payload({ totalPrice: "500", advance: "500" }));

    // Cancelled order with 700 paid on it. The app refuses to cancel an order that
    // still has valid payments, so this can only exist in older data; the
    // documents must still handle it. Cancel it unpaid, then add the payment row.
    const c = await createOrder(db, staff, payload({ totalPrice: "4000" }));
    cancelledOrder = c.orderId;
    const d = await getOrderDetails(db, owner, c.orderId);
    await updateOrder(db, owner, {
      orderId: c.orderId,
      expectedUpdatedAt: d!.updatedAt,
      customer: { mode: "existing", id: customerId },
      title: d!.title,
      productType: d!.productType,
      material: d!.material,
      quantity: String(d!.quantity),
      unit: d!.unit,
      groups: d!.groups.map((g) => ({ id: g.id, quantity: String(g.quantity), material: g.material, operations: g.operations, plain: g.operations.length === 0, notes: "" })),
      totalPrice: d!.money!.totalPrice,
      receivedDate: d!.receivedDate,
      deliveryDate: d!.deliveryDate,
      notes: "",
      status: "CANCELLED",
    });
    await db.orderPayment.create({
      data: { orderId: c.orderId, amount: "700", paidAt: new Date(`${TODAY}T00:00:00Z`), method: "CASH", isAdvance: true, idempotencyKey: randomUUID(), recordedById: staff.id },
    });
  });

  it("invoice figures equal the order screen; voided payments are excluded", async () => {
    const inv = (await getOrderInvoiceData(db, owner, mainOrder))!;
    const screen = (await getOrderDetails(db, owner, mainOrder))!;
    expect(money(inv.order.totalPrice)).toBe(screen.money!.totalPrice);
    expect(money(inv.balance.paid)).toBe(screen.money!.paid);
    expect(money(inv.balance.outstanding)).toBe(screen.money!.outstanding);
    expect(money(inv.balance.paid)).toBe("5000.00");
    expect(money(inv.balance.outstanding)).toBe("5000.50");
    expect(inv.order.payments).toHaveLength(2);
    expect(inv.order.payments.filter((p) => p.isAdvance)).toHaveLength(1);
    expect(inv.voidedPayments).toBe(1);
    expect(inv.groups.map((g) => g.sizes.map((s) => `${s.label}:${s.quantity}`).join(","))).toEqual(["M:15,XL:25", "L:20"]);
    // No internal money ever reaches the document data.
    expect(JSON.stringify(inv, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/cost|wage|supplier|labor|profit/i);
  });

  it("cancelled order: nothing owed, payment flagged for a decision", async () => {
    const inv = (await getOrderInvoiceData(db, owner, cancelledOrder))!;
    expect(inv.balance).toMatchObject({ cancelled: true, outstanding: 0n, paidOnCancelled: 70_000n });
  });

  it("orders summary totals equal the customer screen totals", async () => {
    const summary = (await getCustomerOrdersSummary(db, owner, customerId, {}))!;
    const screen = (await getCustomerDetails(db, owner, customerId))!;
    expect(money(summary.totals.agreed)).toBe(screen.totals!.agreed);
    expect(money(summary.totals.paid)).toBe(screen.totals!.paid);
    expect(money(summary.totals.net)).toBe(screen.totals!.outstanding);
    expect(summary.totals).toMatchObject({ activeCount: 2, cancelledCount: 1, agreed: 1_050_050n, paid: 550_000n, overpaid: 0n, paidOnCancelled: 70_000n, outstanding: 500_050n });
    expect(summary.orders).toHaveLength(3);
  });

  it("statement: every valid payment once, closing = screen outstanding − money on cancelled orders", async () => {
    const st = (await getCustomerStatement(db, owner, customerId, {}))!;
    const screen = (await getCustomerDetails(db, owner, customerId))!;
    const s = st.statement;
    expect(s.entries.filter((e) => e.kind === "charge")).toHaveLength(2);
    expect(s.entries.filter((e) => e.kind === "payment")).toHaveLength(4); // 3000 adv + 2000 + 500 adv + 700 (cancelled); voided 999 excluded
    expect(money(s.totalCredit)).toBe("6200.00");
    expect(money(s.closing + s.paidOnCancelledToDate)).toBe(screen.totals!.outstanding);
    expect(st.cancelledOrders).toEqual([expect.objectContaining({ paid: 70_000n })]);
  });

  it("periods: future range is empty, opening balance carries everything before it", async () => {
    const future = (await getCustomerOrdersSummary(db, owner, customerId, { from: "2099-01-01" }))!;
    expect(future.orders).toEqual([]);
    const st = (await getCustomerStatement(db, owner, customerId, { from: "2099-01-01" }))!;
    expect(st.statement.entries).toEqual([]);
    expect(st.statement.closing).toBe(st.statement.opening);
    expect(parsePeriod({ from: "2026-12-31", to: "2026-01-01" })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(() => parsePeriod({ from: "2026-02-30" })).toThrow();
  });

  it("only the owner can produce customer documents; unknown or malformed ids give nothing", async () => {
    await expect(getOrderInvoiceData(db, staff, mainOrder)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCustomerOrdersSummary(db, staff, customerId, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCustomerStatement(db, staff, customerId, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getOrderInvoiceData(db, owner, randomUUID())).toBeNull();
    expect(await getOrderInvoiceData(db, owner, "../../etc/passwd")).toBeNull();
    expect(await getCustomerStatement(db, owner, "1 OR 1=1", {})).toBeNull();
  });

  it("renders real PDFs (multi-page when long) and serves them privately", async () => {
    const invoice = await renderOrderInvoice((await getOrderInvoiceData(db, owner, mainOrder))!);
    const summary = await renderOrdersSummary((await getCustomerOrdersSummary(db, owner, customerId, {}))!);
    const statement = await renderStatement((await getCustomerStatement(db, owner, customerId, {}))!);
    for (const pdf of [invoice, summary, statement]) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.subarray(-6).toString()).toContain("%%EOF");
    }

    // 60 more orders force several pages.
    for (let i = 0; i < 60; i++) await createOrder(db, staff, payload({ title: `أوردر رقم ${i}`, totalPrice: "100", advance: "50" }));
    const long = await renderStatement((await getCustomerStatement(db, owner, customerId, {}))!);
    const pages = long.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThan(2);

    const inline = pdfResponse(invoice, new Request("https://x/api/documents/orders/1/invoice"), { arabic: "فاتورة أوردر 0001", ascii: "benuuprint-invoice-0001" });
    expect(inline.headers.get("content-type")).toBe("application/pdf");
    expect(inline.headers.get("cache-control")).toContain("no-store");
    expect(inline.headers.get("cache-control")).toContain("private");
    expect(inline.headers.get("content-disposition")).toMatch(/^inline; filename="benuuprint-invoice-0001-\d{4}-\d{2}-\d{2}\.pdf"; filename\*=UTF-8''/);
    const download = pdfResponse(invoice, new Request("https://x/a?download=1"), { arabic: 'كشف/حساب "x"', ascii: "a b" });
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="a-b-/);
    expect(decodeURIComponent(download.headers.get("content-disposition")!.split("''")[1]!)).not.toMatch(/[/"]/);
  });
});
