"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

/** Generic error screen; server error details are never shown to users. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-red-soft text-red">
        <TriangleAlert className="size-8" aria-hidden="true" />
      </span>
      <h1 className="mt-5 font-display text-xl font-semibold">حصلت مشكلة غير متوقعة</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-graphite">جرّب تاني. لو المشكلة فضلت موجودة، كلّم مدير النظام.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex h-12 items-center gap-2 rounded-2xl bg-violet px-6 font-display font-semibold text-white shadow-[var(--shadow-violet)] transition-transform active:scale-[0.97]"
      >
        <RotateCcw className="size-5" aria-hidden="true" />
        جرّب تاني
      </button>
    </main>
  );
}
