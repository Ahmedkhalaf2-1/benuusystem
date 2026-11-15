import "server-only";
import { isAppError } from "@/lib/errors";

/** What a form server action returns when it does not redirect. */
export type ActionResult = {
  ok: false;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Turns thrown errors into a safe form result. AppErrors carry an Arabic
 * message; anything else is logged and replaced by a generic message.
 * (Next's redirect() must be called OUTSIDE the wrapped function.)
 */
export async function toActionResult(work: () => Promise<unknown>): Promise<ActionResult | null> {
  try {
    await work();
    return null;
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        message:
          error.code === "VALIDATION_ERROR" && error.fieldErrors
            ? "في بيانات محتاجة تتصلح. راجع الخانات اللي باللون الأحمر."
            : error.message,
        fieldErrors: error.fieldErrors,
      };
    }
    console.error("[action] unexpected error", error);
    return { ok: false, message: "حصلت مشكلة في الحفظ. حاول تاني، ولو المشكلة استمرت كلّم المدير." };
  }
}
