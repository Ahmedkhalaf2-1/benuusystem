"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { formatNumber, parseWholeNumber } from "@/lib/numbers";
import { COMMON_SIZES, normalizeSizeLabel } from "@/lib/orders/sizes";
import { cn } from "@/lib/utils";
import type { SizeDraft } from "./order-draft";

/**
 * "المقاسات والكميات": type the pieces under each size (no +/− tapping).
 * Common sizes are always offered; any other size (38, 10 سنين…) can be added.
 * Live status tells whether the sizes add up to the group's quantity.
 */
export function SizeGrid({
  sizes,
  target,
  unitLabel,
  error,
  idPrefix,
  onChange,
}: {
  sizes: SizeDraft[];
  target: number | null;
  unitLabel: string;
  error?: string;
  idPrefix: string;
  onChange: (sizes: SizeDraft[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const value = (label: string) => sizes.find((s) => s.label === label)?.quantity ?? "";
  const customLabels = sizes.map((s) => s.label).filter((l) => !(COMMON_SIZES as readonly string[]).includes(l));
  const labels = [...COMMON_SIZES, ...customLabels];
  const sum = sizes.reduce((acc, s) => acc + (parseWholeNumber(s.quantity) ?? 0), 0);

  function setQty(label: string, quantity: string) {
    const rest = sizes.filter((s) => s.label !== label);
    const isCustom = !(COMMON_SIZES as readonly string[]).includes(label);
    // Common sizes left empty disappear; custom sizes stay until removed.
    onChange(quantity.trim() === "" && !isCustom ? rest : [...rest, { label, quantity }].sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label)));
  }

  function addCustom() {
    const label = normalizeSizeLabel(custom);
    if (!label) return;
    if (!labels.includes(label)) onChange([...sizes, { label, quantity: "" }]);
    setCustom("");
    setAdding(false);
    setTimeout(() => document.getElementById(`${idPrefix}-size-${label}`)?.focus(), 0);
  }

  const status =
    target === null || target <= 0
      ? { text: `اكتب الكمية الأول — اتوزع ${formatNumber(sum)}`, tone: "plain" as const }
      : sum === target
        ? { text: `تم توزيع ${formatNumber(sum)} من ${formatNumber(target)} ${unitLabel}`, tone: "ok" as const }
        : sum < target
          ? { text: `لسه ${formatNumber(target - sum)} ${unitLabel} محتاجة توزيع`, tone: "warn" as const }
          : { text: `زيادة ${formatNumber(sum - target)} ${unitLabel} عن الكمية`, tone: "bad" as const };

  const max = Math.max(1, ...sizes.map((sz) => parseWholeNumber(sz.quantity) ?? 0));
  const fill = target && target > 0 ? Math.min(100, (sum / target) * 100) : 0;

  return (
    <div data-error={error ? "true" : undefined} data-size-grid={idPrefix} className="scroll-mt-24">
      {/* The rail: one column per size, each with a small bar of its share. */}
      <div className="grid grid-cols-4 gap-2">
        {labels.map((label) => {
          const v = value(label);
          const n = parseWholeNumber(v) ?? 0;
          const isCustom = customLabels.includes(label);
          return (
            <label key={label} htmlFor={`${idPrefix}-size-${label}`} className={cn("group/size relative flex min-w-0 flex-col items-stretch rounded-2xl p-1.5 pt-2 transition-colors duration-200", n > 0 ? "bg-violet-soft ring-1 ring-violet/30" : "bg-well ring-1 ring-hairline")}>
              <span className={cn("truncate pb-1.5 text-center font-display text-sm font-semibold", n > 0 ? "text-violet" : "text-ink")} dir="ltr">
                {label}
              </span>
              <input
                id={`${idPrefix}-size-${label}`}
                inputMode="numeric"
                aria-label={`عدد مقاس ${label}`}
                value={v}
                onChange={(e) => setQty(label, e.target.value)}
                placeholder="·"
                className={cn(
                  "tabular h-11 w-full min-w-0 rounded-xl border-0 bg-surface px-0 text-center font-display text-[1.05rem] font-semibold border border-line outline-none transition-shadow placeholder:text-ink/25 focus-visible:ring-3 focus-visible:ring-violet/35",
                  n > 0 && "text-violet",
                )}
              />
              <span aria-hidden="true" className="mx-1 mt-1.5 h-1 overflow-hidden rounded-full bg-track">
                <span className="block h-full bg-brand-solid transition-[width] duration-300 ease-[var(--ease-out-expo)]" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              {isCustom && (
                <button
                  type="button"
                  onClick={() => onChange(sizes.filter((x) => x.label !== label))}
                  className="absolute -top-2 -end-2 flex size-6 items-center justify-center rounded-full bg-brand-solid text-on-brand border border-line"
                  aria-label={`شيل مقاس ${label}`}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </label>
          );
        })}
      </div>

      {/* Distribution against the quantity: a gauge with the target at its end. */}
      <div className="mt-4">
        <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-full bg-track">
          <span
            className={cn("absolute inset-y-0 start-0 rounded-full transition-[width] duration-300 ease-[var(--ease-out-expo)]", status.tone === "bad" ? "bg-danger-solid" : status.tone === "ok" ? "bg-success-solid" : "bg-brand-solid")}
            style={{ width: `${fill}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p
            aria-live="polite"
            className={cn(
              "text-sm font-semibold",
              status.tone === "ok" && "text-success-ink",
              status.tone === "warn" && "text-warning-ink",
              status.tone === "bad" && "text-red",
              status.tone === "plain" && "text-graphite",
            )}
          >
            {status.text}
          </p>
          {adding ? null : (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-1 text-sm font-semibold text-violet">
              <Plus className="size-4" aria-hidden="true" />
              مقاس تاني
            </button>
          )}
        </div>
        {adding && (
          <div className="mt-2 flex w-full items-center gap-2">
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="مثال: 38 أو 10 سنين"
              aria-label="اسم المقاس"
              className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-surface px-3 text-base outline-none focus-visible:border-violet focus-visible:ring-3 focus-visible:ring-violet/25"
            />
            <button type="button" onClick={addCustom} className="h-11 shrink-0 rounded-xl bg-panel px-4 text-sm font-semibold text-on-panel">
              إضافة
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-sm text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
