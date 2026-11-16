"use client";

import { AccountField } from "@/components/treasury/account-field";
import type { AccountOption } from "@/lib/treasury/labels";

import { Field, NativeSelect } from "@/components/forms/field";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { PAY_STATUS_LABELS, PAY_STATUSES, type PayStatus } from "@/lib/finance/labels";
import { formatMoney, parseMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import { ChoiceCards } from "./choice-cards";
import { MoneyField } from "./money-field";

/**
 * "اتدفع؟" → مدفوع بالكامل / مدفوع جزء / آجل. Shows "دفعت كام؟" only for a
 * partial payment, the method only when something was paid, and the live
 * "لسه عليه كام؟".
 */
export function PayNowFields({
  amount,
  payStatus,
  paidNow,
  method,
  onChange,
  errors,
  accounts = [],
  accountId = "",
}: {
  amount: string;
  payStatus: PayStatus | "";
  paidNow: string;
  method: PaymentMethod;
  accounts?: AccountOption[];
  accountId?: string;
  onChange: (patch: { payStatus?: PayStatus; paidNow?: string; method?: PaymentMethod; accountId?: string }) => void;
  errors: Record<string, string | undefined>;
}) {
  const total = parseMoney(amount);
  const now =
    payStatus === "FULL" ? total : payStatus === "PARTIAL" ? (paidNow.trim() ? parseMoney(paidNow) : 0n) : payStatus === "CREDIT" ? 0n : null;
  const left = total !== null && now !== null ? total - now : null;

  return (
    <div className="space-y-4">
      <ChoiceCards
        label="اتدفع؟"
        options={PAY_STATUSES.map((s) => ({ value: s, label: PAY_STATUS_LABELS[s] }))}
        value={payStatus}
        onChange={(s) => onChange({ payStatus: s })}
        columns={3}
        error={errors.payStatus}
      />
      {payStatus === "PARTIAL" && (
        <Field label="دفعت كام؟" htmlFor="paidNow" error={errors.paidNow}>
          <MoneyField id="paidNow" value={paidNow} onChange={(v) => onChange({ paidNow: v })} invalid={!!errors.paidNow} />
        </Field>
      )}
      {(payStatus === "FULL" || payStatus === "PARTIAL") && (
        <Field label="اتدفع إزاي؟" htmlFor="method">
          <NativeSelect id="method" value={method} onChange={(e) => onChange({ method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {(payStatus === "FULL" || payStatus === "PARTIAL") && (
        <AccountField accounts={accounts} value={accountId} onChange={(id) => onChange({ accountId: id })} direction="out" error={errors.accountId} />
      )}
      {payStatus && (
        <div className="flex items-center justify-between rounded-xl bg-brand-soft px-4 py-3">
          <span className="font-medium">لسه عليه كام؟</span>
          <span className={cn("text-2xl font-bold", left !== null && left < 0n ? "text-destructive" : "text-primary")} aria-live="polite">
            {left !== null ? formatMoney(left) : "—"}
          </span>
        </div>
      )}
    </div>
  );
}
