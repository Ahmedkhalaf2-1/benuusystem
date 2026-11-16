import { z } from "zod";

/** Flattens Zod issues to `{ field: [messages] }` for forms and API responses. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * Treasury account a payment actually went into / came out of. Optional:
 * empty means "not attributed" (the owner can attribute it later).
 */
export const paymentAccountSchema = z
  .union([z.uuid({ error: "اختار الحساب" }), z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));
