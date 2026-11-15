import { describe, expect, it } from "vitest";
import { buildStatement, orderBalance, totalsFor, type DocOrder, type DocPayment } from "@/lib/documents/customer-account";
import { ltr, visualRuns, wrapLogical } from "@/server/documents/pdf/arabic-text";

// ───────────── Arabic / RTL text ─────────────

/** Visual string as a left-to-right reader of the drawn glyphs would see it (Arabic runs reversed like fontkit does). */
const drawn = (line: string) =>
  visualRuns(line)
    .map((r) => (/\p{Script=Arabic}/u.test(r.text) ? [...r.text].reverse().join("") : r.text))
    .join("");

describe("visualRuns (bidi for PDF)", () => {
  it("keeps numbers left-to-right inside Arabic text and puts them in visual order", () => {
    const runs = visualRuns("الإجمالي: 40,000.50 ج.م");
    expect(runs.map((r) => r.text)).toEqual([" ج.م", "40,000.50", "الإجمالي: "]);
    expect(runs.map((r) => r.rtl)).toEqual([true, false, true]);
  });

  it("keeps Latin words and order numbers intact", () => {
    const runs = visualRuns("العميل: Ahmed Store - فرع 2");
    expect(runs.map((r) => r.text)).toContain("Ahmed Store");
    expect(runs.find((r) => r.text.includes("2"))?.rtl).toBe(false);
    // A bare "#0012" after Arabic letters follows the bidi rules (the "#" joins the
    // Arabic side, as in browsers); wrapped with ltr() it stays one unit and the
    // isolate marks themselves are never drawn.
    expect(visualRuns(`أوردر ${ltr("#0012")}`).map((r) => r.text)).toEqual(["#0012", "أوردر "]);
  });

  it("mirrors brackets in RTL runs so they enclose the text correctly", () => {
    // In visual left-to-right order an RTL "(لوجو)" must read "(…)" from the left.
    expect(drawn("تطريز (لوجو)")).toBe("(وجول) زيرطت");
  });

  it("returns a single LTR run for Latin-only text and nothing for empty text", () => {
    expect(visualRuns("S: 10 · M: 20")).toEqual([{ text: "S: 10 · M: 20", rtl: false }]);
    expect(visualRuns("")).toEqual([]);
  });

  it("wraps on words, breaks over-long words, and keeps blank lines", () => {
    const measure = (s: string) => s.length;
    expect(wrapLogical("واحد اتنين تلاتة", 10, measure)).toEqual(["واحد اتنين", "تلاتة"]);
    expect(wrapLogical("abcdefghijkl", 5, measure)).toEqual(["abcde", "fghij", "kl"]);
    expect(wrapLogical("أ\n\nب", 10, measure)).toEqual(["أ", "", "ب"]);
  });
});

// ───────────── Customer money rules ─────────────

let seq = 0;
const pay = (amount: bigint, paidAt: string, extra: Partial<DocPayment> = {}): DocPayment => ({
  id: `p${++seq}`,
  amount,
  paidAt,
  method: "CASH",
  isAdvance: false,
  createdAt: new Date(`${paidAt}T09:00:${String(seq % 60).padStart(2, "0")}Z`),
  ...extra,
});
const order = (number: number, totalPrice: bigint, receivedDate: string, payments: DocPayment[] = [], status: DocOrder["status"] = "IN_PROGRESS"): DocOrder => ({
  id: `o${number}`,
  number,
  title: `أوردر ${number}`,
  productType: "تيشيرت",
  status,
  totalPrice,
  receivedDate,
  payments,
});

describe("orderBalance", () => {
  it("outstanding = agreed − valid payments, exact to the piaster", () => {
    expect(orderBalance(order(1, 4_250_050n, "2026-11-01", [pay(1_500_000n, "2026-11-01"), pay(750_000n, "2026-11-02")]))).toEqual({
      cancelled: false,
      charged: 4_250_050n,
      paid: 2_250_000n,
      outstanding: 2_000_050n,
      overpaid: 0n,
      paidOnCancelled: 0n,
    });
  });

  it("over-payment is a credit, never a negative outstanding", () => {
    const b = orderBalance(order(1, 100_00n, "2026-11-01", [pay(125_00n, "2026-11-01")]));
    expect(b.outstanding).toBe(0n);
    expect(b.overpaid).toBe(25_00n);
  });

  it("a cancelled order is not owed; money paid on it needs a decision", () => {
    const b = orderBalance(order(1, 5_000_00n, "2026-11-01", [pay(500_00n, "2026-11-01")], "CANCELLED"));
    expect(b).toMatchObject({ cancelled: true, charged: 0n, outstanding: 0n, paidOnCancelled: 500_00n });
  });
});

