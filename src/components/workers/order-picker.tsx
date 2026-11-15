"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { OpenOrderOption } from "@/server/services/order-service";

/** Search an open order (or choose "no order"). No popup. */
export function OrderPicker({
  value,
  onChange,
  error,
}: {
  value: OpenOrderOption | null | "none";
  onChange: (value: OpenOrderOption | null | "none") => void;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpenOrderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (value) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/orders/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const body = await res.json();
        if (body.ok) {
          setResults(body.data);
          setFailed(false);
        } else setFailed(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  if (value) {
    return (
      <div data-error={error ? "true" : undefined} className="flex min-h-12 items-center gap-3 rounded-2xl bg-violet-soft px-3.5 py-2 ring-1 ring-violet/30">
        <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {value === "none" ? (
            <p className="font-semibold">بدون أوردر</p>
          ) : (
            <>
              <p className="truncate font-semibold">
                <span dir="ltr">#{String(value.number).padStart(4, "0")}</span> {value.customerName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{value.title}</p>
            </>
          )}
        </div>
        <button type="button" onClick={() => onChange(null)} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-violet hover:bg-surface">
          <X className="size-4" aria-hidden="true" />
          تغيير
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-5 text-muted-foreground" aria-hidden="true" />
        <Input
          role="combobox"
          aria-expanded="true"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder="رقم الأوردر أو اسم العميل"
          className="ps-11"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <Loader2 className="absolute inset-y-0 end-3.5 my-auto size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>
      <ul role="listbox" className="mt-2 max-h-72 overflow-y-auto rounded-2xl bg-popover p-1.5 border border-line ring-1 ring-hairline">
        {results.map((o) => (
          <li key={o.id} role="option" aria-selected={false}>
            <button type="button" onClick={() => onChange(o)} className="flex min-h-12 w-full flex-col items-start rounded-xl px-3 py-2 text-start transition-colors hover:bg-well">
              <span className="font-medium">
                <span dir="ltr">#{String(o.number).padStart(4, "0")}</span> {o.customerName}
              </span>
              <span className="text-xs text-muted-foreground">{o.title}</span>
            </button>
          </li>
        ))}
        {!loading && results.length === 0 && !failed && <li className="px-3 py-2 text-sm text-muted-foreground">مفيش أوردرات شغّالة بالبحث ده.</li>}
        {failed && <li className="px-3 py-2 text-sm text-destructive">مقدرناش نجيب الأوردرات. حاول تاني.</li>}
        <li role="option" aria-selected={false}>
          <button type="button" onClick={() => onChange("none")} className="mt-1 flex min-h-12 w-full items-center rounded-lg border-t px-3 py-2 text-start text-sm font-medium text-muted-foreground hover:bg-muted">
            شغل مش تبع أوردر معيّن
          </button>
        </li>
      </ul>
      {error && (
        <p className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
