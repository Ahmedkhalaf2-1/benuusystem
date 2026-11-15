import { z } from "zod";
import { todayDateString } from "@/lib/dates";
import { parseWholeNumber } from "@/lib/numbers";
import { PRINT_OPERATIONS } from "@/lib/orders/labels";
import { dateStringSchema, MAX_ORDER_QUANTITY } from "./order";

/** Shared by the production/delivery forms (client) and the server. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص طويل جدًا")
    .optional()
    .transform((v) => (v ? v : undefined));

const notInFuture = (label: string) =>
  dateStringSchema(`اختار ${label}`).refine((v) => v <= todayDateString(), `${label} مينفعش يكون في المستقبل`);

export const piecesSchema = (message: string) =>
  z.union([z.string(), z.number()], { error: message }).transform((v, ctx) => {
    const n = parseWholeNumber(v);
    if (n === null || n <= 0 || n > MAX_ORDER_QUANTITY) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return n;
  });

/** Per-size quantities for groups with a size breakdown (empty sizes are simply left out). */
export const sizeLinesSchema = z
  .array(z.object({ sizeId: z.uuid(), quantity: piecesSchema("اكتب العدد") }))
  .max(30)
  .optional();

const base = {
  orderId: z.uuid(),
  orderGroupId: z.uuid({ error: "اختار المجموعة" }),
  idempotencyKey: z.uuid(),
  notes: optionalText(500),
  /** Sized groups: quantities per size instead of `quantity`. */
  sizes: sizeLinesSchema,
};

const optionalPieces = (message: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || String(v).trim() === "") return undefined;
      const n = parseWholeNumber(v);
      if (n === null || n <= 0 || n > MAX_ORDER_QUANTITY) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });

/** "تسجيل إنتاج" for one required step (DTF, embroidery, …). */
export const recordStageSchema = z.object({
  ...base,
  operation: z
    .enum(PRINT_OPERATIONS as [string, ...string[]], { error: "اختار مرحلة الشغل" })
    .transform((o) => o as (typeof PRINT_OPERATIONS)[number]),
  quantity: optionalPieces("اكتب عملنا كام قطعة"),
  workDate: notInFuture("التاريخ"),
  /** Single-step groups: the same pieces are also finished → ready in one save. */
  alsoReady: z.boolean().default(false),
});
export type RecordStagePayload = z.input<typeof recordStageSchema>;

/** "جاهز للتسليم": pieces that finished EVERY required step. */
export const recordReadySchema = z.object({
  ...base,
  quantity: optionalPieces("اكتب كام قطعة جاهزة"),
  readyDate: notInFuture("التاريخ"),
  /** Required for multi-step groups: the same physical pieces did all steps. */
  confirmAllOperations: z.boolean().default(false),
});
export type RecordReadyPayload = z.input<typeof recordReadySchema>;

/** "تسليم قطع". */
export const recordDeliverySchema = z.object({
  ...base,
  quantity: optionalPieces("اكتب سلمنا كام"),
  deliveredAt: notInFuture("تاريخ التسليم"),
});
export type RecordDeliveryPayload = z.input<typeof recordDeliverySchema>;
