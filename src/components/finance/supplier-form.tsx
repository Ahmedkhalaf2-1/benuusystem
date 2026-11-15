"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveSupplierAction } from "@/app/(app)/finance/actions";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";

export function SupplierForm({ supplier }: { supplier?: { id: string; name: string; phone: string | null; notes: string | null } }) {
  const [state, action, pending] = useActionState(saveSupplierAction, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5 rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      {supplier && <input type="hidden" name="supplierId" value={supplier.id} />}
      <Field label="اسم المورد" htmlFor="name" error={errors.name?.[0]}>
        <Input id="name" name="name" defaultValue={supplier?.name} placeholder="مثال: أحمد للأقمشة" autoFocus={!supplier} aria-invalid={errors.name ? true : undefined} />
      </Field>
      <Field label="رقم الموبايل" htmlFor="phone" optional error={errors.phone?.[0]}>
        <Input id="phone" name="phone" type="tel" inputMode="tel" dir="ltr" className="text-left" defaultValue={supplier?.phone ?? ""} placeholder="01xxxxxxxxx" aria-invalid={errors.phone ? true : undefined} />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional error={errors.notes?.[0]}>
        <Textarea id="notes" name="notes" defaultValue={supplier?.notes ?? ""} placeholder="مثال: بيورّد قطن وليكرا" />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("violet")} disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {supplier ? "حفظ التعديلات" : "حفظ المورد"}
      </button>
      </div>
    </form>
  );
}
