"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Owner-only correction, expanding inline. The record stays in the history. */
export function VoidRecordForm({
  action,
  id,
  label,
  confirmLabel,
  note,
  returnTo,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  id: string;
  label: string;
  confirmLabel: string;
  note: string;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <details className="mt-2">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-lg px-2 text-sm font-medium text-destructive hover:bg-destructive/10">
        {label}
      </summary>
      <form action={formAction} className="mt-2 space-y-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
        <input type="hidden" name="id" value={id} />
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        <label htmlFor={`reason-${id}`} className="text-sm font-medium">
          سبب الإلغاء
        </label>
        <Input id={`reason-${id}`} name="reason" placeholder="مثال: اتسجلت غلط" required minLength={3} />
        {state?.fieldErrors?.reason && <p className="text-sm text-destructive">{state.fieldErrors.reason[0]}</p>}
        <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
        <p className="text-xs text-muted-foreground">{note}</p>
        <Button type="submit" variant="destructive" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {confirmLabel}
        </Button>
      </form>
    </details>
  );
}
