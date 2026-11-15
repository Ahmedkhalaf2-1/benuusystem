"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type EntityChoice =
  | { mode: "existing"; id: string; name: string; phone: string | null }
  | { mode: "new"; name: string; phone: string };

export type EntityPickerTexts = {
  /** e.g. "/api/customers/search" — must return { ok, data: [{id,name,phone}] }. */
  searchUrl: string;
  placeholder: string;
  /** "عميل جديد" / "مورد جديد" */
  newNoun: string;
  /** Subtitle under a selected existing entity without a phone. */
  existingNoun: string;
  newPendingNote: string;
  phoneLabel: string;
  notFound: string;
  emptyHint: string;
  loadFailed: string;
};

type Match = { id: string; name: string; phone: string | null };

/**
 * Type a name → pick an existing record, or add a new one right here
 * (no popup, no leaving the form). Used for customers and suppliers.
 */
export function EntityPicker({
  value,
  onChange,
  error,
  phoneError,
  texts,
}: {
  value: EntityChoice | null;
  onChange: (value: EntityChoice | null) => void;
  error?: string;
  phoneError?: string;
  texts: EntityPickerTexts;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value || !open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`${texts.searchUrl}?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (body.ok) {
          setMatches(body.data);
          setLookupFailed(false);
        } else {
          setLookupFailed(true);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setLookupFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, value, texts.searchUrl]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (value) {
    return (
      <div className="space-y-3">
        <div
          data-error={error ? "true" : undefined}
          className="flex min-h-12 items-center gap-3 rounded-2xl bg-violet-soft px-3.5 py-2 ring-1 ring-violet/30"
        >
          {value.mode === "existing" ? (
            <Check className="size-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <UserPlus className="size-5 shrink-0 text-primary" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              {value.mode === "existing" ? (value.phone ? <span dir="ltr">{value.phone}</span> : texts.existingNoun) : texts.newPendingNote}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery(value.name);
              onChange(null);
              setOpen(true);
            }}
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-violet hover:bg-surface"
          >
            <X className="size-4" aria-hidden="true" />
            تغيير
          </button>
        </div>
        {value.mode === "new" && (
          <div className="space-y-1.5">
            <label htmlFor={`${inputId}-phone`} className="text-[0.95rem] font-medium">
              {texts.phoneLabel} <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>
            </label>
            <Input
              id={`${inputId}-phone`}
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-left"
              placeholder="01xxxxxxxxx"
              value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })}
              aria-invalid={phoneError ? true : undefined}
            />
            {phoneError && <p className="text-sm text-destructive">{phoneError}</p>}
          </div>
        )}
      </div>
    );
  }

  const typed = query.trim();
  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-5 text-muted-foreground" aria-hidden="true" />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-list`}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder={texts.placeholder}
          className="ps-11"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {loading && <Loader2 className="absolute inset-y-0 end-3.5 my-auto size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      {open && (
        <ul
          id={`${inputId}-list`}
          role="listbox"
          className="mt-2 max-h-80 overflow-y-auto rounded-2xl bg-popover p-1.5 border border-line ring-1 ring-hairline"
        >
          {matches.map((match) => (
            <li key={match.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange({ mode: "existing", ...match });
                  setOpen(false);
                }}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-start transition-colors hover:bg-well active:bg-well"
              >
                <span className="font-medium">{match.name}</span>
                {match.phone && (
                  <span dir="ltr" className="text-sm text-muted-foreground">
                    {match.phone}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!loading && typed && matches.length === 0 && !lookupFailed && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{texts.notFound}</li>
          )}
          {lookupFailed && <li className="px-3 py-2 text-sm text-destructive">{texts.loadFailed}</li>}
          {typed && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange({ mode: "new", name: typed, phone: "" });
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-12 w-full items-center gap-2 rounded-lg px-3 py-2 text-start font-semibold text-primary hover:bg-brand-soft",
                  matches.length > 0 && "mt-1 border-t pt-3",
                )}
              >
                <UserPlus className="size-5 shrink-0" aria-hidden="true" />
                إضافة {texts.newNoun}: «{typed}»
              </button>
            </li>
          )}
          {!typed && matches.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{texts.emptyHint}</li>
          )}
        </ul>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
