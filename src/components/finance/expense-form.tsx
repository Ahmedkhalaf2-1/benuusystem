"use client";

import { hueSubmit, STICKY_SUBMIT } from "@/components/ds/primitives";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { recordExpenseAction } from "@/app/(app)/finance/actions";
import { Field, FormMessage, Textarea } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import type { ExpenseCategory, PaymentMethod } from "@/generated/prisma/enums";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type PayStatus } from "@/lib/finance/labels";
import { newRequestId } from "@/lib/request-id";
import { recordExpenseSchema } from "@/lib/validations/finance";
import { ChoiceCards } from "./choice-cards";
import { MoneyField } from "./money-field";
import { PayNowFields } from "./pay-now-fields";

/** "سجل مصروف" — category, amount, date, paid or not. Nothing else required. */
export function ExpenseForm({ today, initialCategory }: { today: string; initialCategory?: ExpenseCategory }) {
  const [requestId] = useState(newRequestId);
  const [category, setCategory] = useState<ExpenseCategory | "">(initialCategory ?? "");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [payStatus, setPayStatus] = useState<PayStatus | "">("");
  const [paidNow, setPaidNow] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function show(fieldErrors: Record<string, string[]>, summary?: string) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldErrors)) if (v[0]) flat[k] ??= v[0];
    setErrors(flat);
    setMessage(summary);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const payload = {
      idempotencyKey: requestId,
      category: category as ExpenseCategory,
      amount,
      expenseDate,
      payStatus: payStatus as PayStatus,
      paidNow,
      method,
      description,
    };
    const check = recordExpenseSchema.safeParse(payload);
    if (!check.success) {
      const fe: Record<string, string[]> = {};
      for (const issue of check.error.issues) (fe[issue.path.join(".") || "_form"] ??= []).push(issue.message);
      show(fe, "في بيانات ناقصة. راجع الخانات اللي باللون الأحمر.");
      return;
    }
    setMessage(undefined);
    startTransition(async () => {
      const result = await recordExpenseAction(payload);
      if (result && !result.ok) show(result.fieldErrors ?? {}, result.message);
    });
  }

  const clear = (key: string) => setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-[1.4rem] bg-surface shadow-[var(--shadow-card)] p-4 sm:p-5">
      <ChoiceCards
        label="نوع المصروف"
        options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
        value={category}
        onChange={(c) => {
          setCategory(c);
          clear("category");
        }}
        error={errors.category}
      />
      <Field label="المبلغ" htmlFor="amount" error={errors.amount}>
        <MoneyField
          id="amount"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            clear("amount");
          }}
          invalid={!!errors.amount}
          placeholder="مثال: 2000"
        />
      </Field>
      <PayNowFields
        amount={amount}
        payStatus={payStatus}
        paidNow={paidNow}
        method={method}
        errors={errors}
        onChange={(p) => {
          if (p.payStatus !== undefined) {
            setPayStatus(p.payStatus);
            clear("payStatus");
          }
          if (p.paidNow !== undefined) {
            setPaidNow(p.paidNow);
            clear("paidNow");
          }
          if (p.method !== undefined) setMethod(p.method);
        }}
      />
      <Field label="التاريخ" htmlFor="expenseDate" error={errors.expenseDate}>
        <Input id="expenseDate" type="date" value={expenseDate} max={today} onChange={(e) => setExpenseDate(e.target.value)} aria-invalid={errors.expenseDate ? true : undefined} />
      </Field>
      <Field label="وصف أو ملاحظات" htmlFor="description" optional>
        <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" placeholder="مثال: فاتورة كهرباء شهر نوفمبر" />
      </Field>
      <FormMessage message={message} />
      <div className={STICKY_SUBMIT}>
        <button type="submit" className={hueSubmit("amber")} disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ الحفظ…
          </>
        ) : (
          "حفظ المصروف"
        )}
      </button>
      </div>
    </form>
  );
}
