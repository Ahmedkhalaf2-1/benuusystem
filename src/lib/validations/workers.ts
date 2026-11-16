import { paymentAccountSchema } from "./utils";
import { z } from "zod";
import { todayDateString } from "@/lib/dates";
import { parseMoney } from "@/lib/money";
import { parseWholeNumber } from "@/lib/numbers";
import { PAYMENT_METHODS } from "@/lib/orders/labels";
import { WORK_TYPES, WORK_UNITS, WORKER_JOBS } from "@/lib/workers/labels";
import { phoneSchema } from "./customer";
import { dateStringSchema, moneySchema } from "./order";

/** Shared by the workers forms (client, for instant errors) and the server. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "النص طويل جدًا")
    .optional()
    .transform((v) => (v ? v : undefined));

const notInFuture = (label: string) =>
  dateStringSchema(`اختار ${label}`).refine((v) => v <= todayDateString(), `${label} مينفعش يكون في المستقبل`);

const unitSchema = z.enum(WORK_UNITS as [string, ...string[]]).transform((u) => u as (typeof WORK_UNITS)[number]);

const optionalWhole = (message: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || String(v).trim() === "") return undefined;
      const n = parseWholeNumber(v);
      if (n === null || n <= 0) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });

export const workerInputSchema = z
  .object({
    name: z.string({ error: "اكتب اسم العامل" }).trim().min(1, "اكتب اسم العامل").max(120, "الاسم طويل جدًا"),
    phone: phoneSchema,
    job: z.enum(WORKER_JOBS as [string, ...string[]], { error: "اختار شغلانة العامل" }).transform((j) => j as (typeof WORKER_JOBS)[number]),
    jobTitle: optionalText(80),
    dailyWage: moneySchema({ required: "اكتب اليومية" }),
    dailyTarget: optionalWhole("اكتب المستهدف بالأرقام"),
    targetUnit: unitSchema.optional(),
    isActive: z.boolean().default(true),
    notes: optionalText(1000),
  })
  .superRefine((d, ctx) => {
    if (d.dailyTarget !== undefined && !d.targetUnit) {
      ctx.addIssue({ code: "custom", path: ["targetUnit"], message: "اختار وحدة المستهدف" });
    }
  })
  .transform((d) => ({ ...d, targetUnit: d.dailyTarget !== undefined ? d.targetUnit : undefined }));

export type WorkerInput = z.output<typeof workerInputSchema>;
export type WorkerFormValues = z.input<typeof workerInputSchema>;

export const recordWorkdaySchema = z.object({
  workerId: z.uuid(),
  idempotencyKey: z.uuid(),
  workDate: notInFuture("اليوم"),
  worked: z.boolean({ error: "اختار حضر ولا لأ" }),
  /** Optional wage override for this one day (owner only). Empty = worker's standard wage. */
  wage: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return undefined;
      const cents = parseMoney(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "اكتب اليومية بالأرقام" });
        return z.NEVER;
      }
      return cents;
    }),
  notes: optionalText(500),
});
export type RecordWorkdayPayload = z.input<typeof recordWorkdaySchema>;

export const recordWorkLogSchema = z.object({
  workerId: z.uuid(),
  idempotencyKey: z.uuid(),
  workDate: notInFuture("اليوم"),
  orderId: z.uuid().optional(),
  orderGroupId: z.uuid().optional(),
  workType: z.enum(WORK_TYPES as [string, ...string[]], { error: "اختار نوع الشغل" }).transform((w) => w as (typeof WORK_TYPES)[number]),
  quantity: z.union([z.string(), z.number()], { error: "اكتب عمل كام" }).transform((v, ctx) => {
    const n = parseWholeNumber(v);
    if (n === null || n <= 0) {
      ctx.addIssue({ code: "custom", message: "اكتب عمل كام بالأرقام" });
      return z.NEVER;
    }
    return n;
  }),
  unit: unitSchema,
  /** "2.5" hours → 250 (hundredths). */
  hours: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return undefined;
      const h = parseMoney(v);
      if (h === null || h <= 0n || h > 2400n) {
        ctx.addIssue({ code: "custom", message: "اكتب عدد الساعات (من 0.25 لـ 24)" });
        return z.NEVER;
      }
      return Number(h);
    }),
  notes: optionalText(500),
  /** Optional: physical pieces of the group that finished the matching step with this work. */
  stageQuantity: optionalWhole("اكتب كام قطعة خلصت المرحلة دي"),
});
export type RecordWorkLogPayload = z.input<typeof recordWorkLogSchema>;

export const payWorkerSchema = z.object({
  workerId: z.uuid(),
  idempotencyKey: z.uuid(),
  type: z.enum(["WAGE", "ADVANCE"], { error: "اختار نوع الدفعة" }),
  amount: moneySchema({ required: "اكتب المبلغ" }),
  paidAt: notInFuture("تاريخ الدفع"),
  accountId: paymentAccountSchema,
  method: z
    .enum(PAYMENT_METHODS as [string, ...string[]])
    .default("CASH")
    .transform((m) => m as (typeof PAYMENT_METHODS)[number]),
  notes: optionalText(500),
});
export type PayWorkerPayload = z.input<typeof payWorkerSchema>;
