import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-mark";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="pt-safe pb-safe flex min-h-dvh flex-col">
      {/* Brand stage */}
      <section className="stage relative overflow-hidden rounded-b-[2.25rem] px-6 pt-14 pb-24 text-center text-white">
        <span aria-hidden="true" className="pointer-events-none absolute -top-16 -end-16 size-56 rounded-full bg-[#ff7aa8]/25 blur-3xl" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -start-10 size-56 rounded-full bg-[#4fc3f7]/20 blur-3xl" />
        <div className="relative flex flex-col items-center">
          <BrandMark className="size-16 rounded-[18px] shadow-[0_12px_30px_-10px_rgb(0_0_0/0.45)] ring-4 ring-white/15" />
          <h1 className="mt-4 font-display text-[1.9rem] font-semibold tracking-[-0.02em]">
            <span dir="ltr">Benuuprint</span>
          </h1>
          <p className="mt-1.5 max-w-[28ch] text-sm leading-relaxed text-white/75">الأوردرات والإنتاج والحسابات بتاعة المطبعة، في مكان واحد.</p>
        </div>
      </section>

      <div className="relative -mt-14 w-full flex-1 px-5">
        <div className="mx-auto w-full max-w-sm rounded-[1.75rem] bg-surface p-6 shadow-[var(--shadow-lift)]">
          <h2 className="mb-5 font-display text-xl font-semibold">تسجيل الدخول</h2>
          <LoginForm />
        </div>
        <p className="mx-auto mt-6 max-w-sm pb-8 text-center text-xs text-graphite">نسيت كلمة المرور؟ تواصل مع مدير النظام.</p>
      </div>
    </main>
  );
}
