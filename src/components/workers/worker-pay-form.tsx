"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { payWorkerAction } from "@/app/(app)/workers/actions";
import { ChoiceCards } from "@/components/finance/choice-cards";
import { MoneyField } from "@/components/finance/money-field";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { formatAmount, formatMoney, toCents } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/orders/labels";
import { newRequestId } from "@/lib/request-id";
import { AccountField, defaultAccountId } from "@/components/treasury/account-field";
import type { AccountOption } from "@/lib/treasury/labels";

/** "دفع فلوس" / "سلفة" for one worker. */
export function WorkerPayForm({ workerId, owed, today, initialType, accounts = [] }: { workerId: string; owed: string; today: string; initialType: "WAGE" | "ADVANCE"; accounts?: AccountOption[] }) {
  const [requestId] = useState(newRequestId);
  const [type, setType] = useState<"WAGE" | "ADVANCE">(initialType);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [accountId, setAccountId] = useState(() => defaultAccountId(accounts));
  const [paidAt, setPaidAt] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const owedCents = toCents(owed);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setMessage(undefined);
    startTransition(async () => {
      const result = await payWorkerAction({ workerId, idempotencyKey: requestId, type, amount, paidAt, method, accountId, notes });
      if (result && !result.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.fieldErrors ?? {})) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        setMessage(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-2xl bg-surface border border-line p-4 sm:p-5">
      <ChoiceCards
        label="نوع الدفعة"
        options={[
          { value: "WAGE", label: "دفع يومية / مستحقات" },
          { value: "ADVANCE", label: "سلفة" },
        ]}
        value={type}
        onChange={(t) => {
          setType(t);
          setErrors({});
        }}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        {type === "WAGE" ? `بتدفع من اللي اشتغله فعلًا. المتبقي له: ${formatMoney(owedCents)}.` : "سلفة = فلوس قبل ما يشتغلها. بتتخصم تلقائيًا من اليوميات الجاية."}
      </p>
      <Field label="المبلغ" htmlFor="amount" error={errors.amount}>
        <MoneyField id="amount" value={amount} onChange={setAmount} invalid={!!errors.amount} autoFocus />
      </Field>
      {type === "WAGE" && owedCents > 0n && (
        <button type="button" onClick={() => setAmount(formatAmount(owedCents).replace(/,/g, ""))} className="-mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
          ادفع له المتبقي كله ({formatMoney(owedCents)})
        </button>
      )}
      <ChoiceCards label="اتدفع إزاي؟" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} value={method} onChange={setMethod} />
      <AccountField accounts={accounts} value={accountId} onChange={setAccountId} direction="out" error={errors.accountId} />
      <Field label="التاريخ" htmlFor="paidAt" error={errors.paidAt}>
        <Input id="paidAt" type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} />
      </Field>
      <Field label="ملاحظات" htmlFor="notes" optional>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
      </Field>
      <FormMessage message={message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("green")} disabled={pending}>
        {pending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {type === "WAGE" ? "حفظ الدفعة" : "حفظ السلفة"}
      </button>
      </div>
    </form>
  );
}
