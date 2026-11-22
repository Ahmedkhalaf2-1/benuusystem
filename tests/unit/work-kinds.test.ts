import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { suggestDepartmentKey } from "@/lib/departments/suggest";
import { formatQuantity, parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { checkLinear, cmToMm, formatMeters, itemLineCents, itemWorkSummary, linearLineCents, metersToMm, variantLabel, WORK_KIND_CONFIG, WORK_KINDS } from "@/lib/orders/work-kinds";
import { draftLinear, itemLineTotal } from "@/components/orders/order-items";
import { newWorkLine } from "@/components/orders/order-draft";
import { createOrderSchema, type CreateOrderPayload } from "@/lib/validations/order";

const orderBase: CreateOrderPayload = { idempotencyKey: "0192f3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b", customer: { mode: "new", name: "x" }, title: "x", productType: "ورق DTF", unit: "PIECE", pricing: "items", receivedDate: "2026-11-01", deliveryDate: "2026-12-01", groups: [] };

describe("linear-meter pricing (file length in meters × copies × price per meter)", () => {
  const line = (meters: string, copies: number, price: bigint) => {
    const r = checkLinear({ fileLengthMm: metersToMm(meters)!, copies });
    if (!r.ok) throw new Error(r.message);
    return { meters: formatMeters(r.billableLengthMm), cents: linearLineCents(r.billableLengthMm, price) };
  };

  it("matches the owner's three mandatory examples", () => {
    expect(line("1", 3, 15_000n)).toEqual({ meters: "3", cents: 45_000n });
    expect(line("0.25", 10, 15_000n)).toEqual({ meters: "2.5", cents: 37_500n });
    expect(line("0.5", 9, 15_000n)).toEqual({ meters: "4.5", cents: 67_500n });
  });

  it("supports decimal lengths without rounding meters to whole numbers", () => {
    expect(line("1.25", 1, 15_000n)).toEqual({ meters: "1.25", cents: 18_750n });
    expect(line("2.75", 2, 15_000n)).toEqual({ meters: "5.5", cents: 82_500n });
    expect(line("0.125", 3, 10_000n)).toEqual({ meters: "0.375", cents: 3_750n });
    expect(line("0.333", 1, 9_999n)).toEqual({ meters: "0.333", cents: 3_330n }); // 33.29667 → 33.30 (half up, piaster)
    expect(checkLinear({ fileLengthMm: 250, copies: 10 })).toEqual({ ok: true, billableLengthMm: 2500 });
  });

  it("asks only for length and copies (no roll, width or per-row inputs)", () => {
    expect(checkLinear({ fileLengthMm: 0, copies: 3 })).toMatchObject({ ok: false, field: "fileLengthMm" });
    expect(checkLinear({ fileLengthMm: 500, copies: 0 })).toMatchObject({ ok: false, field: "copies" });
  });

  it("parses meters exactly (up to 3 decimals, Arabic digits and comma too)", () => {
    expect(metersToMm("1")).toBe(1000);
    expect(metersToMm("0.25")).toBe(250);
    expect(metersToMm(".5")).toBe(500);
    expect(metersToMm("2.75")).toBe(2750);
    expect(metersToMm("٠٫٥")).toBe(500);
    expect(metersToMm("1,25")).toBe(1250);
    expect(metersToMm("0.1234")).toBeNull();
    expect(metersToMm("abc")).toBeNull();
    expect(metersToMm("-1")).toBeNull();
    expect(formatMeters(3000)).toBe("3");
    expect(formatMeters(7000)).toBe("7");
    expect(formatMeters(125)).toBe("0.125");
  });

  it("rounds half up to the piaster and keeps every other item as quantity × unit price", () => {
    expect(linearLineCents(999, 9_999n)).toBe(9_989n); // 99.89001
    expect(linearLineCents(1, 500n)).toBe(1n); // 0.5 piaster → 1
    expect(itemLineCents({ quantity: 3, unitPriceCents: 1_000n })).toBe(3_000n);
    expect(itemLineCents({ quantity: 3, unitPriceCents: 1_000n, pricingBasis: "LINEAR_METER", billableLengthMm: 2500 })).toBe(2_500n);
    expect(itemLineCents({ quantity: 3, unitPriceCents: null })).toBeNull();
  });

  it("keeps the legacy cm parser for the old roll-width setting only", () => {
    expect(cmToMm("70")).toBe(700);
    expect(cmToMm("29.7")).toBe(297);
    expect(cmToMm("1.25")).toBeNull();
  });
});

describe("frontend / backend parity", () => {
  const cases: [string, string, string][] = [
    ["1", "3", "150"], ["0.25", "10", "150"], ["0.5", "9", "150"], ["1.25", "4", "137.50"], ["2.75", "7", "99.99"], ["0.333", "3", "120.01"], ["0.001", "1", "10"],
  ];
  it.each(cases)("length %s m × %s copies × %s/m gives the same line on both sides", (fileLengthM, quantity, unitPrice) => {
    const draft = newWorkLine("DTF_PAPER", { variant: "WHITE_80", fileLengthM, quantity, unitPrice });
    const client = itemLineTotal(draft);
    const server = createOrderSchema.parse({ ...orderBase, groups: [{ workKind: "DTF_PAPER", variant: "WHITE_80", name: "x", quantity, unitPrice, fileLengthM, plain: true, designs: [] }] });
    expect(client).not.toBeNull();
    expect(server.totalPrice).toBe(client);
    expect(draftLinear(draft)).toMatchObject({ ok: true, billableLengthMm: server.groups[0]!.linear!.billableLengthMm });
    expect(server.groups[0]!.linear).toMatchObject({ fileWidthMm: null, copiesPerRow: null, rollWidthMm: null });
  });

  it("an unchanged legacy line keeps its stored billed length in the form; a changed one is re-measured", () => {
    const legacyLinear = { fileLengthMm: 700, copies: 5, billableLengthMm: 2100, summary: "ملف 25×70 سم" }; // old rule: ceil(5/2) rows × 70 cm
    const kept = newWorkLine("DTF_PAPER", { variant: "WHITE_80", fileLengthM: "0.7", quantity: "5", unitPrice: "120", legacyLinear });
    expect(draftLinear(kept)).toMatchObject({ ok: true, billableLengthMm: 2100, legacy: true });
    expect(itemLineTotal(kept)).toBe(25_200n);
    const changed = { ...kept, quantity: "6" };
    expect(draftLinear(changed)).toEqual({ ok: true, billableLengthMm: 4200 });
  });
});

describe("work-kind config", () => {
  it("defines every approved kind with its options", () => {
    expect(WORK_KINDS.map((k) => WORK_KIND_CONFIG[k].label)).toEqual(["ورق DTF", "ورق فينيل", "طباعة للغير", "تطريز للغير", "كبس للغير", "خامات أو مواد طباعة"]);
    expect(WORK_KIND_CONFIG.DTF_PAPER.variants!.options.map((o) => o.label)).toEqual(["أبيض 80%", "أبيض 100%"]);
    expect(WORK_KIND_CONFIG.VINYL_PAPER.variants!.options.map((o) => o.code)).toEqual(["REFLECTIVE_GRAY", "BLACK", "WHITE", "OTHER"]);
    expect(WORK_KIND_CONFIG.PRINT_FOR_OTHERS.variants!.options.map((o) => o.code)).toEqual(["VINYL", "DTF", "SILK_SCREEN", "SUBLIMATION", "OTHER"]);
    expect(WORK_KIND_CONFIG.EMBROIDERY_FOR_OTHERS).toMatchObject({ threadColor: true });
    expect(WORK_KIND_CONFIG.HEAT_PRESS_FOR_OTHERS).toMatchObject({ material: false, pricing: "UNIT" });
    expect(WORK_KIND_CONFIG.HEAT_PRESS_FOR_OTHERS.variants).toBeUndefined();
    expect(variantLabel("VINYL_PAPER", "OTHER", "فينيل ذهبي")).toBe("فينيل ذهبي");
    expect(suggestDepartmentKey({ workKind: "EMBROIDERY_FOR_OTHERS", designs: [{ operation: "DTF" }] })).toBe("EMBROIDERY");
  });

  it("summarizes a line for pages and PDFs (new meters rule, and legacy rows exactly as stored)", () => {
    expect(itemWorkSummary({ workKind: "DTF_PAPER", variant: "WHITE_80", variantText: null, threadColor: null, saleUnit: null, pricingBasis: "LINEAR_METER", fileWidthMm: null, fileLengthMm: 250, copiesPerRow: null, rollWidthMm: null, billableLengthMm: 2500 }, 10)).toBe(
      "ورق DTF · أبيض 80% · طول الفايل 0.25 متر × 10 كوبيه · 2.5 متر طولي",
    );
    expect(itemWorkSummary({ workKind: "DTF_PAPER", variant: "WHITE_80", variantText: null, threadColor: null, saleUnit: null, pricingBasis: "LINEAR_METER", fileWidthMm: 500, fileLengthMm: 700, copiesPerRow: 1, rollWidthMm: 600, billableLengthMm: 7000 }, 10)).toBe(
      "ورق DTF · أبيض 80% · ملف 50×70 سم × 10 نسخة · رول 60 سم · 7 متر طولي",
    );
    expect(itemWorkSummary({ workKind: null, variant: null, variantText: null, threadColor: null, saleUnit: null, pricingBasis: "UNIT", fileWidthMm: null, fileLengthMm: null, copiesPerRow: null, rollWidthMm: null, billableLengthMm: null })).toBeNull();
  });
});

describe("order schema with work kinds", () => {
  const base: CreateOrderPayload = { idempotencyKey: "0192f3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b", customer: { mode: "new", name: "x" }, title: "x", productType: "ورق DTF", unit: "PIECE", pricing: "items", receivedDate: "2026-11-01", deliveryDate: "2026-12-01", groups: [] };
  it("computes the total from both DTF lines; heat press needs no material", () => {
    const r = createOrderSchema.parse({
      ...base,
      groups: [
        { workKind: "DTF_PAPER", variant: "WHITE_80", name: "a", quantity: "10", unitPrice: "120", fileLengthM: "0.7", plain: true, designs: [] },
        { workKind: "DTF_PAPER", variant: "WHITE_100", name: "b", quantity: "10", unitPrice: "150", fileLengthM: "0.7", plain: true, designs: [] },
        { workKind: "HEAT_PRESS_FOR_OTHERS", name: "c", quantity: "100", unitPrice: "3", plain: true, designs: [] },
      ],
    });
    expect(r.totalPrice).toBe(84_000n + 105_000n + 30_000n);
    expect(r.groups.map((g) => [g.pricingBasis, g.linear?.billableLengthMm ?? null, g.material])).toEqual([["LINEAR_METER", 7000, ""], ["LINEAR_METER", 7000, ""], ["UNIT", null, ""]]);
  });

  it("does not require (or accept) the removed inputs, and never reads a cm length as meters", () => {
    const ok = createOrderSchema.parse({ ...base, groups: [{ workKind: "VINYL_PAPER", variant: "BLACK", name: "v", quantity: "3", unitPrice: "150", fileLengthM: "1", plain: true, designs: [] }] });
    expect(ok.totalPrice).toBe(45_000n);
    // An outdated client still sending «fileLengthCm: 70» is refused, not billed as 70 m.
    const stale = createOrderSchema.safeParse({ ...base, groups: [{ workKind: "VINYL_PAPER", variant: "BLACK", name: "v", quantity: "3", unitPrice: "150", fileLengthCm: "70", rollWidthCm: "60", fileWidthCm: "50", plain: true, designs: [] }] });
    expect(stale.success).toBe(false);
    expect(JSON.stringify(stale.error?.issues)).toContain("fileLengthM");
  });
});

describe("usage arithmetic", () => {
  it("is exact to 3 decimals and rounds totals half up", () => {
    expect(parseQuantity("7.4")).toBe(7_400n);
    expect(parseQuantity("0.125")).toBe(125n);
    expect(parseQuantity("1.2345")).toBeNull();
    expect(formatQuantity(7_400n)).toBe("7.4");
    expect(usageTotalCents(7_400n, 4_500n)).toBe(33_300n);
    expect(usageTotalCents(1n, 500n)).toBe(1n); // 0.0005 × 5 → 0.5 piaster → 1
  });
});

describe("work kinds / costs migration", () => {
  const dir = path.resolve(__dirname, "../../prisma/migrations");
  const m = readdirSync(dir).find((d) => d.endsWith("_work_kinds_costs_review"))!;
  const sql = readFileSync(path.join(dir, m, "migration.sql"), "utf8");
  it("is additive and leaves existing rows as they are", () => {
    expect(sql).not.toMatch(/\bDROP\b|^\s*DELETE\b|^\s*UPDATE\b|ALTER COLUMN|RENAME|TRUNCATE|ALTER TYPE/im);
    expect(sql).toMatch(/"is_draft" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toMatch(/"pricing_basis" "ItemPricingBasis" NOT NULL DEFAULT 'UNIT'/);
    expect(sql).toMatch(/ADD COLUMN\s+"cost_status" "CostReviewStatus",/);
    expect(sql).toMatch(/order_groups_linear_meter_complete/);
    expect(sql).toMatch(/order_costs_draft_not_posted/);
  });
});

describe("production ops / measured / booking migration", () => {
  const dir = path.resolve(__dirname, "../../prisma/migrations");
  const m = readdirSync(dir).find((d) => d.endsWith("_production_ops_measured_booking"))!;
  const sql = readFileSync(path.join(dir, m, "migration.sql"), "utf8");
  it("only adds enum values, a column, constraints, and fills the new booking time of already-booked costs", () => {
    expect(sql).not.toMatch(/\bDROP\b|^\s*DELETE\b|ALTER COLUMN|RENAME|TRUNCATE/im);
    const alterTypes = sql.match(/^ALTER TYPE .*$/gm) ?? [];
    expect(alterTypes.every((l) => / ADD VALUE '[A-Z_]+';$/.test(l))).toBe(true);
    expect(sql.match(/^UPDATE .*$/gm)).toEqual(['UPDATE "order_costs" SET "posted_at" = "created_at" WHERE "is_draft" = false AND "posted_at" IS NULL;']);
    expect(sql).toMatch(/order_costs_booked_has_posted_at" CHECK \("is_draft" OR "posted_at" IS NOT NULL\)/);
  });
});

describe("database pool", () => {
  it("keeps idle connections warm long enough to skip reconnecting between clicks", async () => {
    const { DB_POOL_DEFAULTS } = await import("@/lib/db/prisma");
    expect(DB_POOL_DEFAULTS.idleTimeoutMillis).toBeGreaterThanOrEqual(5 * 60_000);
    expect(DB_POOL_DEFAULTS.max).toBeLessThanOrEqual(20); // well under Postgres max_connections (100), other apps share the server
  });
});
