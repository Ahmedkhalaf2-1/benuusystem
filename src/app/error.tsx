"use client";

import { Button } from "@/components/ui/button";

/** Generic error screen; server error details are never shown to users. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-bold">حدث خطأ غير متوقع</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        حاول مرة أخرى. إذا استمرت المشكلة، تواصل مع مدير النظام.
      </p>
      <Button size="lg" className="mt-6" onClick={reset}>
        إعادة المحاولة
      </Button>
    </main>
  );
}
