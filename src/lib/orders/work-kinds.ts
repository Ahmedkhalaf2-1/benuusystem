/**
 * Work kinds of «بنعمل إيه؟» that need their own item fields — ONE place that
 * defines labels, the material/variant choices, pricing basis and which
 * inputs apply. Forms, validation, display and reports read this config;
 * nothing else hard-codes per-kind conditions.
 *
 * Items with no work kind are the original garment / ready-made items and keep
 * working exactly as before.
 */
import type { DepartmentKey } from "@/lib/departments/suggest";
import type { PrintOperation } from "@/generated/prisma/enums";
import { parseQuantity, usageTotalCents } from "@/lib/finance/usage";

export const WORK_KINDS = ["DTF_PAPER", "VINYL_PAPER", "PRINT_FOR_OTHERS", "EMBROIDERY_FOR_OTHERS", "HEAT_PRESS_FOR_OTHERS", "RAW_MATERIALS"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export type VariantOption = { code: string; label: string };

/** "OTHER" in a variant list = the person types the material / method. */
export const OTHER_VARIANT = "OTHER";

export type WorkKindConfig = {
  key: WorkKind;
  label: string;
  /** Short English name (reports). */
  english: string;
  /**
   * LINEAR_METER: billed by linear meter of a fixed-width roll (file width ×
   * length × copies; price per linear meter). UNIT: quantity × unit price.
   */
  pricing: "LINEAR_METER" | "UNIT";
  /** Material / method choices; `multi`: picking several makes one line per choice. */
  variants?: { title: string; options: VariantOption[]; multi: boolean; required: boolean };
  /** Free thread-colour input (embroidery for others). */
  threadColor?: boolean;
  /** Item material («الخامة») applies. Heat press: never asked, never required. */
  material: boolean;
  /** Raw materials: the person types the material name and its sale unit. */
  materialName?: boolean;
  /** Suggested department (seeded department codes). */
  department: DepartmentKey;
  /**
   * Production step a line needs (tracked like any order: steps → ready →
   * delivered, with department / partner recording). Absent = no production
   * step: paper, heat press and material sales go straight to ready.
   */
  production?: (variant: string | null) => PrintOperation | null;
};

/** `fractional`: sold / used in decimals (up to 3 places). Countable units stay whole numbers. */
export const SALE_UNITS = [
  { code: "PIECE", label: "قطعة", fractional: false },
  { code: "LINEAR_METER", label: "متر طولي", fractional: true },
  { code: "METER", label: "متر", fractional: true },
  { code: "ROLL", label: "رول", fractional: false },
  { code: "SHEET", label: "فرخ", fractional: false },
  { code: "KG", label: "كيلو", fractional: true },
  { code: "LITER", label: "لتر", fractional: true },
  { code: "CONE", label: "كون", fractional: false },
  { code: "BOX", label: "علبة", fractional: false },
] as const;

export function isFractionalUnit(code: string | null | undefined): boolean {
  return SALE_UNITS.some((u) => u.code === code && u.fractional);
}
export type SaleUnit = (typeof SALE_UNITS)[number]["code"];
export const SALE_UNIT_LABELS: Record<string, string> = Object.fromEntries(SALE_UNITS.map((u) => [u.code, u.label]));

export const WORK_KIND_CONFIG: Record<WorkKind, WorkKindConfig> = {
  DTF_PAPER: {
    key: "DTF_PAPER",
    label: "ورق DTF",
    english: "DTF Papers",
    pricing: "LINEAR_METER",
    variants: { title: "نسبة الأبيض", multi: true, required: true, options: [{ code: "WHITE_80", label: "أبيض 80%" }, { code: "WHITE_100", label: "أبيض 100%" }] },
    material: false,
    department: "PRINTING",
  },
  VINYL_PAPER: {
    key: "VINYL_PAPER",
    label: "ورق فينيل",
    english: "Vinyl Papers",
    pricing: "LINEAR_METER",
    variants: {
      title: "نوع الفينيل",
      multi: true,
      required: true,
      options: [
        { code: "REFLECTIVE_GRAY", label: "فينيل عاكس رصاصي" },
        { code: "BLACK", label: "فينيل أسود" },
        { code: "WHITE", label: "فينيل أبيض" },
        { code: OTHER_VARIANT, label: "أخرى" },
      ],
    },
    material: false,
    department: "PRINTING",
  },
  PRINT_FOR_OTHERS: {
    key: "PRINT_FOR_OTHERS",
    label: "طباعة للغير",
    english: "Printing for Others",
    pricing: "UNIT",
    variants: {
      title: "طريقة الطباعة",
      multi: true,
      required: true,
      options: [
        { code: "VINYL", label: "فينيل" },
        { code: "DTF", label: "DTF" },
        { code: "SILK_SCREEN", label: "سلك سكرين" },
        { code: "SUBLIMATION", label: "سبلميشن" },
        { code: OTHER_VARIANT, label: "أخرى" },
      ],
    },
    material: false,
    department: "PRINTING",
    production: (variant) => (variant === "DTF" ? "DTF" : variant === "SILK_SCREEN" ? "SCREEN_PRINT" : variant === "VINYL" ? "VINYL" : variant === "SUBLIMATION" ? "SUBLIMATION" : "OTHER_PRINT"),
  },
  EMBROIDERY_FOR_OTHERS: {
    key: "EMBROIDERY_FOR_OTHERS",
    label: "تطريز للغير",
    english: "Embroidery for Others",
    pricing: "UNIT",
    variants: { title: "نوع الخيط", multi: true, required: true, options: [{ code: "POLYESTER", label: "خيط بوليستر" }, { code: "COTTON", label: "خيط قطن" }] },
    threadColor: true,
    material: false,
    department: "EMBROIDERY",
    production: () => "EMBROIDERY",
  },
  HEAT_PRESS_FOR_OTHERS: {
    key: "HEAT_PRESS_FOR_OTHERS",
    label: "كبس للغير",
    english: "Heat Press for Others",
    pricing: "UNIT",
    material: false,
    department: "PRINTING",
  },
  RAW_MATERIALS: {
    key: "RAW_MATERIALS",
    label: "خامات أو مواد طباعة",
    english: "Printing / Raw Materials",
    pricing: "UNIT",
    material: false,
    materialName: true,
    department: "PRINTING",
  },
};

export function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === "string" && (WORK_KINDS as readonly string[]).includes(value);
}

