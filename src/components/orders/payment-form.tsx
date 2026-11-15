"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { recordPaymentAction } from "@/app/(app)/orders/actions";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAmount, formatMoney, parseMoney, toCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import { cn } from "@/lib/utils";

export function PaymentForm({ orderId, outstanding, today }: { orderId: string; outstanding: string; today: string }) {
  const [state, action, pending] = useActionState(recordPaymentAction, null);
  // Same key for retries of this visit: a double tap records the payment once.
  const [requestId] = useState(newRequestId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const remaining = toCents(outstanding);
  const typed = parseMoney(amount);
  const after = typed !== null ? remaining - typed : null;
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={requestId} />
      <input type="hidden" name="method" value={method} />

      <Field label="المبلغ المستلم" htmlFor="amount" error={errors.amount?.[0]}>
        <div className="relative">
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            dir="ltr"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="h-14 ps-14 text-left text-2xl font-bold"
            aria-invalid={errors.amount ? true : undefined}
          />
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">ج.م</span>
        </div>
      </Field>
      <button
        type="button"
        onClick={() => setAmount(formatAmount(remaining).replace(/,/g, ""))}
        className="-mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        العميل دفع المتبقي كله ({formatMoney(remaining)})
      </button>

      <div className="flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3">
        <span className="text-sm font-medium">المتبقي بعد الدفعة دي</span>
        <span className={cn("text-xl font-bold", after !== null && after < 0n ? "text-destructive" : "text-primary")}>
          {after !== null ? formatMoney(after) : "—"}
        </span>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[0.95rem] font-medium">طريقة الدفع</legend>
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
        {errors.method && <p className="mt-1 text-sm text-destructive">{errors.method[0]}</p>}
      </fieldset>

      <Field label="تاريخ الدفعة" htmlFor="paidAt" error={errors.paidAt?.[0]}>
        <Input id="paidAt" name="paidAt" type="date" defaultValue={today} max={today} />
      </Field>

      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" className="min-h-20" placeholder="مثال: رقم التحويل" />
      </Field>

      <FormMessage message={state?.message} />

      <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ التسجيل…
          </>
        ) : (
          "تسجيل الدفعة"
        )}
      </Button>
    </form>
  );
}
