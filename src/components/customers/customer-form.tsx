"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveCustomerAction } from "@/app/(app)/customers/actions";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";

export function CustomerForm({
  customer,
}: {
  customer?: { id: string; name: string; phone: string | null; notes: string | null };
}) {
  const [state, action, pending] = useActionState(saveCustomerAction, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5 rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      {customer && <input type="hidden" name="customerId" value={customer.id} />}
      <Field label="اسم العميل" htmlFor="name" error={errors.name?.[0]}>
        <Input id="name" name="name" defaultValue={customer?.name} placeholder="مثال: محمود" autoFocus={!customer} aria-invalid={errors.name ? true : undefined} />
      </Field>
      <Field label="رقم الموبايل" htmlFor="phone" optional error={errors.phone?.[0]}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          className="text-left"
          defaultValue={customer?.phone ?? ""}
          placeholder="01xxxxxxxxx"
          aria-invalid={errors.phone ? true : undefined}
        />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional error={errors.notes?.[0]}>
        <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} placeholder="مثال: بيتعامل عن طريق شركة…" />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("violet")} disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {customer ? "حفظ التعديلات" : "حفظ العميل"}
      </button>
      </div>
    </form>
  );
}
