"use client";

import { Input } from "@/components/ui/input";
import type { PrintOperation } from "@/generated/prisma/enums";
import { NO_OPERATION_LABEL, OPERATION_LABELS, PRINT_OPERATIONS } from "@/lib/orders/labels";
import { cn } from "@/lib/utils";
import type { GroupDraft } from "./order-draft";

/** Shared building blocks of the order form. */

/** A selectable option: violet and lifted when chosen, a soft well when not. */
export function chip(selected: boolean) {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3.5 text-[0.95rem] font-semibold transition-[background-color,box-shadow,color,transform] duration-200 ease-[var(--ease-out-expo)] active:scale-[0.96]",
    selected
      ? "bg-brand-solid text-white"
      : "bg-well text-ink ring-1 ring-hairline hover:ring-violet/40",
  );
}


export function MoneyInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
  large,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  large?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0"}
        className={cn(
          "tabular pe-3.5 ps-14 text-left font-display font-semibold placeholder:font-normal placeholder:text-ink/25",
          large ? "h-16 text-[1.75rem] tracking-[-0.02em]" : "h-12 text-lg",
        )}
        aria-invalid={invalid ? true : undefined}
        disabled={disabled}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-graphite">ج.م</span>
    </div>
  );
}


/** Work on the piece: steps combine on the same garment; "none" is exclusive. */
export function OperationPicker({
  group,
  error,
  onChange,
}: {
  group: GroupDraft;
  error?: string;
  onChange: (patch: (latest: GroupDraft) => Partial<GroupDraft>) => void;
}) {
  // Computed from the latest state, so two quick taps never lose a selection.
  const toggle = (op: PrintOperation) =>
    onChange((latest) => ({
      plain: false,
      operations: latest.operations.includes(op) ? latest.operations.filter((o) => o !== op) : [...latest.operations, op],
    }));

  return (
    <div data-error={error ? "true" : undefined}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="نوع الشغل">
        {PRINT_OPERATIONS.map((op) => {
          const selected = group.operations.includes(op);
          return (
            <button key={op} type="button" role="checkbox" aria-checked={selected} onClick={() => toggle(op)} className={chip(selected)}>
              {OPERATION_LABELS[op]}
            </button>
          );
        })}
        <button
          type="button"
          role="checkbox"
          aria-checked={group.plain}
          onClick={() => onChange((latest) => ({ plain: !latest.plain, operations: [] }))}
          className={cn(chip(group.plain), "font-medium")}
        >
          {NO_OPERATION_LABEL}
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
