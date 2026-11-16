import { describe, expect, it } from "vitest";
import { createOrderSchema, type CreateOrderPayload } from "@/lib/validations/order";

const base = {
  idempotencyKey: "0192f3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
  customer: { mode: "new" as const, name: "AUC" },
  title: "AUC Graduation",
  productType: "تيشيرت",
  material: "قطن",
  unit: "PIECE" as const,
  advance: "",
  receivedDate: "2026-11-10",
  deliveryDate: "2026-11-30",
  pricing: "items" as const,
};
const design = (o: Record<string, unknown> = {}) => ({ operation: "DTF", placements: [], customPlacements: [], ...o });
const item = (o: Record<string, unknown> = {}) => ({ name: "بند", quantity: "200", unitPrice: "25", operations: [], plain: false, designs: [design()], ...o });
const parse = (o: Partial<CreateOrderPayload> & Record<string, unknown>) => createOrderSchema.safeParse({ ...base, ...o });
const ok = (o: Partial<CreateOrderPayload> & Record<string, unknown>) => {
  const r = parse(o);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.map((i) => [i.path.join("."), i.message])));
  return r.data;
};
const issues = (o: Partial<CreateOrderPayload> & Record<string, unknown>) => {
  const r = parse(o);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("item pricing", () => {
  it("single item: total = quantity × unit price", () => {
    const d = ok({ groups: [item({ quantity: "40", unitPrice: "125.50" })] });
    expect(d.quantity).toBe(40);
    expect(d.totalPrice).toBe(502_000n); // 40 × 125.50 = 5,020.00
    expect(d.groups[0]!.unitPrice).toBe(12_550n);
  });

  it("AUC: 600 pieces in three 200-piece items at 25 / 35 / 40 → 20,000", () => {
    const d = ok({
      groups: [
        item({ name: "رسمة الجامعة", unitPrice: "25", designs: [design({ pressesPerUnit: "2" })] }),
        item({ name: "رسمة الخريجين", unitPrice: "35", designs: [design({ operation: "SCREEN_PRINT" })] }),
        item({ name: "رسمة الدفعة", unitPrice: "40", designs: [design({ operation: "DTF" }), design({ operation: "EMBROIDERY" })] }),
      ],
    });
    expect(d.quantity).toBe(600);
    expect(d.totalPrice).toBe(2_000_000n);
    expect(d.groups.map((g) => g.quantity)).toEqual([200, 200, 200]);
    expect(d.groups[2]!.operations).toEqual(["DTF", "EMBROIDERY"]);
  });

  it("stays exact to the piaster", () => {
    expect(ok({ groups: [item({ quantity: "3", unitPrice: "33.33" }), item({ quantity: "7", unitPrice: "0.01" })] }).totalPrice).toBe(10_006n);
    expect(ok({ groups: [item({ quantity: "999999", unitPrice: "1.99" })] }).totalPrice).toBe(198_999_801n);
  });

  it("ignores a total sent by the browser", () => {
    expect(ok({ totalPrice: "1", groups: [item({ quantity: "10", unitPrice: "50" })] }).totalPrice).toBe(50_000n);
  });

  it("requires a name and a valid unit price per item, and a total above zero", () => {
    const e = issues({ groups: [item({ name: "", unitPrice: "" }), item({ unitPrice: "abc" })] });
    expect(e["groups.0.name"]).toMatch(/اسم البند/);
    expect(e["groups.0.unitPrice"]).toMatch(/سعر القطعة/);
    expect(e["groups.1.unitPrice"]).toMatch(/بالأرقام/);
    expect(issues({ groups: [item({ unitPrice: "0" })] }).totalPrice).toMatch(/أكبر من صفر/);
  });

  it("order-total pricing (older orders) keeps the typed total and needs it", () => {
    const d = ok({ pricing: "order", totalPrice: "40000", groups: [{ quantity: "100", operations: ["DTF"], plain: false }] });
    expect(d.totalPrice).toBe(4_000_000n);
    expect(d.groups[0]!.unitPrice).toBeNull();
    expect(issues({ pricing: "order", groups: [{ quantity: "100", operations: ["DTF"], plain: false }] }).totalPrice).toMatch(/إجمالي سعر/);
  });

  it("an advance above the computed total is refused", () => {
    expect(issues({ advance: "5001", groups: [item({ quantity: "200", unitPrice: "25" })] }).advance).toMatch(/المقدم/);
  });
});

describe("designs and placements", () => {
  it("one design, one placement; and several placements with custom ones", () => {
    const d = ok({
      groups: [item({ designs: [design({ name: "لوجو", placements: ["CHEST"] }), design({ name: "ضهر", operation: "SCREEN_PRINT", placements: ["BACK", "LEFT_SLEEVE"], customPlacements: ["تحت الرقبة", " ", "تحت الرقبة"] })] })],
    });
    const [a, b] = d.groups[0]!.designs;
    expect(a).toMatchObject({ name: "لوجو", operation: "DTF", placements: ["CHEST"], customPlacements: [], quantity: 200 });
    expect(b).toMatchObject({ placements: ["BACK", "LEFT_SLEEVE"], customPlacements: ["تحت الرقبة"] });
  });

  it("design quantities are work on the same pieces: never added to the physical quantity", () => {
    const d = ok({ groups: [item({ quantity: "200", designs: [design({ placements: ["CHEST"] }), design({ placements: ["BACK"], quantity: "150" }), design({ placements: ["BADGE"], quantity: "50" })] })] });
    expect(d.quantity).toBe(200);
    expect(d.groups[0]!.quantity).toBe(200);
    expect(d.groups[0]!.designs.map((x) => x.quantity)).toEqual([200, 150, 50]);
    // Same operation twice → the item requires DTF once.
    expect(d.groups[0]!.operations).toEqual(["DTF"]);
  });

  it("a design can't exceed the item, and must be positive", () => {
    const e = issues({ groups: [item({ quantity: "100", designs: [design({ quantity: "101" }), design({ quantity: "0" })] })] });
    expect(e["groups.0.designs.0.quantity"]).toMatch(/أكتر من كمية البند/);
    expect(e["groups.0.designs.1.quantity"]).toMatch(/عدد القطع/);
  });

  it("planned presses: explicit zero is allowed, out-of-range refused", () => {
    const d = ok({ groups: [item({ designs: [design({ pressesPerUnit: "0" }), design({ operation: "EMBROIDERY", pressesPerUnit: "" })] })] });
    expect(d.groups[0]!.designs.map((x) => x.pressesPerUnit)).toEqual([0, null]);
    expect(issues({ groups: [item({ designs: [design({ pressesPerUnit: "101" })] })] })["groups.0.designs.0.pressesPerUnit"]).toMatch(/الكبسات/);
  });

  it("refuses unknown placement codes and «بدون طباعة» together with designs", () => {
    expect(parse({ groups: [item({ designs: [design({ placements: ["POCKET"] })] })] }).success).toBe(false);
    expect(issues({ groups: [item({ plain: true })] })["groups.0.operations"]).toMatch(/رسومات/);
  });

  it("an item without designs keeps item-level operations (older items) and may be plain", () => {
    const d = ok({ groups: [item({ designs: [], operations: ["EMBROIDERY"] }), item({ designs: [], plain: true, operations: [] })] });
    expect(d.groups.map((g) => g.operations)).toEqual([["EMBROIDERY"], []]);
  });
});
