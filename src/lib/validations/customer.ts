import { z } from "zod";
import { normalizeDigits } from "@/lib/numbers";

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : undefined));

export const customerNameSchema = z
  .string({ error: "اكتب اسم العميل" })
  .trim()
  .min(1, "اكتب اسم العميل")
  .max(120, "اسم العميل طويل جدًا");

/** Optional phone: Arabic digits converted, only digits, spaces, +, - allowed. */
export const phoneSchema = z
  .string()
  .optional()
  .transform((value) => normalizeDigits(value ?? "").trim().replace(/\s+/g, " "))
  .refine((value) => value === "" || /^\+?[\d\s-]{6,20}$/.test(value), "رقم الموبايل مش صحيح")
  .transform((value) => (value ? value : undefined));

export const customerInputSchema = z.object({
  name: customerNameSchema,
  phone: phoneSchema,
  notes: optionalText(1000, "الملاحظات طويلة جدًا"),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
export type CustomerFormValues = z.input<typeof customerInputSchema>;

export const customerSearchSchema = z
  .string()
  .optional()
  .transform((value) => normalizeDigits(value ?? "").trim().slice(0, 100));
