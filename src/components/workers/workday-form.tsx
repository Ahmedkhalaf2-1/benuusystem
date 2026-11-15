"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { recordWorkdayAction } from "@/app/(app)/workers/actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { MoneyField } from "@/components/finance/money-field";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { newRequestId } from "@/lib/request-id";

/** "تسجيل يومية": date (default today), came or not. Wage comes from the profile. */
export function WorkdayForm({ workerId, today, standardWage }: { workerId: string; today: string; standardWage: string | null }) {
  const [state, action, pending] = useActionState(recordWorkdayAction, null);
  const [key] = useState(newRequestId);
  const [worked, setWorked] = useState<"true" | "false">("true");
  const [wage, setWage] = useState("");
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="worked" value={worked} />
      <Field label="اليوم" htmlFor="workDate" error={errors.workDate?.[0]}>
        <Input id="workDate" name="workDate" type="date" defaultValue={today} max={today} />
      </Field>
      <ChoiceCards
        label="حضر؟"
        options={[
          { value: "true", label: "حضر واشتغل" },
          { value: "false", label: "غاب" },
        ]}
        value={worked}
        onChange={setWorked}
      />
      {worked === "true" && standardWage !== null && (
        <Field label="يومية اليوم ده" htmlFor="wage" optional hint={`لو سبتها فاضية هتتحسب ${standardWage} ج.م (اليومية العادية).`} error={errors.wage?.[0]}>
          <MoneyField id="wage" name="wage" value={wage} onChange={setWage} placeholder={standardWage} />
        </Field>
      )}
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" className="min-h-20" />
      </Field>
      <FormMessage message={state?.message} />
      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        حفظ اليومية
      </Button>
    </form>
  );
}
