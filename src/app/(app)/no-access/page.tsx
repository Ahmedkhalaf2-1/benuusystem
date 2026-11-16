import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";

export const metadata: Metadata = { title: "مش متاحة" };

export default async function NoAccessPage() {
  await requireUser();
  return (
    <section className="mx-auto flex max-w-md flex-col items-center rounded-2xl bg-surface border border-line px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Lock className="size-7" aria-hidden="true" />
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold">حسابك مالوش صلاحية على الصفحة دي</h1>
      <p className="mt-2 text-sm text-muted-foreground">لو محتاجها في شغلك، اطلب من المدير يديك الصلاحية.</p>
      <Link href="/dashboard" className={buttonVariants({ size: "lg", className: "mt-6" })}>
        الرجوع للرئيسية
      </Link>
    </section>
  );
}
