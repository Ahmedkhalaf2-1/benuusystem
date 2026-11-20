"use client";

import { useActionState } from "react";
import { CalendarCheck, Loader2, RotateCcw } from "lucide-react";
import { confirmMonthAction, createRecurringAction, generateFixedAction, reopenMonthAction, setRecurringActiveAction } from "@/app/(app)/accounts/monthly/actions";
import { Field, FormMessage, NativeSelect } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/finance/labels";

export function ConfirmMonthForm({ month, basis, version, warnings, disabledReason }: { month: string; basis: string; version: number; warnings: string[]; disabledReason?: string }) {
  const [state, action, pending] = useActionState(confirmMonthAction, null);
  return (
    <form action={action} className="space-y-3" data-testid="confirm-month">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="basis" value={basis} />
      <input type="hidden" name="expectedVersion" value={version} />
      {warnings.length > 0 && (
        <label className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">
          <input type="checkbox" name="acknowledge" className="mt-1 size-4" />
          <span>شايف التنبيهات اللي فوق، وعايز أأكّد الشهر بيها (هتتسجل مع التأكيد).</span>
        </label>
      )}
      {state?.fieldErrors?.acknowledge && <p className="text-sm text-red">{state.fieldErrors.acknowledge[0]}</p>}
      <Field label="ملاحظات" htmlFor="close-notes" optional>
        <Input id="close-notes" name="notes" maxLength={1000} />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      {disabledReason && <p className="text-sm text-graphite">{disabledReason}</p>}
      <Button type="submit" disabled={pending || !!disabledReason} className="h-12 w-full rounded-xl">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CalendarCheck className="size-4" aria-hidden="true" />}
        تأكيد مراجعة الشهر
      </Button>
    </form>
  );
}

export function ReopenMonthForm({ month, basis, version }: { month: string; basis: string; version: number }) {
  const [state, action, pending] = useActionState(reopenMonthAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="basis" value={basis} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Field label="سبب فتح الشهر تاني" htmlFor="reopen-month-reason" error={state?.fieldErrors?.reason?.[0]}>
        <Input id="reopen-month-reason" name="reason" required minLength={3} maxLength={500} />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Button type="submit" variant="outline" disabled={pending} className="h-11 rounded-xl">
        <RotateCcw className="size-4" aria-hidden="true" />
        فتح الشهر للمراجعة
      </Button>
    </form>
  );
}

export function GenerateFixedForm({ month, basis, count }: { month: string; basis: string; count: number }) {
  const [state, action, pending] = useActionState(generateFixedAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="basis" value={basis} />
      <Button type="submit" size="sm" disabled={pending} className="h-10 rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        سجّل المصاريف الثابتة للشهر ({count})
      </Button>
      <FormMessage message={state?.message} />
    </form>
  );
}

export function RecurringExpenseForm({ thisMonth }: { thisMonth: string }) {
  const [state, action, pending] = useActionState(createRecurringAction, null);
  const err = (k: string) => state?.fieldErrors?.[k]?.[0];
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="النوع" htmlFor="rc-category" error={err("category")}>
          <NativeSelect id="rc-category" name="category" defaultValue="RENT">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="الوصف" htmlFor="rc-description" error={err("description")}>
          <Input id="rc-description" name="description" required maxLength={300} placeholder="مثال: إيجار المحل" />
        </Field>
        <Field label="المبلغ كل شهر" htmlFor="rc-amount" error={err("amount")}>
          <Input id="rc-amount" name="amount" inputMode="decimal" required className="tabular" />
        </Field>
        <Field label="يوم الشهر (1–28)" htmlFor="rc-day" error={err("dayOfMonth")}>
          <Input id="rc-day" name="dayOfMonth" type="number" min={1} max={28} defaultValue={1} required className="tabular" />
        </Field>
        <Field label="من شهر" htmlFor="rc-start" error={err("startMonth")}>
          <Input id="rc-start" name="startMonth" type="month" defaultValue={thisMonth} required />
        </Field>
        <Field label="لحد شهر" htmlFor="rc-end" error={err("endMonth")} optional>
          <Input id="rc-end" name="endMonth" type="month" />
        </Field>
      </div>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Button type="submit" disabled={pending} className="h-11 rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        إضافة مصروف ثابت
      </Button>
    </form>
  );
}

export function RecurringToggle({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setRecurringActiveAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="h-9 rounded-xl">
        {active ? "إيقاف" : "تشغيل"}
      </Button>
      <FormMessage message={state?.message} />
    </form>
  );
}
