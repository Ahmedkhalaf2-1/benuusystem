"use client";

import { useActionState } from "react";
import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { createStaffAction, resetPasswordAction } from "@/app/(app)/users/actions";
import { Field, FormMessage } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const err = (state: { fieldErrors?: Record<string, string[]> } | null, key: string) => state?.fieldErrors?.[key]?.[0];

/** Owner confirms with their own password — a stolen session alone can't make accounts. */
function OwnerPasswordField({ error }: { error?: string }) {
  return (
    <Field label="كلمة السر بتاعتك (للتأكيد)" htmlFor="ownerPassword" error={error} hint="عشان محدش يقدر يعمل حسابات من جهازك من غيرك.">
      <Input id="ownerPassword" name="ownerPassword" type="password" autoComplete="current-password" required aria-invalid={error ? true : undefined} />
    </Field>
  );
}

export function CreateStaffForm() {
  const [state, action, pending] = useActionState(createStaffAction, null);
  return (
    <details className="group rounded-2xl border border-line bg-surface p-4" open={!!state} data-testid="create-staff">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-display font-semibold text-violet [&::-webkit-details-marker]:hidden">
        <UserPlus className="size-5" aria-hidden="true" />
        إضافة حساب جديد
      </summary>
      <form action={action} className="mt-3 space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">نوع الحساب</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "STAFF", label: "موظف", hint: "بتحدد صلاحياته واحدة واحدة" },
              { value: "PARTNER", label: "شريك", hint: "يشوف بنود الأقسام اللي تحددها بس" },
            ].map((k) => (
              <label key={k.value} className="flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-3 has-[:checked]:border-violet has-[:checked]:bg-violet-soft">
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="kind" value={k.value} defaultChecked={k.value === "STAFF"} className="size-4" />
                  {k.label}
                </span>
                <span className="mt-0.5 text-xs text-graphite">{k.hint}</span>
              </label>
            ))}
          </div>
          {err(state, "kind") && <p className="mt-1 text-sm text-red">{err(state, "kind")}</p>}
        </fieldset>
        <Field label="الاسم" htmlFor="name" error={err(state, "name")}>
          <Input id="name" name="name" required autoComplete="off" aria-invalid={err(state, "name") ? true : undefined} />
        </Field>
        <Field label="الإيميل (بيدخل بيه)" htmlFor="email" error={err(state, "email")}>
          <Input id="email" name="email" type="email" dir="ltr" required autoComplete="off" aria-invalid={err(state, "email") ? true : undefined} />
        </Field>
        <Field label="كلمة السر بتاعته" htmlFor="password" error={err(state, "password")} hint="٨ حروف على الأقل. ابعتهاله بطريقة آمنة.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-invalid={err(state, "password") ? true : undefined} />
        </Field>
        <OwnerPasswordField error={err(state, "ownerPassword")} />
        <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
        <p className="text-xs text-graphite">الحساب الجديد بيبدأ من غير أي صلاحيات ولا أقسام — هتحددها في الصفحة اللي بعدها.</p>
        <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          إنشاء الحساب
        </Button>
      </form>
    </details>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <details className="group rounded-2xl bg-well px-3.5" open={!!state}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <KeyRound className="size-4" aria-hidden="true" />
        تغيير كلمة السر
      </summary>
      <form action={action} className="space-y-4 pb-4">
        <input type="hidden" name="userId" value={userId} />
        <Field label="كلمة السر الجديدة" htmlFor="new-password" error={err(state, "password")}>
          <Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <OwnerPasswordField error={err(state, "ownerPassword")} />
        <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
        <p className="text-xs text-graphite">هيتقفل دخوله من كل الأجهزة ويدخل بكلمة السر الجديدة.</p>
        <Button type="submit" variant="outline" disabled={pending} className="h-11 w-full rounded-xl">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ كلمة السر
        </Button>
      </form>
    </details>
  );
}
