import { paymentAccountSchema } from "./utils";
import { z } from "zod";
import { todayDateString } from "@/lib/dates";
import { parseMoney } from "@/lib/money";
import { parseWholeNumber } from "@/lib/numbers";
import { COST_CATEGORIES, EXPENSE_CATEGORIES, PAY_STATUSES } from "@/lib/finance/labels";
import { PAYMENT_METHODS } from "@/lib/orders/labels";
import { phoneSchema } from "./customer";
import { dateStringSchema, moneySchema } from "./order";

/** Shared by the finance forms (client, for instant errors) and the server. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص طويل جدًا")
    .optional()
    .transform((value) => (value ? value : undefined));

export const supplierNameSchema = z
  .string({ error: "اكتب اسم المورد" })
  .trim()
  .min(1, "اكتب اسم المورد")
  .max(120, "اسم المورد طويل جدًا");

export const supplierInputSchema = z.object({
  name: supplierNameSchema,
  phone: phoneSchema,
  notes: optionalText(1000),
});
export type SupplierInput = z.infer<typeof supplierInputSchema>;
export type SupplierFormValues = z.input<typeof supplierInputSchema>;

const supplierChoiceSchema = z
  .discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("existing"), id: z.uuid("اختار المورد من القائمة") }),
    z.object({ mode: z.literal("new"), name: supplierNameSchema, phone: phoneSchema }),
  ])
  .default({ mode: "none" });

const methodSchema = z
  .enum(PAYMENT_METHODS as [string, ...string[]], { error: "اختار طريقة الدفع" })
  .default("CASH")
  .transform((m) => m as (typeof PAYMENT_METHODS)[number]);

const notInFuture = (label: string) =>
  dateStringSchema(`اختار ${label}`).refine((v) => v <= todayDateString(), `${label} مينفعش يكون في المستقبل`);

/** "دفعت كام؟" — turns FULL / PARTIAL / CREDIT into the initial cash payment. */
const payNowShape = {
  payStatus: z.enum(PAY_STATUSES, { error: "اختار اتدفع ولا لأ" }),
  paidNow: moneySchema({ required: "اكتب المبلغ اللي اتدفع", allowZero: true }).default(0n),
  method: methodSchema,
  accountId: paymentAccountSchema,
};

function checkPayNow(data: { payStatus: (typeof PAY_STATUSES)[number]; paidNow: bigint; amount: bigint }, ctx: z.RefinementCtx) {
  if (data.payStatus !== "PARTIAL") return;
  if (data.paidNow <= 0n) {
    ctx.addIssue({ code: "custom", path: ["paidNow"], message: "اكتب المبلغ اللي اتدفع" });
  } else if (data.paidNow >= data.amount) {
    ctx.addIssue({ code: "custom", path: ["paidNow"], message: "المدفوع لازم يكون أقل من المبلغ (ولو اتدفع كله اختار «مدفوع بالكامل»)" });
  }
}

function initialPayment(data: { payStatus: (typeof PAY_STATUSES)[number]; paidNow: bigint; amount: bigint }): bigint {
  return data.payStatus === "FULL" ? data.amount : data.payStatus === "PARTIAL" ? data.paidNow : 0n;
}

export const recordOrderCostSchema = z
  .object({
    orderId: z.uuid(),
    idempotencyKey: z.uuid(),
    category: z.enum(COST_CATEGORIES as [string, ...string[]], { error: "اختار نوع التكلفة" })
      .transform((c) => c as (typeof COST_CATEGORIES)[number]),
    description: optionalText(200),
    amount: moneySchema({ required: "اكتب مبلغ التكلفة" }),
    costDate: notInFuture("التاريخ"),
    supplier: supplierChoiceSchema,
    notes: optionalText(500),
    /** The department the work is for (partner settlements). Must have an item on the order. */
    departmentId: z.uuid("اختار القسم").optional().or(z.literal("").transform(() => undefined)),
    /**
     * «بالقطعة»: pieces and the agreed cost per piece. When given, the amount
     * must equal pieces × cost per piece exactly (the agreed numbers are typed
     * by the owner — nothing is invented).
     */
    quantity: z.union([z.string(), z.number()]).optional(),
    unitCost: z.string().optional(),
    ...payNowShape,
  })
  .superRefine(checkPayNow)
  .superRefine((data, ctx) => {
    const qText = data.quantity === undefined ? "" : String(data.quantity).trim();
    const uText = data.unitCost?.trim() ?? "";
    if (qText === "" && uText === "") return;
    const q = parseWholeNumber(qText);
    const u = uText === "" ? null : parseMoney(uText);
    if (q === null || q <= 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "اكتب عدد القطع" });
    if (u === null || u <= 0n) ctx.addIssue({ code: "custom", path: ["unitCost"], message: "اكتب تكلفة القطعة" });
    if (q !== null && q > 0 && u !== null && u > 0n && BigInt(q) * u !== data.amount) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "المبلغ لازم يساوي عدد القطع × تكلفة القطعة" });
    }
  })
  .transform((data) => {
    const qText = data.quantity === undefined ? "" : String(data.quantity).trim();
    const perPiece = qText !== "" ? { quantity: parseWholeNumber(qText)!, unitCost: parseMoney(data.unitCost!.trim())! } : null;
    return { ...data, perPiece, initialPayment: initialPayment(data) };
  });

export type RecordOrderCostInput = z.output<typeof recordOrderCostSchema>;
export type RecordOrderCostPayload = z.input<typeof recordOrderCostSchema>;

export const recordExpenseSchema = z
  .object({
    idempotencyKey: z.uuid(),
    category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]], { error: "اختار نوع المصروف" })
      .transform((c) => c as (typeof EXPENSE_CATEGORIES)[number]),
    description: optionalText(300),
    amount: moneySchema({ required: "اكتب مبلغ المصروف" }),
    expenseDate: notInFuture("التاريخ"),
    ...payNowShape,
  })
  .superRefine(checkPayNow)
  .transform((data) => ({ ...data, initialPayment: initialPayment(data) }));

export type RecordExpenseInput = z.output<typeof recordExpenseSchema>;
export type RecordExpensePayload = z.input<typeof recordExpenseSchema>;

/** Paying (more of) an existing cost or expense. */
export const payPayableSchema = z.object({
  targetId: z.uuid(),
  idempotencyKey: z.uuid(),
  amount: moneySchema({ required: "اكتب المبلغ" }),
  paidAt: notInFuture("تاريخ الدفع"),
  method: methodSchema,
  accountId: paymentAccountSchema,
  notes: optionalText(500),
});
export type PayPayableInput = z.output<typeof payPayableSchema>;

export const voidRecordSchema = z.object({
  id: z.uuid(),
  reason: z.string({ error: "اكتب سبب الإلغاء" }).trim().min(3, "اكتب سبب الإلغاء").max(300, "السبب طويل جدًا"),
});
