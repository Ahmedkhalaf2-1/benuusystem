"use client";

import { Input } from "@/components/ui/input";

/** Large, left-aligned amount input with a ج.م suffix. */
export function MoneyField({
  id,
  name,
  value,
  onChange,
  invalid,
  placeholder,
  autoFocus,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        dir="ltr"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0"}
        className="tabular h-16 rounded-2xl ps-14 text-left font-display text-[1.75rem] font-semibold tracking-[-0.02em] placeholder:text-ink/20"
        aria-invalid={invalid ? true : undefined}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-graphite">ج.م</span>
    </div>
  );
}