/** Human label of an item's variant ("أبيض 80%", or the typed text for «أخرى»). */
export function variantLabel(kind: WorkKind | null | undefined, variant: string | null | undefined, variantText?: string | null): string | null {
  if (!kind || !variant) return null;
  if (variant === OTHER_VARIANT) return variantText?.trim() || "أخرى";
  return WORK_KIND_CONFIG[kind].variants?.options.find((o) => o.code === variant)?.label ?? variant;
}

// ───────────────────────────── Linear-meter pricing ─────────────────────────────

/**
 * DTF / vinyl are sold by the LINEAR METER of a fixed-width roll (never by
 * square meter). All lengths are whole millimetres; money is whole piasters.
 *
 *   rows            = ceil(copies / copiesPerRow)        (copiesPerRow set explicitly; default 1)
 *   billableLength  = rows × fileLength                  (no rotation, nesting or spacing is invented)
 *   lineTotal       = round_half_up(billableLength × pricePerMeter / 1000)
 *
 * The file must fit across the roll: fileWidth × copiesPerRow ≤ rollWidth.
 * Actual consumed length (waste, setup) is recorded separately as a cost
 * entry, never mixed into the billed length.
 */
export type LinearInput = { fileWidthMm: number; fileLengthMm: number; copies: number; copiesPerRow: number; rollWidthMm: number };

export type LinearCheck = { ok: true; rows: number; billableLengthMm: number } | { ok: false; field: "fileWidthMm" | "fileLengthMm" | "copies" | "copiesPerRow" | "rollWidthMm"; message: string };

export const MAX_LENGTH_MM = 1_000_000; // 1 km — a sanity limit, not a business rule

export function checkLinear(i: LinearInput): LinearCheck {
  const pos = (n: number) => Number.isInteger(n) && n > 0;
  if (!pos(i.rollWidthMm) || i.rollWidthMm > 10_000) return { ok: false, field: "rollWidthMm", message: "اكتب عرض الرول" };
  if (!pos(i.fileWidthMm) || i.fileWidthMm > 10_000) return { ok: false, field: "fileWidthMm", message: "اكتب عرض الملف" };
  if (!pos(i.fileLengthMm) || i.fileLengthMm > MAX_LENGTH_MM) return { ok: false, field: "fileLengthMm", message: "اكتب طول الملف" };
  if (!pos(i.copies)) return { ok: false, field: "copies", message: "اكتب عدد النسخ" };
  if (!pos(i.copiesPerRow)) return { ok: false, field: "copiesPerRow", message: "اكتب عدد النسخ في الصف" };
  if (i.fileWidthMm * i.copiesPerRow > i.rollWidthMm) {
    return {
      ok: false,
      field: i.copiesPerRow > 1 ? "copiesPerRow" : "fileWidthMm",
      message: i.copiesPerRow > 1 ? `${i.copiesPerRow} نسخ جنب بعض مش هيدخلوا في عرض الرول (${formatCm(i.rollWidthMm)} سم)` : `عرض الملف أكبر من عرض الرول (${formatCm(i.rollWidthMm)} سم)`,
    };
  }
  const rows = Math.ceil(i.copies / i.copiesPerRow);
  const billableLengthMm = rows * i.fileLengthMm;
  if (billableLengthMm > MAX_LENGTH_MM) return { ok: false, field: "copies", message: "الطول الكلي كبير جدًا" };
  return { ok: true, rows, billableLengthMm };
}

