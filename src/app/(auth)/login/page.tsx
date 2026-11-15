import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-mark";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="pt-safe pb-safe flex min-h-dvh flex-col">
      {/* Brand stage */}
      <section className="stage relative overflow-hidden px-6 pt-12 pb-24 text-center">
        <div className="relative flex flex-col items-center">
          <h1 className="sr-only">Benuuprint</h1>
          <BrandLogo className="w-44" priority />
          <p className="mt-4 max-w-[28ch] text-sm leading-relaxed text-on-panel-muted">الأوردرات والإنتاج والحسابات بتاعة المطبعة، في مكان واحد.</p>
        </div>
      </section>

      <div className="relative -mt-14 w-full flex-1 px-5">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-5 font-display text-xl font-semibold">تسجيل الدخول</h2>
          <LoginForm />
        </div>
        <p className="mx-auto mt-6 max-w-sm pb-8 text-center text-xs text-graphite">نسيت كلمة المرور؟ تواصل مع مدير النظام.</p>
      </div>
    </main>
  );
}
