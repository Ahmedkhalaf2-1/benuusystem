"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { parseThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "فاتح", icon: Sun },
  { value: "dark", label: "غامق", icon: Moon },
  { value: "system", label: "زي الجهاز", icon: Monitor },
];

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function read(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Light / dark / follow the phone. Saved on this device; applied instantly. */
export function ThemeSelect() {
  const pref = useSyncExternalStore(subscribe, read, () => "system" as ThemePreference);
  function choose(value: ThemePreference) {
    try {
      if (value === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {}
    (window as unknown as { __bpApplyTheme?: () => void }).__bpApplyTheme?.();
    listeners.forEach((l) => l());
  }
  return (
    <fieldset>
      <legend className="mb-2 font-display text-[1.05rem] font-semibold">شكل البرنامج</legend>
      <div role="radiogroup" aria-label="شكل البرنامج" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-well p-1">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const on = pref === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              data-theme-option={value}
              onClick={() => choose(value)}
              className={cn(
                "flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors",
                on ? "bg-surface text-brand ring-1 ring-brand" : "text-graphite hover:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-graphite">بيتحفظ على الجهاز ده. «زي الجهاز» بيتغيّر لوحده مع إعداد الموبايل.</p>
    </fieldset>
  );
}
