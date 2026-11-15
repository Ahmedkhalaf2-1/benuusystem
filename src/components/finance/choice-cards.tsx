"use client";

import { cn } from "@/lib/utils";

/** Big single-choice cards (radio group) — for categories, pay status, method. */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 2,
  error,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (value: T) => void;
  columns?: 2 | 3;
  error?: string;
}) {
  return (
    <fieldset data-error={error ? "true" : undefined}>
      <legend className="mb-1.5 text-[0.95rem] font-medium">{label}</legend>
      <div role="radiogroup" aria-label={label} className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-12 rounded-xl border-2 px-2 py-2 text-[0.92rem] font-semibold leading-snug",
              value === o.value ? "border-primary bg-brand-soft text-primary" : "border-border bg-surface hover:border-primary/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
