"use client";

import { useActionState, useState } from "react";
import { ArrowLeftRight, Check, Loader2, MinusCircle, PlusCircle, Scale, type LucideIcon } from "lucide-react";
import {
  attributePaymentAction,
  createAccountAction,
  reconcileAction,
  recordMovementAction,
  setAccountActiveAction,
  voidMovementAction,
} from "@/app/(app)/treasury/actions";
import { MoneyField } from "@/components/finance/money-field";
import { Field, FormMessage, NativeSelect, Textarea } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions";
import { newRequestId } from "@/lib/request-id";
import { ACCOUNT_TYPE_LABELS, type AccountOption } from "@/lib/treasury/labels";
import { cn } from "@/lib/utils";

const fe = (s: ActionResult | null, k: string) => s?.fieldErrors?.[k]?.[0];

function Submit({ pending, children, className }: { pending: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Button type="submit" disabled={pending} className={cn("h-12 w-full rounded-xl", className)}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
      {children}
    </Button>
  );
}

function AccountSelect({ name, accounts, label, error, exclude }: { name: string; accounts: AccountOption[]; label: string; error?: string; exclude?: string }) {
  return (
    <Field label={label} htmlFor={name} error={error}>
      <NativeSelect id={name} name={name} defaultValue="" required>
        <option value="" disabled>
          اختار…
        </option>
        {accounts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </NativeSelect>
    </Field>
  );
}

/** Guided opening balance: the owner counts real money; nothing is derived from old records. */
export function AccountSetupForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createAccountAction, null);
  const [opening, setOpening] = useState("");
  const [basis, setBasis] = useState<"START_OF_DAY" | "END_OF_DAY" | "">("");
  const [countDate, setCountDate] = useState(today);
  const nextDay = (() => {
    const d = new Date(`${countDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <form action={action} className="space-y-4" data-testid="account-setup">
      <Field label="اسم الحساب" htmlFor="acc-name" error={fe(state, "name")} hint="مثال: خزنة المحل، بنك مصر، فودافون كاش">
        <Input id="acc-name" name="name" required />
      </Field>
      <Field label="النوع" htmlFor="acc-type" error={fe(state, "type")}>
        <NativeSelect id="acc-type" name="type" defaultValue="CASH">
          {(["CASH", "BANK", "WALLET"] as const).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="يوم الجرد (اليوم اللي عدّيت فيه الفلوس)" htmlFor="acc-date" error={fe(state, "countDate")}>
        <Input id="acc-date" name="countDate" type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} max={today} required />
      </Field>
      <fieldset className="space-y-2" data-error={fe(state, "basis") ? "true" : undefined}>
        <legend className="text-sm font-semibold text-ink">الجرد كان إمتى في اليوم ده؟</legend>
        <input type="hidden" name="basis" value={basis} />
        {(
          [
            { v: "START_OF_DAY", title: "بداية اليوم — قبل أي فلوس تدخل أو تخرج", body: `أي دفعة بتاريخ ${countDate} هتتحسب على الحساب بعد الرصيد ده.` },
            { v: "END_OF_DAY", title: "آخر اليوم — بعد آخر حركة فلوس", body: `دفعات يوم ${countDate} جوّه الرصيد اللي عدّيته ومش هتتحسب تاني. الحساب يبدأ يحسب من ${nextDay}.` },
          ] as const
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={basis === o.v}
            onClick={() => setBasis(o.v)}
            className={cn("block w-full rounded-xl border p-3 text-start", basis === o.v ? "border-primary bg-brand-soft" : "border-border bg-surface")}
          >
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="mt-0.5 block text-xs text-graphite">{o.body}</span>
          </button>
        ))}
        {fe(state, "basis") && <p className="text-sm text-destructive">{fe(state, "basis")}</p>}
      </fieldset>
      <Field
        label={basis === "END_OF_DAY" ? "الرصيد اللي عدّيته آخر اليوم" : basis === "START_OF_DAY" ? "الرصيد اللي عدّيته بداية اليوم" : "الرصيد اللي عدّيته"}
        htmlFor="acc-opening"
        error={fe(state, "openingBalance")}
        hint="كاش: عدّ الفلوس اللي في الخزنة. بنك/محفظة: الرصيد من كشف الحساب أو التطبيق في نفس اللحظة."
      >
        <MoneyField id="acc-opening" name="openingBalance" value={opening} onChange={setOpening} invalid={!!fe(state, "openingBalance")} />
      </Field>
      <Field label="ملاحظات" htmlFor="acc-notes" optional>
        <Input id="acc-notes" name="notes" />
      </Field>
      <label className="flex items-start gap-2.5 rounded-2xl bg-warning-soft p-3.5 text-sm text-warning-ink">
        <input type="checkbox" name="confirmed" value="yes" className="mt-0.5 size-5 shrink-0" required />
        <span>أأكد إن الرصيد ده عدّيته أو راجعته فعلًا — مش محسوب من البرنامج. ده رصيد افتتاحي، مش مبيعات.</span>
      </label>
      {fe(state, "confirmed") && <p className="text-sm text-destructive">{fe(state, "confirmed")}</p>}
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Submit pending={pending}>حفظ الحساب والرصيد الافتتاحي</Submit>
    </form>
  );
}

const KINDS: { kind: "TRANSFER" | "CAPITAL_IN" | "DRAWING" | "ADJUSTMENT"; label: string; icon: LucideIcon; hint: string }[] = [
  { kind: "TRANSFER", label: "تحويل بين الحسابات", icon: ArrowLeftRight, hint: "مثال: إيداع كاش في البنك. إجمالي فلوس الشغل مش بيتغير." },
  { kind: "CAPITAL_IN", label: "إيداع من صاحب الشغل", icon: PlusCircle, hint: "فلوس حطيتها في الشغل من جيبك — مش مبيعات." },
  { kind: "DRAWING", label: "مسحوبات صاحب الشغل", icon: MinusCircle, hint: "فلوس خدتها لنفسك — مش مصروف تشغيل." },
  { kind: "ADJUSTMENT", label: "تصحيح رصيد", icon: Scale, hint: "لازم سبب. بيتسجل في سجل التعديلات ومبيتمسحش." },
];

export function MovementForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const [state, action, pending] = useActionState(recordMovementAction, null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["kind"]>("TRANSFER");
  const [requestId] = useState(newRequestId);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const current = KINDS.find((k) => k.kind === kind)!;
  return (
    <form action={action} className="space-y-4" data-testid="movement-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="idempotencyKey" value={requestId} />
      <div role="radiogroup" aria-label="نوع الحركة" className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={cn("flex min-h-12 items-center gap-2 rounded-xl border px-3 text-start text-sm font-semibold", kind === k.kind ? "border-primary bg-brand-soft text-primary" : "border-border bg-surface")}
          >
            <k.icon className="size-4 shrink-0" aria-hidden="true" />
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-graphite">{current.hint}</p>
      <Field label={kind === "TRANSFER" ? "من حساب" : "الحساب"} htmlFor="accountId" error={fe(state, "accountId")}>
        <NativeSelect id="accountId" name="accountId" value={from} onChange={(e) => setFrom(e.target.value)} required>
          <option value="" disabled>
            اختار…
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {kind === "TRANSFER" && <AccountSelect name="toAccountId" accounts={accounts} label="إلى حساب" error={fe(state, "toAccountId")} exclude={from} />}
      {kind === "ADJUSTMENT" && (
        <Field label="التصحيح" htmlFor="direction" error={fe(state, "direction")}>
          <NativeSelect id="direction" name="direction" defaultValue="" required>
            <option value="" disabled>
              اختار…
            </option>
            <option value="IN">زيادة الرصيد</option>
            <option value="OUT">نقص الرصيد</option>
          </NativeSelect>
        </Field>
      )}
      <Field label="المبلغ" htmlFor="mv-amount" error={fe(state, "amount")}>
        <MoneyField id="mv-amount" name="amount" value={amount} onChange={setAmount} invalid={!!fe(state, "amount")} />
      </Field>
      <Field label="التاريخ" htmlFor="mv-date" error={fe(state, "date")}>
        <Input id="mv-date" name="date" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label={kind === "ADJUSTMENT" ? "سبب التصحيح" : "ملاحظات"} htmlFor="mv-notes" error={fe(state, "notes")} optional={kind !== "ADJUSTMENT"}>
        <Textarea id="mv-notes" name="notes" className="min-h-20" required={kind === "ADJUSTMENT"} />
      </Field>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Submit pending={pending}>تسجيل الحركة</Submit>
    </form>
  );
}

export function ReconcileForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const [state, action, pending] = useActionState(reconcileAction, null);
  const [requestId] = useState(newRequestId);
  const [counted, setCounted] = useState("");
  return (
    <form action={action} className="space-y-4" data-testid="reconcile-form">
      <input type="hidden" name="idempotencyKey" value={requestId} />
      <AccountSelect name="accountId" accounts={accounts} label="الحساب" error={fe(state, "accountId")} />
      <Field label="تاريخ الجرد" htmlFor="rc-date" error={fe(state, "date")}>
        <Input id="rc-date" name="date" type="date" defaultValue={today} max={today} required />
      </Field>
      <Field label="المبلغ اللي عدّيته فعلًا" htmlFor="rc-counted" error={fe(state, "counted")} hint="العدّ الحقيقي — البرنامج هيقارنه بالرصيد المسجل ويسجّل الفرق.">
        <MoneyField id="rc-counted" name="counted" value={counted} onChange={setCounted} invalid={!!fe(state, "counted")} />
      </Field>
      <Field label="ملاحظات / سبب الفرق" htmlFor="rc-notes" error={fe(state, "notes")} optional>
        <Textarea id="rc-notes" name="notes" className="min-h-20" />
      </Field>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="adjust" value="yes" className="mt-0.5 size-5 shrink-0" />
        <span>لو فيه فرق، سجّل تصحيح للرصيد بنفس المبلغ (لازم سبب).</span>
      </label>
      <FormMessage message={state?.fieldErrors ? undefined : state?.message} />
      <Submit pending={pending}>تسجيل الجرد</Submit>
    </form>
  );
}

export function AttributeForm({ side, paymentId, accounts }: { side: "in" | "out"; paymentId: string; accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(attributePaymentAction, null);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-start gap-2">
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <NativeSelect name="accountId" defaultValue="" required aria-label="الحساب" className="h-11 min-w-0 flex-1">
        <option value="" disabled>
          {side === "in" ? "دخلت في…" : "خرجت من…"}
        </option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" disabled={pending} className="h-11 rounded-xl">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        تسجيل
      </Button>
      {(state?.message || fe(state, "accountId")) && <p className="w-full text-sm text-destructive">{fe(state, "accountId") ?? state?.message}</p>}
    </form>
  );
}

export function VoidMovementForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(voidMovementAction, null);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-semibold text-red">إلغاء الحركة</summary>
      <form action={action} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} />
        <Input name="reason" placeholder="سبب الإلغاء" required minLength={3} className="h-10 min-w-0 flex-1" />
        <Button type="submit" variant="outline" disabled={pending} className="h-10 rounded-xl text-red">
          تأكيد
        </Button>
        {state?.message && <p className="w-full text-xs text-destructive">{fe(state, "reason") ?? state.message}</p>}
      </form>
    </details>
  );
}

export function AccountActiveForm({ accountId, active }: { accountId: string; active: boolean }) {
  const [, action, pending] = useActionState(setAccountActiveAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="active" value={active ? "no" : "yes"} />
      <button type="submit" disabled={pending} className="text-xs font-semibold text-graphite underline underline-offset-2">
        {active ? "إيقاف الحساب" : "تفعيل الحساب"}
      </button>
    </form>
  );
}
