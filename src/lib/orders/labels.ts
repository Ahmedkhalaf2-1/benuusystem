import type {
  OrderStatus,
  PaymentMethod,
  PrintOperation,
  QuantityUnit,
} from "@/generated/prisma/enums";

/** Arabic wording for every enum the UI shows. Safe for client and server. */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "جديد",
  IN_PROGRESS: "تحت التنفيذ",
  COMPLETED: "مكتمل",
  CANCELLED: "ملغي",
};

/** Statuses that count as "still open" (active, can be overdue, accept payments). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["NEW", "IN_PROGRESS"];

export const QUANTITY_UNITS: readonly QuantityUnit[] = ["PIECE", "SET", "DOZEN", "METER"];

export const UNIT_LABELS: Record<QuantityUnit, string> = {
  PIECE: "قطعة",
  SET: "طقم",
  DOZEN: "دستة",
  METER: "متر",
};

/** Required steps a group can have (printing/embroidery, plus optional garment making). */
export const PRINT_OPERATIONS: readonly PrintOperation[] = ["MANUFACTURING", "DTF", "SCREEN_PRINT", "EMBROIDERY", "VINYL", "SUBLIMATION", "OTHER_PRINT"];

export const OPERATION_LABELS: Record<PrintOperation, string> = {
  MANUFACTURING: "تصنيع",
  DTF: "DTF",
  SCREEN_PRINT: "سلك سكرين",
  EMBROIDERY: "تطريز",
  VINYL: "فينيل",
  SUBLIMATION: "سبلميشن",
  OTHER_PRINT: "طباعة أخرى",
};

export const NO_OPERATION_LABEL = "بدون طباعة أو تطريز";

export function describeOperations(operations: readonly PrintOperation[]): string {
  if (operations.length === 0) return NO_OPERATION_LABEL;
  return PRINT_OPERATIONS.filter((op) => operations.includes(op))
    .map((op) => OPERATION_LABELS[op])
    .join(" + ");
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "BANK_TRANSFER", "INSTAPAY", "OTHER"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "نقدي",
  BANK_TRANSFER: "تحويل بنكي",
  INSTAPAY: "InstaPay",
  OTHER: "أخرى",
};

/** Suggestions only — employees can type anything. */
export const PRODUCT_SUGGESTIONS: readonly { name: string; unit: QuantityUnit }[] = [
  { name: "تيشيرت", unit: "PIECE" },
  { name: "بولو", unit: "PIECE" },
  { name: "هودي", unit: "PIECE" },
  { name: "سويت شيرت", unit: "PIECE" },
  { name: "قميص", unit: "PIECE" },
  { name: "جاكيت", unit: "PIECE" },
  { name: "بنطلون", unit: "PIECE" },
  { name: "يونيفورم", unit: "SET" },
  { name: "كاب", unit: "PIECE" },
  { name: "شنطة", unit: "PIECE" },
  { name: "جراب موبايل", unit: "PIECE" },
  { name: "قماش", unit: "METER" },
];

/**
 * «منتج جاهز» shortcuts: finished products sold as is (no printing or
 * embroidery). Names only — no catalog, prices or stock; any name can be typed.
 */
export const READY_MADE_PRESETS: readonly string[] = ["تيشيرت", "هودي", "سويت شيرت", "بولو", "كاب", "شنطة"];

export const MATERIAL_SUGGESTIONS: readonly string[] = [
  "قطن 100%",
  "قطن ليكرا",
  "قطن مخلوط",
  "ميلتون",
  "بوليستر",
  "دراي فيت",
  "فيسكوز",
  "جينز",
  "جبردين",
  "بلاستيك",
  "سيليكون",
];

export function formatOrderNumber(number: number): string {
  return `#${String(number).padStart(4, "0")}`;
}

// ───────────── Line items («بنود») and designs («رسومات») ─────────────

/** Fixed print placements. «أخرى» is free text, stored separately. */
export const PLACEMENTS = ["CHEST", "BACK", "BADGE", "RIGHT_SLEEVE", "LEFT_SLEEVE"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PLACEMENT_LABELS: Record<Placement, string> = {
  CHEST: "الصدر",
  BACK: "الظهر",
  BADGE: "بادج",
  RIGHT_SLEEVE: "كم يمين",
  LEFT_SLEEVE: "كم شمال",
};

export const OTHER_PLACEMENT_LABEL = "أخرى";
export const MAX_CUSTOM_PLACEMENTS = 5;

/** An item's display name: its own name, else «البند N» (older orders have no names). */
export function itemLabel(position: number, name?: string | null): string {
  return name?.trim() ? name.trim() : `البند ${position}`;
}

/** A design's display name: its own name, else «رسمة N». */
export function designLabel(position: number, name?: string | null): string {
  return name?.trim() ? name.trim() : `رسمة ${position}`;
}

/** "الصدر، الظهر، تحت الرقبة" — fixed placements in their usual order, then custom ones. */
export function placementsText(placements: readonly string[], custom: readonly string[] = []): string {
  const fixed = PLACEMENTS.filter((p) => placements.includes(p)).map((p) => PLACEMENT_LABELS[p]);
  return [...fixed, ...custom].join("، ");
}
