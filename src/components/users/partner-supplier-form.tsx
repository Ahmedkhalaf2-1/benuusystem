"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { linkPartnerSupplierAction } from "@/app/(app)/users/actions";
import { Field, FormMessage, NativeSelect } from "@/components/forms/field";
import { Button } from "@/components/ui/button";

/** Owner: which supplier record holds what Benuuprint owes this partner. */
export function PartnerSupplierForm({ userId, current, suppliers }: { userId: string; current: string | null; suppliers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(linkPartnerSupplierAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <Field label="حساب المورد اللي بيتسجل عليه شغله" htmlFor="supplierId" error={state?.fieldErrors?.supplierId?.[0]}>
        <NativeSelect id="supplierId" name="supplierId" defaultValue={current ?? ""}>
          <option value="">مش مربوط</option>
          <option value="new">مورد جديد باسم الشريك</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        حفظ الربط
      </Button>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
    </form>
  );
}