describe("totalsFor", () => {
  it("matches the customer screen (net over active orders) and reports credits and cancelled payments separately", () => {
    const t = totalsFor([
      order(1, 1_000_00n, "2026-10-01", [pay(400_00n, "2026-10-01")]),
      order(2, 500_00n, "2026-10-05", [pay(600_00n, "2026-10-05")]),
      order(3, 9_999_00n, "2026-10-09", [pay(300_00n, "2026-10-09")], "CANCELLED"),
      order(4, 200_00n, "2026-10-12"),
    ]);
    expect(t).toEqual({
      activeCount: 3,
      cancelledCount: 1,
      agreed: 1_700_00n,
      paid: 1_000_00n,
      net: 700_00n,
      outstanding: 800_00n,
      overpaid: 100_00n,
      paidOnCancelled: 300_00n,
    });
  });

  it("is all zeros for no orders", () => {
    expect(totalsFor([])).toMatchObject({ activeCount: 0, agreed: 0n, paid: 0n, net: 0n });
  });
});

describe("buildStatement", () => {
  const orders = [
    order(1, 1_000_00n, "2026-09-10", [pay(1_000_00n, "2026-09-20", { isAdvance: true })]),
    order(2, 2_000_00n, "2026-10-01", [pay(500_00n, "2026-10-01", { isAdvance: true }), pay(700_00n, "2026-10-15")]),
    order(3, 3_000_00n, "2026-10-03", [pay(400_00n, "2026-10-03")], "CANCELLED"),
    order(4, 900_00n, "2026-11-05"),
  ];

  it("charges each active order once and credits each valid payment once, in date order with a running balance", () => {
    const s = buildStatement(orders, {});
    expect(s.entries.map((e) => [e.date, e.kind, e.orderNumber, e.debit, e.credit, e.balance])).toEqual([
      ["2026-09-10", "charge", 1, 1_000_00n, 0n, 1_000_00n],
      ["2026-09-20", "payment", 1, 0n, 1_000_00n, 0n],
      ["2026-10-01", "charge", 2, 2_000_00n, 0n, 2_000_00n],
      ["2026-10-01", "payment", 2, 0n, 500_00n, 1_500_00n],
      ["2026-10-03", "payment", 3, 0n, 400_00n, 1_100_00n],
      ["2026-10-15", "payment", 2, 0n, 700_00n, 400_00n],
      ["2026-11-05", "charge", 4, 900_00n, 0n, 1_300_00n],
    ]);
    // Advance payments appear exactly once (no double count).
    expect(s.entries.filter((e) => e.isAdvance)).toHaveLength(2);
    expect(s.totalDebit).toBe(3_900_00n);
    expect(s.totalCredit).toBe(2_600_00n);
    expect(s.closing).toBe(1_300_00n);
    expect(s.paidOnCancelledToDate).toBe(400_00n);
    expect(s.entries.find((e) => e.orderNumber === 3)?.onCancelledOrder).toBe(true);
  });

  it("closing = screen net − payments on cancelled orders", () => {
    const s = buildStatement(orders, {});
    expect(s.closing).toBe(totalsFor(orders).net - totalsFor(orders).paidOnCancelled);
  });

  it("derives the opening balance from entries before the period and excludes later ones", () => {
    const s = buildStatement(orders, { from: "2026-10-01", to: "2026-10-31" });
    expect(s.opening).toBe(0n);
    expect(s.entries.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-01", "2026-10-03", "2026-10-15"]);
    expect(s.closing).toBe(400_00n);
    expect(s.entries.at(-1)?.balance).toBe(s.closing);

    const later = buildStatement(orders, { from: "2026-10-02" });
    expect(later.opening).toBe(1_500_00n);
    expect(later.entries[0]?.balance).toBe(1_500_00n - 400_00n);
    expect(later.closing).toBe(later.opening + later.totalDebit - later.totalCredit);
  });

  it("an empty period still carries the opening balance", () => {
    const s = buildStatement(orders, { from: "2027-01-01" });
    expect(s.entries).toEqual([]);
    expect(s.opening).toBe(1_300_00n);
    expect(s.closing).toBe(1_300_00n);
  });
});
