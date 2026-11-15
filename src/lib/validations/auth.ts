import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

/** Emails are compared case-insensitively: always trim + lowercase. */
export const emailSchema = z
  .string({ error: "البريد الإلكتروني مطلوب" })
  .trim()
  .min(1, "البريد الإلكتروني مطلوب")
  .max(254, "البريد الإلكتروني طويل جدًا")
  .pipe(z.email("اكتب بريدًا إلكترونيًا صحيحًا، مثال: name@example.com"))
  .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
  email: emailSchema,
  // No length policy on login: just required and bounded (protects the hasher).
  password: z
    .string({ error: "كلمة المرور مطلوبة" })
    .min(1, "كلمة المرور مطلوبة")
    .max(PASSWORD_MAX_LENGTH, "كلمة المرور طويلة جدًا"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const newPasswordSchema = z
  .string({ error: "كلمة المرور مطلوبة" })
  .min(
    PASSWORD_MIN_LENGTH,
    `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف`,
  )
  .max(PASSWORD_MAX_LENGTH, "كلمة المرور طويلة جدًا");

export const userNameSchema = z
  .string({ error: "الاسم مطلوب" })
  .trim()
  .min(2, "الاسم يجب ألا يقل عن حرفين")
  .max(100, "الاسم طويل جدًا");

export const createOwnerAdminSchema = z.object({
  name: userNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export type CreateOwnerAdminInput = z.infer<typeof createOwnerAdminSchema>;
