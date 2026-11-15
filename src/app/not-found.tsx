import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="mt-3 text-xl font-bold">الصفحة غير موجودة</h1>
      <p className="mt-2 text-sm text-muted-foreground">هذا الرابط غير موجود أو تم نقله.</p>
      <Link href="/dashboard" className={buttonVariants({ size: "lg", className: "mt-6" })}>
        العودة إلى الرئيسية
      </Link>
    </main>
  );
}