/** Line total in piasters for a billed length (mm) at a price per linear meter (piasters). Half-up to the piaster. */
export function linearLineCents(billableLengthMm: number, pricePerMeterCents: bigint): bigint {
  const num = BigInt(billableLengthMm) * pricePerMeterCents;
  return (num * 2n + 1000n) / 2000n; // round half up of num / 1000
}

/** The most copies that fit side by side (for the form's hint — never applied silently). */
export function maxCopiesPerRow(fileWidthMm: number, rollWidthMm: number): number {
  return fileWidthMm > 0 ? Math.floor(rollWidthMm / fileWidthMm) : 0;
}

/** "70" / "70.5" cm → mm (one decimal allowed); null when invalid. */
export function cmToMm(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(text)) return null;
  const [whole, frac = "0"] = text.split(".");
  return Number(whole) * 10 + Number(frac);
}

export function formatCm(mm: number): string {
  return mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1);
}

/** 7000 mm → "7.00" linear meters. */
export function formatMeters(mm: number): string {
  return (mm / 1000).toFixed(2);
}

// ───────────────────────────── Any item's line total ─────────────────────────────

/**
 * The ONE line-total rule used by validation, order details, invoices,
 * department finance and value splits: linear-meter items bill their stored
 * billable length; every other item is quantity × unit price.
 */
export function itemLineCents(item: {
  quantity: number;
  unitPriceCents: bigint | null;
  pricingBasis?: string | null;
  billableLengthMm?: number | null;
  /** MEASURED items: the decimal quantity (string or Decimal). */
  measuredQuantity?: { toString(): string } | string | null;
}): bigint | null {
  if (item.unitPriceCents === null) return null;
  if (item.pricingBasis === "LINEAR_METER") return item.billableLengthMm == null ? null : linearLineCents(item.billableLengthMm, item.unitPriceCents);
  if (item.pricingBasis === "MEASURED") {
    const milli = item.measuredQuantity == null ? null : parseQuantity(item.measuredQuantity.toString());
    return milli === null ? null : usageTotalCents(milli, item.unitPriceCents);
  }
  return BigInt(item.quantity) * item.unitPriceCents;
}

/** One line describing an item's work: kind · material/method · size · billed meters (for pages, PDFs, reports). */
export function itemWorkSummary(work: {
  workKind: string | null;
  variant: string | null;
  variantText: string | null;
  threadColor: string | null;
  saleUnit: string | null;
  pricingBasis: string;
  fileWidthMm: number | null;
  fileLengthMm: number | null;
  copiesPerRow: number | null;
  rollWidthMm: number | null;
  billableLengthMm: number | null;
  measuredQuantity?: string | null;
}, quantity?: number): string | null {
  if (!isWorkKind(work.workKind)) return null;
  const cfg = WORK_KIND_CONFIG[work.workKind];
  const parts: string[] = [cfg.label];
  const v = variantLabel(work.workKind, work.variant, work.variantText);
  if (v) parts.push(v);
  if (work.threadColor) parts.push(`لون الخيط ${work.threadColor}`);
  if (work.saleUnit) parts.push(work.measuredQuantity ? `${work.measuredQuantity} ${SALE_UNIT_LABELS[work.saleUnit] ?? work.saleUnit}` : `بال${SALE_UNIT_LABELS[work.saleUnit] ?? work.saleUnit}`);
  if (work.pricingBasis === "LINEAR_METER" && work.fileWidthMm && work.fileLengthMm && work.billableLengthMm) {
    parts.push(`ملف ${formatCm(work.fileWidthMm)}×${formatCm(work.fileLengthMm)} سم${quantity ? ` × ${quantity} نسخة` : ""}${work.copiesPerRow && work.copiesPerRow > 1 ? ` (${work.copiesPerRow} في الصف)` : ""}`);
    if (work.rollWidthMm) parts.push(`رول ${formatCm(work.rollWidthMm)} سم`);
    parts.push(`${formatMeters(work.billableLengthMm)} متر طولي`);
  }
  return parts.join(" · ");
}
