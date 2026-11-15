"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { voidPaymentAction } from "@/app/(app)/orders/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Owner-only correction. Expands inline; the payment stays in the history. */
export function VoidPaymentForm({ paymentId }: { paymentId: string }) {
  const [state, action, pending] = useActionState(voidPaymentAction, null);
  return (
    <details className="group mt-2">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-lg px-2 text-sm font-medium text-destructive hover:bg-destructive/10">
        إلغاء الدفعة دي
      </summary>
      <form action={action} className="mt-2 space-y-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
        <input type="hidden" name="paymentId" value={paymentId} />
        <label htmlFor={`reason-${paymentId}`} className="text-sm font-medium">
          سبب الإلغاء
        </label>
        <Input id={`reason-${paymentId}`} name="reason" placeholder="مثال: المبلغ اتكتب غلط" required minLength={3} />
        {state?.fieldErrors?.reason && <p className="text-sm text-destructive">{state.fieldErrors.reason[0]}</p>}
        <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
        <p className="text-xs text-muted-foreground">الدفعة هتفضل ظاهرة في السجل بس مش هتتحسب في المدفوع.</p>
        <Button type="submit" variant="destructive" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          تأكيد إلغاء الدفعة
        </Button>
      </form>
    </details>
  );
}
