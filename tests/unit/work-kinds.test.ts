import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { suggestDepartmentKey } from "@/lib/departments/suggest";
import { formatQuantity, parseQuantity, usageTotalCents } from "@/lib/finance/usage";
import { checkLinear, cmToMm, itemLineCents, itemWorkSummary, linearLineCents, maxCopiesPerRow, variantLabel, WORK_KIND_CONFIG, WORK_KINDS } from "@/lib/orders/work-kinds";
import { createOrderSchema, type CreateOrderPayload } from "@/lib/validations/order";

describe("linear-meter pricing", () => {
  it("bills the owner's example: 50×70 cm × 10 copies on a 60 cm roll at 120/m = 7 m = 840", () => {
    const r = checkLinear({ fileWidthMm: 500, fileLengthMm: 700, copies: 10, copiesPerRow: 1, rollWidthMm: 600 });
    expect(r).toEqual({ ok: true, rows: 10, billableLengthMm: 7000 });
    expect(linearLineCents(7000, 12_000n)).toBe(84_000n);
  });

  it("uses an explicit copies-per-row only, and refuses files wider than the roll (no rotation)", () => {
    expect(checkLinear({ fileWidthMm: 250, fileLengthMm: 700, copies: 5, copiesPerRow: 2, rollWidthMm: 600 })).toEqual({ ok: true, rows: 3, billableLengthMm: 2100 });
    expect(checkLinear({ fileWidthMm: 700, fileLengthMm: 500, copies: 1, copiesPerRow: 1, rollWidthMm: 600 })).toMatchObject({ ok: false, field: "fileWidthMm" });
    expect(checkLinear({ fileWidthMm: 250, fileLengthMm: 700, copies: 5, copiesPerRow: 3, rollWidthMm: 600 })).toMatchObject({ ok: false, field: "copiesPerRow" });
    expect(checkLinear({ fileWidthMm: 250, fileLengthMm: 700, copies: 5, copiesPerRow: 1, rollWidthMm: 0 })).toMatchObject({ ok: false, field: "rollWidthMm" });
    expect(maxCopiesPerRow(250, 600)).toBe(2);
  });

  it("rounds half up to the piaster and keeps every other item as quantity × unit price", () => {
    expect(linearLineCents(999, 9_999n)).toBe(9_989n); // 99.89001
    expect(linearLineCents(1, 500n)).toBe(1n); // 0.5 piaster → 1
    expect(itemLineCents({ quantity: 3, unitPriceCents: 1_000n })).toBe(3_000n);
    expect(itemLineCents({ quantity: 3, unitPriceCents: 1_000n, pricingBasis: "LINEAR_METER", billableLengthMm: 2500 })).toBe(2_500n);
    expect(itemLineCents({ quantity: 3, unitPriceCents: null })).toBeNull();
  });

  it("parses cm with one decimal (Arabic digits too)", () => {
    expect(cmToMm("70")).toBe(700);
    expect(cmToMm("29.7")).toBe(297);
    expect(cmToMm("٥٠")).toBe(500);
    expect(cmToMm("1.25")).toBeNull();
    expect(cmToMm("abc")).toBeNull();
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

  it("summarizes a line for pages and PDFs", () => {
    expect(itemWorkSummary({ workKind: "DTF_PAPER", variant: "WHITE_80", variantText: null, threadColor: null, saleUnit: null, pricingBasis: "LINEAR_METER", fileWidthMm: 500, fileLengthMm: 700, copiesPerRow: 1, rollWidthMm: 600, billableLengthMm: 7000 }, 10)).toBe(
      "ورق DTF · أبيض 80% · ملف 50×70 سم × 10 نسخة · رول 60 سم · 7.00 متر طولي",
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
        { workKind: "DTF_PAPER", variant: "WHITE_80", name: "a", quantity: "10", unitPrice: "120", fileWidthCm: "50", fileLengthCm: "70", rollWidthCm: "60", plain: true, designs: [] },
        { workKind: "DTF_PAPER", variant: "WHITE_100", name: "b", quantity: "10", unitPrice: "150", fileWidthCm: "50", fileLengthCm: "70", rollWidthCm: "60", plain: true, designs: [] },
        { workKind: "HEAT_PRESS_FOR_OTHERS", name: "c", quantity: "100", unitPrice: "3", plain: true, designs: [] },
      ],
    });
    expect(r.totalPrice).toBe(84_000n + 105_000n + 30_000n);
    expect(r.groups.map((g) => [g.pricingBasis, g.linear?.billableLengthMm ?? null, g.material])).toEqual([["LINEAR_METER", 7000, ""], ["LINEAR_METER", 7000, ""], ["UNIT", null, ""]]);
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
