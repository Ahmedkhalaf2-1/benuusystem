"use client";

import { formatNumber } from "@/lib/numbers";
import { cn } from "@/lib/utils";

export type SizeRow = { id: string; label: string; hint: string; max?: number };

/** One row per size: what it has so far, and how many to record now. Empty = skip. */
export function SizeQuantities({
  rows,
  values,
  onChange,
  errors,
  unitLabel,
  quickFill,
}: {
  rows: SizeRow[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors: Record<string, string>;
  unitLabel: string;
  /** Optional "fill every size with its max" shortcut label. */
  quickFill?: string;
}) {
  const total = rows.reduce((sum, r) => sum + (Number.parseInt(values[r.id] ?? "", 10) || 0), 0);
  return (
    <div data-error={rows.some((r) => errors[`size:${r.id}`]) ? "true" : undefined}>
      <ul className="grid grid-cols-2 gap-2">
        {rows.map((r) => {
          const error = errors[`size:${r.id}`];
          const n = Number.parseInt(values[r.id] ?? "", 10) || 0;
          return (
            <li
              key={r.id}
              className={cn(
                "rounded-2xl p-2.5 transition-colors duration-200",
                error ? "bg-red-soft ring-2 ring-red/40" : n > 0 ? "bg-violet-soft ring-1 ring-violet/30" : "bg-well ring-1 ring-hairline",
              )}
            >
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <span className={cn("font-display text-lg font-semibold", n > 0 ? "text-violet" : "text-ink")} dir="auto">
                  {r.label}
                </span>
                {r.max !== undefined && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...values, [r.id]: String(r.max) })}
                    disabled={r.max <= 0}
                    className="tabular rounded-full px-2 py-0.5 text-xs font-semibold text-violet hover:bg-surface disabled:text-graphite/60"
                    aria-label={`املا مقاس ${r.label} بـ ${r.max}`}
                  >
                    لحد {formatNumber(r.max)}
                  </button>
                )}
              </div>
              <input
                inputMode="numeric"
                aria-label={`عدد مقاس ${r.label}`}
                value={values[r.id] ?? ""}
                onChange={(e) => onChange({ ...values, [r.id]: e.target.value })}
                placeholder="0"
                aria-invalid={error ? true : undefined}
                className="tabular mt-1.5 h-12 w-full rounded-xl border-0 bg-surface text-center font-display text-xl font-semibold border border-line outline-none placeholder:text-ink/20 focus-visible:ring-3 focus-visible:ring-violet/35"
              />
              <p className="mt-1.5 truncate px-0.5 text-[0.7rem] text-graphite">{r.hint}</p>
              {error && <p className="mt-1 px-0.5 text-xs font-medium text-red">{error}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        {quickFill ? (
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(rows.filter((r) => (r.max ?? 0) > 0).map((r) => [r.id, String(r.max)])))}
            className="inline-flex h-10 items-center rounded-full bg-violet-soft px-4 font-semibold text-violet transition-transform active:scale-95"
          >
            {quickFill}
          </button>
        ) : (
          <span />
        )}
        <span className="rounded-full bg-panel px-3.5 py-1.5 font-semibold text-on-panel">
          المجموع <span className="tabular font-display">{formatNumber(total)}</span> {unitLabel}
        </span>
      </div>
    </div>
  );
}

export function sizeLines(values: Record<string, string>) {
  return Object.entries(values)
    .filter(([, v]) => v.trim() !== "")
    .map(([sizeId, quantity]) => ({ sizeId, quantity }));
}
