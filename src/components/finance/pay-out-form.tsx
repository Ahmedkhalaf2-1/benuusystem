"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { AccountField, defaultAccountId } from "@/components/treasury/account-field";
import type { AccountOption } from "@/lib/treasury/labels";
import { Input } from "@/components/ui/input";
import { formatAmount, formatMoney, parseMoney, toCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";
import { MoneyField } from "./money-field";

/** Pay (part of) what is left on a cost or an expense. Idempotent per visit. */
export function PayOutForm({
  action,
  targetId,
  remaining,
  today,
  returnTo,
  accounts = [],
}: {
  accounts?: AccountOption[];
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  targetId: string;
  remaining: string;
  today: string;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [requestId] = useState(newRequestId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts));
  const left = toCents(remaining);
  const typed = parseMoney(amount);
  const after = typed !== null ? left - typed : null;
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="idempotencyKey" value={requestId} />
      <input type="hidden" name="method" value={method} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <Field label="دفعت كام؟" htmlFor="amount" error={errors.amount?.[0]}>
        <MoneyField id="amount" name="amount" value={amount} onChange={setAmount} invalid={!!errors.amount} autoFocus />
      </Field>
      <button
        type="button"
        onClick={() => setAmount(formatAmount(left).replace(/,/g, ""))}
        className="-mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        دفعت الباقي كله ({formatMoney(left)})
      </button>

      <div className="flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3">
        <span className="text-sm font-medium">لسه عليه كام بعد الدفعة دي؟</span>
        <span className={cn("text-xl font-bold", after !== null && after < 0n ? "text-destructive" : "text-primary")}>
          {after !== null ? formatMoney(after) : "—"}
        </span>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[0.95rem] font-medium">اتدفع إزاي؟</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="طريقة الدفع">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                "h-12 rounded-xl border-2 text-[0.95rem] font-semibold",
                method === m ? "border-primary bg-brand-soft text-primary" : "border-border bg-surface",
              )}
            >
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </fieldset>

      <AccountField accounts={accounts} value={accountId} onChange={setAccountId} direction="out" name="accountId" error={errors.accountId?.[0]} />

      <Field label="تاريخ الدفع" htmlFor="paidAt" error={errors.paidAt?.[0]}>
        <Input id="paidAt" name="paidAt" type="date" defaultValue={today} max={today} />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" className="min-h-20" placeholder="مثال: رقم الإيصال" />
      </Field>

      <FormMessage message={state?.message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("amber")} disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ الحفظ…
          </>
        ) : (
          "حفظ الدفعة"
        )}
      </button>
      </div>
    </form>
  );
}
