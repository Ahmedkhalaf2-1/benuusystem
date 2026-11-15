import { z } from "zod";
import type { PrintOperation } from "@/generated/prisma/enums";
import { MAX_CENTS, parseMoney, type Cents } from "@/lib/money";
import { isValidDateString, todayDateString } from "@/lib/dates";
import { parseWholeNumber } from "@/lib/numbers";
import { PAYMENT_METHODS, PRINT_OPERATIONS, QUANTITY_UNITS } from "@/lib/orders/labels";
import { customerNameSchema, phoneSchema } from "./customer";

/** Shared by the order form (client, for instant errors) and the server. */

export const MAX_ORDER_GROUPS = 10;
export const MAX_ORDER_QUANTITY = 1_000_000;

const requiredText = (max: number, required: string) =>
  z.string({ error: required }).trim().min(1, required).max(max, "النص طويل جدًا");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص طويل جدًا")
    .optional()
    .transform((value) => (value ? value : undefined));

const quantitySchema = (required: string) =>
  z
    .union([z.string(), z.number()], { error: required })
    .transform((value, ctx) => {
      const n = parseWholeNumber(value);
      if (n === null || n <= 0) {
        ctx.addIssue({ code: "custom", message: required });
        return z.NEVER;
      }
      if (n > MAX_ORDER_QUANTITY) {
        ctx.addIssue({ code: "custom", message: "الكمية كبيرة جدًا" });
        return z.NEVER;
      }
      return n;
    });

/** Money typed by a person ("40,000", "٤٠٠٠٠") → piasters. */
export const moneySchema = (options: { required: string; allowZero?: boolean }) =>
  z.string({ error: options.required }).transform((value, ctx): Cents => {
    const trimmed = value.trim();
    if (trimmed === "" && options.allowZero) return 0n;
    const cents = parseMoney(trimmed);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: trimmed === "" ? options.required : "اكتب المبلغ بالأرقام بس، مثال: 40000" });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "المبلغ كبير جدًا" });
      return z.NEVER;
    }
    if (cents === 0n && !options.allowZero) {
      ctx.addIssue({ code: "custom", message: options.required });
      return z.NEVER;
    }
    return cents;
  });

export const dateStringSchema = (required: string) =>
  z.string({ error: required }).trim().refine(isValidDateString, required);

const customerChoiceSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({ mode: z.literal("existing"), id: z.uuid("اختار العميل من القائمة") }),
    z.object({ mode: z.literal("new"), name: customerNameSchema, phone: phoneSchema }),
  ],
  { error: "اختار العميل أو اكتب اسم عميل جديد" },
);

const groupSchema = z.object({
  /** Existing group id when editing — kept so records pointing at the group stay valid. */
  id: z.uuid().optional(),
  /** Ignored (taken from the order) when there is only one group. */
  quantity: z.union([z.string(), z.number()]).optional(),
  material: optionalText(80),
  operations: z
    .array(z.enum(PRINT_OPERATIONS as [string, ...string[]]))
    .max(PRINT_OPERATIONS.length)
    .transform((ops) => [...new Set(ops)] as PrintOperation[]),
  /** "بدون طباعة أو تطريز" chosen explicitly. */
  plain: z.boolean().default(false),
  notes: optionalText(500),
});

/** Fields shared by "new order" and "edit order". */
const orderCoreShape = {
  customer: customerChoiceSchema,
  title: requiredText(150, "اكتب اسم الأوردر"),
  productType: requiredText(80, "اكتب نوع المنتج"),
  material: requiredText(80, "اكتب نوع الخامة"),
  quantity: quantitySchema("اكتب الكمية المطلوبة"),
  unit: z.enum(QUANTITY_UNITS as [string, ...string[]]).transform((u) => u as (typeof QUANTITY_UNITS)[number]),
  groups: z.array(groupSchema).min(1).max(MAX_ORDER_GROUPS, "عدد المجموعات كبير جدًا"),
  totalPrice: moneySchema({ required: "اكتب إجمالي سعر الأوردر" }),
  receivedDate: dateStringSchema("اختار تاريخ استلام الأوردر"),
  deliveryDate: dateStringSchema("اختار موعد التسليم"),
  notes: optionalText(2000),
};

type CoreParsed = {
  quantity: number;
  material: string;
  receivedDate: string;
  deliveryDate: string;
  groups: z.infer<typeof groupSchema>[];
};

