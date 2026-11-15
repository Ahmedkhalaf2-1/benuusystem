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
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div role="radiogroup" aria-label={label} className={cn("grid gap-2", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-13 rounded-2xl px-3 py-2.5 text-[0.92rem] font-semibold leading-snug transition-[background-color,box-shadow,color,transform] duration-200 ease-[var(--ease-out-expo)] active:scale-[0.97]",
              value === o.value
                ? "bg-violet-soft text-violet ring-2 ring-violet"
                : "bg-well text-ink ring-1 ring-hairline hover:ring-violet/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
