import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark, BrandName } from "@/components/brand/brand-mark";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-16" />
          <h1 className="mt-4 text-2xl">
            <BrandName />
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            سجّل دخولك لإدارة الأوردرات والإنتاج والحسابات
          </p>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-[0_1px_2px_rgb(30_10_70/0.04),0_8px_24px_-12px_rgb(30_10_70/0.12)]">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          نسيت كلمة المرور؟ تواصل مع مدير النظام.
        </p>
      </div>
    </main>
  );
}