/** Cross-field rules: group quantities, work type per group, dates. */
function checkOrderRules(data: CoreParsed, ctx: z.RefinementCtx) {
  if (data.deliveryDate < data.receivedDate) {
    ctx.addIssue({ code: "custom", path: ["deliveryDate"], message: "موعد التسليم لازم يكون بعد تاريخ الاستلام" });
  }

  const multiple = data.groups.length > 1;
  let sum = 0;
  data.groups.forEach((group, index) => {
    if (group.plain && group.operations.length > 0) {
      ctx.addIssue({ code: "custom", path: ["groups", index, "operations"], message: "اختار طباعة/تطريز أو «بدون»، مش الاتنين" });
    } else if (!group.plain && group.operations.length === 0) {
      ctx.addIssue({ code: "custom", path: ["groups", index, "operations"], message: "اختار نوع الشغل: DTF أو سلك سكرين أو تطريز أو بدون" });
    }
    if (multiple) {
      const n = parseWholeNumber(group.quantity ?? null);
      if (n === null || n <= 0) {
        ctx.addIssue({ code: "custom", path: ["groups", index, "quantity"], message: "اكتب كمية المجموعة" });
      } else {
        sum += n;
      }
    }
  });

  if (multiple && sum > 0 && sum !== data.quantity) {
    ctx.addIssue({
      code: "custom",
      path: ["groups"],
      message: `مجموع كميات المجموعات (${sum}) لازم يساوي الكمية المطلوبة (${data.quantity})`,
    });
  }
}

/** Normalizes groups: quantities filled in, material defaults to the order's. */
function normalizeGroups(data: CoreParsed) {
  const multiple = data.groups.length > 1;
  return data.groups.map((group) => ({
    id: group.id,
    quantity: multiple ? parseWholeNumber(group.quantity ?? null)! : data.quantity,
    material: group.material ?? data.material,
    operations: group.plain ? [] : group.operations,
    notes: group.notes,
  }));
}

export const createOrderSchema = z
  .object({
    ...orderCoreShape,
    idempotencyKey: z.uuid(),
    advance: moneySchema({ required: "اكتب المقدم", allowZero: true }).default(0n),
    advanceMethod: z.enum(PAYMENT_METHODS as [string, ...string[]]).default("CASH"),
  })
  .superRefine((data, ctx) => {
    checkOrderRules(data, ctx);
    if (data.advance > data.totalPrice) {
      ctx.addIssue({ code: "custom", path: ["advance"], message: "المقدم أكبر من إجمالي سعر الأوردر" });
    }
  })
  .transform((data) => ({
    ...data,
    advanceMethod: data.advanceMethod as (typeof PAYMENT_METHODS)[number],
    groups: normalizeGroups(data),
  }));

export type CreateOrderInput = z.output<typeof createOrderSchema>;
export type CreateOrderPayload = z.input<typeof createOrderSchema>;

export const EDITABLE_STATUSES = ["NEW", "IN_PROGRESS", "CANCELLED"] as const;

export const updateOrderSchema = z
  .object({
    ...orderCoreShape,
    orderId: z.uuid(),
    status: z.enum(EDITABLE_STATUSES, { error: "اختار حالة الأوردر" }),
    /** The order's updatedAt when the edit form was opened (stale-edit protection). */
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .superRefine((data, ctx) => checkOrderRules(data, ctx))
  .transform((data) => ({ ...data, groups: normalizeGroups(data) }));

export type UpdateOrderInput = z.output<typeof updateOrderSchema>;
export type UpdateOrderPayload = z.input<typeof updateOrderSchema>;

export const recordPaymentSchema = z.object({
  orderId: z.uuid(),
  idempotencyKey: z.uuid(),
  amount: moneySchema({ required: "اكتب مبلغ الدفعة" }),
  paidAt: dateStringSchema("اختار تاريخ الدفعة").refine(
    (value) => value <= todayDateString(),
    "تاريخ الدفعة مينفعش يكون في المستقبل",
  ),
  method: z
    .enum(PAYMENT_METHODS as [string, ...string[]], { error: "اختار طريقة الدفع" })
    .transform((m) => m as (typeof PAYMENT_METHODS)[number]),
  notes: optionalText(500),
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;

export const voidPaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: z.string({ error: "اكتب سبب الإلغاء" }).trim().min(3, "اكتب سبب الإلغاء").max(300, "السبب طويل جدًا"),
});
