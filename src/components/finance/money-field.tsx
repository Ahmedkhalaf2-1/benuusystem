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
        className="h-14 ps-14 text-left text-xl font-bold placeholder:text-base placeholder:font-normal"
        aria-invalid={invalid ? true : undefined}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">ج.م</span>
    </div>
  );
}
