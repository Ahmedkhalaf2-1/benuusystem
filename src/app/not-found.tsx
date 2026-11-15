import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <BrandMark className="size-14 rounded-[16px] shadow-[var(--shadow-violet)]" />
      <p className="tabular mt-6 font-display text-[4.5rem] leading-none font-semibold text-violet">404</p>
      <h1 className="mt-3 font-display text-xl font-semibold">الصفحة دي مش موجودة</h1>
      <p className="mt-2 max-w-[30ch] text-sm leading-relaxed text-graphite">الرابط غلط أو الصفحة اتنقلت. ارجع للرئيسية وكمّل من هناك.</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-12 items-center rounded-2xl bg-violet px-6 font-display font-semibold text-white shadow-[var(--shadow-violet)] transition-transform active:scale-[0.97]"
      >
        الرجوع للرئيسية
      </Link>
    </main>
  );
}
