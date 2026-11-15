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

export const PRINT_OPERATIONS: readonly PrintOperation[] = ["DTF", "SCREEN_PRINT", "EMBROIDERY"];

export const OPERATION_LABELS: Record<PrintOperation, string> = {
  DTF: "DTF",
  SCREEN_PRINT: "سلك سكرين",
  EMBROIDERY: "تطريز",
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
