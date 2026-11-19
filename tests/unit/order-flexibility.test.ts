import { describe, expect, it } from "vitest";
import { dateFromString, dateToString, daysBetween, todayDateString } from "@/lib/dates";
import { createOrderSchema, updateOrderSchema, type CreateOrderPayload } from "@/lib/validations/order";

/** Phase 1 rules in the schema shared by the order form (client) and the server. */
const TODAY = todayDateString();
const shift = (n: number) => dateToString(new Date(dateFromString(TODAY).getTime() + n * 86_400_000));

const base: CreateOrderPayload = {
  idempotencyKey: "0192f3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b",
  customer: { mode: "new", name: "Emma" },
  title: "Emma Tourism",
  productType: "تيشيرت",
  unit: "PIECE",
  pricing: "items",
  advance: "",
  receivedDate: TODAY,
  deliveryDate: shift(10),
  groups: [{ name: "تيشيرت", quantity: "10", unitPrice: "100", designs: [{ operation: "DTF" }] }],
};
const issues = (o: Partial<CreateOrderPayload>) => {
  const r = createOrderSchema.safeParse({ ...base, ...o });
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("receipt date", () => {
  it("accepts today and any past day (no lookback limit)", () => {
    expect(issues({})).toEqual({});
    expect(issues({ receivedDate: "2015-01-01", deliveryDate: "2015-01-05" })).toEqual({});
  });

  it("rejects a future receipt date on create", () => {
    expect(issues({ receivedDate: shift(1), deliveryDate: shift(5) })).toEqual({ receivedDate: "تاريخ الاستلام مينفعش يكون في المستقبل" });
  });

  it("edit schema leaves the future check to the service (only a changed date is refused)", () => {
    const r = updateOrderSchema.safeParse({ ...base, orderId: base.idempotencyKey, status: "NEW", receivedDate: shift(1), deliveryDate: shift(5) });
    expect(r.success).toBe(true);
  });
});

describe("advance payment date", () => {
  it("uses the date given, and defaults to today — never the receipt date", () => {
    const given = createOrderSchema.parse({ ...base, receivedDate: shift(-30), advance: "100", advancePaidAt: shift(-3) });
    expect(given.advancePaidAt).toBe(shift(-3));
    const missing = createOrderSchema.parse({ ...base, receivedDate: shift(-30), advance: "100" });
    expect(missing.advancePaidAt).toBe(TODAY);
  });

  it("rejects a future or impossible advance date", () => {
    expect(issues({ advance: "100", advancePaidAt: shift(1) })).toEqual({ advancePaidAt: "تاريخ دفع المقدم مينفعش يكون في المستقبل" });
    expect(issues({ advance: "100", advancePaidAt: "2026-13-01" })).toEqual({ advancePaidAt: "اختار تاريخ دفع المقدم" });
  });
});

describe("optional manufacturing details", () => {
  it("material is optional and stored as an empty string", () => {
    const r = createOrderSchema.parse(base);
    expect(r.material).toBe("");
    expect(r.groups[0]!.material).toBe("");
    expect(createOrderSchema.parse({ ...base, material: "  قطن  " }).groups[0]!.material).toBe("قطن");
  });

  it("a design needs only its work type", () => {
    const r = createOrderSchema.parse(base);
    expect(r.groups[0]!.designs[0]).toMatchObject({ operation: "DTF", name: null, placements: [], quantity: 10, pressesPerUnit: null });
  });

  it("a ready-made item has no work type and keeps its price", () => {
    const r = createOrderSchema.parse({ ...base, groups: [{ name: "هودي", quantity: "4", unitPrice: "450", plain: true, designs: [] }] });
    expect(r.groups[0]).toMatchObject({ name: "هودي", operations: [], designs: [] });
    expect(r.totalPrice).toBe(180_000n);
  });

  it("an item with neither designs nor «بدون» still needs a work type", () => {
    expect(issues({ groups: [{ name: "x", quantity: "1", unitPrice: "1", plain: false, designs: [] }] })).toHaveProperty("groups.0.operations");
  });
});

describe("daysBetween", () => {
  it("counts calendar days between business dates", () => {
    expect(daysBetween("2026-11-01", "2026-11-20")).toBe(19);
    expect(daysBetween("2026-11-20", "2026-11-20")).toBe(0);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });
});
