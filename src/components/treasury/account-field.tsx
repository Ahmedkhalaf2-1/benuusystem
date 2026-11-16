"use client";

import { Banknote, Landmark, Smartphone, type LucideIcon } from "lucide-react";
import type { FinancialAccountType } from "@/generated/prisma/enums";
import type { AccountOption } from "@/lib/treasury/labels";
import { cn } from "@/lib/utils";

const ICONS: Record<FinancialAccountType, LucideIcon> = { CASH: Banknote, BANK: Landmark, WALLET: Smartphone };

/**
 * «الحساب اللي الفلوس دخلت فيه / خرجت منه». Account NAMES only — never a
 * balance. Renders nothing until the owner has set up the treasury.
 * `name` adds a hidden input for FormData forms.
 */
export function AccountField({
  accounts,
  value,
  onChange,
  direction,
  error,
  name,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
  direction: "in" | "out";
  error?: string;
  name?: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="space-y-1.5" data-error={error ? "true" : undefined}>
      {name && <input type="hidden" name={name} value={value} />}
      <p className="text-sm font-semibold text-ink" id="account-field-label">
        {direction === "in" ? "الحساب اللي الفلوس دخلت فيه" : "الحساب اللي الفلوس خرجت منه"}
      </p>
      <div role="radiogroup" aria-labelledby="account-field-label" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {accounts.map((a) => {
          const Icon = ICONS[a.type];
          const on = value === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-account={a.id}
              onClick={() => onChange(a.id)}
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-xl border px-3 text-start text-sm font-semibold transition-colors",
                on ? "border-primary bg-brand-soft text-primary" : "border-border bg-surface",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{a.name}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Pre-selects only when there is exactly one account; otherwise the person must choose. */
export function defaultAccountId(accounts: AccountOption[]): string {
  return accounts.length === 1 ? accounts[0]!.id : "";
}
