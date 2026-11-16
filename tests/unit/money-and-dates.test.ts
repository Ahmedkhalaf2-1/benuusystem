import { describe, expect, it } from "vitest";
import { dateFromString, daysUntil, formatDateAr, isValidDateString, todayDateString } from "@/lib/dates";
import { centsToDecimalString, formatMoney, parseMoney, toCents } from "@/lib/money";
import { normalizeDigits, parseWholeNumber } from "@/lib/numbers";
import { createOrderSchema } from "@/lib/validations/order";

describe("digits", () => {
  it("understands Arabic-Indic and Persian digits and separators", () => {
    expect(normalizeDigits("٤٠٬٠٠٠٫٥")).toBe("40,000.5");
    expect(normalizeDigits("۱۲۳")).toBe("123");
    expect(parseWholeNumber("٢٠٠")).toBe(200);
    expect(parseWholeNumber("1,000")).toBe(1000);
    expect(parseWholeNumber("12.5")).toBeNull();
    expect(parseWholeNumber("-3")).toBeNull();
  });
});

describe("money", () => {
  it("parses typed amounts into exact piasters", () => {
    expect(parseMoney("40000")).toBe(4_000_000n);
    expect(parseMoney("40,000")).toBe(4_000_000n);
    expect(parseMoney("٤٠٬٠٠٠")).toBe(4_000_000n);
    expect(parseMoney("1500.5")).toBe(150_050n);
    expect(parseMoney("0.1")).toBe(10n);
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("adds without floating-point error", () => {
    // 0.1 + 0.2 !== 0.3 in floats; in piasters it is exact.
    expect(centsToDecimalString(parseMoney("0.1")! + parseMoney("0.2")!)).toBe("0.30");
    expect(toCents("100.30") - 3n * toCents("33.43")).toBe(1n);
  });

  it("round-trips through the database decimal format and formats for people", () => {
    expect(centsToDecimalString(4_000_000n)).toBe("40000.00");
    expect(toCents("40000.00")).toBe(4_000_000n);
    expect(toCents("15.5")).toBe(1550n);
    expect(formatMoney(4_000_000n)).toBe("40,000 ج.م");
    expect(formatMoney(150_050n)).toBe("1,500.50 ج.م");
    expect(formatMoney(-500n)).toBe("-5 ج.م");
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("15/11/2026")).toBe(false);
  });

  it("uses Cairo's today and formats in Arabic with Western digits", () => {
    expect(todayDateString(new Date("2026-11-14T23:30:00Z"))).toBe("2026-11-15"); // 01:30 Cairo
    expect(formatDateAr("2026-11-20")).toMatch(/20 نوفمبر 2026/);
    expect(dateFromString("2026-11-20").toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(daysUntil("2026-11-20", new Date("2026-11-15T10:00:00Z"))).toBe(5);
  });
});

describe("order form validation (shared by client and server)", () => {
  const base = {
    idempotencyKey: "0195f3a0-0000-7000-8000-000000000000",
    customer: { mode: "new" as const, name: "محمود" },
    title: "تيشيرتات",
    productType: "تيشيرت",
    material: "قطن",
    quantity: "200",
    unit: "PIECE",
    totalPrice: "40000",
    advance: "",
    receivedDate: "2026-11-15",
    deliveryDate: "2026-11-30",
  };

  it("treats an empty advance as zero and fills single-group quantity", () => {
    const result = createOrderSchema.parse({ ...base, groups: [{ operations: ["DTF", "EMBROIDERY"], plain: false }] });
    expect(result.advance).toBe(0n);
    expect(result.groups).toEqual([
      { id: undefined, name: null, quantity: 200, material: "قطن", operations: ["DTF", "EMBROIDERY"], designs: [], notes: undefined, sizes: [], unitPrice: null, pressesPerUnit: null },
    ]);
    expect(result.quantity).toBe(200);
    expect(result.totalPrice).toBe(4_000_000n);
  });

  it("reports Arabic messages at the right fields", () => {
    const result = createOrderSchema.safeParse({ ...base, title: "", totalPrice: "abc", groups: [{ operations: [], plain: false }] });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["title", "totalPrice"]));
  });
});
