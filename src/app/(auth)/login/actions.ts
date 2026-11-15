"use server";

import { redirect } from "next/navigation";
import { getRequestIp, setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatMinutesAr } from "@/lib/format";
import { loginSchema } from "@/lib/validations/auth";
import { login, type LoginResult } from "@/server/services/auth-service";

export type LoginFormState = {
  message?: string;
  fieldErrors?: { email?: string[]; password?: string[] };
};

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    const { fieldErrors } = parsedErrors(parsed.error.issues);
    return { fieldErrors };
  }

  let result: LoginResult;
  try {
    result = await login(prisma, parsed.data, { ipAddress: await getRequestIp() });
  } catch (error) {
    console.error("[login] unexpected error", error);
    return { message: "تعذّر تسجيل الدخول الآن بسبب مشكلة في الخادم. حاول مرة أخرى بعد قليل." };
  }

  if (!result.ok) {
    switch (result.reason) {
      case "INVALID_CREDENTIALS":
        return { message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." };
      case "INACTIVE":
        return { message: "هذا الحساب موقوف. تواصل مع مدير النظام." };
      case "RATE_LIMITED":
        return {
          message: `محاولات دخول كثيرة. حاول مرة أخرى بعد ${formatMinutesAr(
            Math.ceil(result.retryAfterSeconds / 60),
          )}.`,
        };
    }
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect("/dashboard");
}

function parsedErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: NonNullable<LoginFormState["fieldErrors"]> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === "email" || field === "password") {
      (fieldErrors[field] ??= []).push(issue.message);
    }
  }
  return { fieldErrors };
}
