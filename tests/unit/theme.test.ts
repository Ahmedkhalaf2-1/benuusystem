import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme, THEME_COLORS, THEME_STORAGE_KEY, themeInitScript } from "@/lib/theme";

/** Runs the inline <head> script against a minimal fake browser. */
function runScript(stored: string | null, osDark: boolean, storageThrows = false) {
  const classes = new Set<string>();
  let mediaListener: (() => void) | null = null;
  const media = { matches: osDark, addEventListener: (_: string, fn: () => void) => (mediaListener = fn) };
  const meta: { name?: string; content?: string } = {};
  const html = {
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const win = {
    matchMedia: () => media,
    addEventListener: () => {},
  } as unknown as Window & { __bpApplyTheme?: () => void };
  const doc = { documentElement: html, querySelector: () => null, createElement: () => meta, head: { appendChild: () => {} } };
  const storage = { getItem: (k: string) => { if (storageThrows) throw new Error("blocked"); return k === THEME_STORAGE_KEY ? stored : null; } };
  new Function("window", "document", "localStorage", themeInitScript)(win, doc, storage);
  return { classes, html, meta, media, fireOsChange: (dark: boolean) => { media.matches = dark; mediaListener?.(); } };
}

describe("theme preference", () => {
  it("parses only known values; anything else means system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("blue")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });
  it("resolves system against the OS, explicit choices win", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("inline theme script (applied before first paint)", () => {
  it("applies a saved dark choice and the matching browser colour", () => {
    const r = runScript("dark", false);
    expect(r.classes.has("dark")).toBe(true);
    expect(r.html.dataset.theme).toBe("dark");
    expect(r.html.style.colorScheme).toBe("dark");
    expect(r.meta.content).toBe(THEME_COLORS.dark);
  });
  it("saved light beats a dark OS", () => {
    const r = runScript("light", true);
    expect(r.classes.has("dark")).toBe(false);
    expect(r.meta.content).toBe(THEME_COLORS.light);
  });
  it("system follows the OS, including live changes", () => {
    const r = runScript(null, true);
    expect(r.classes.has("dark")).toBe(true);
    expect(r.html.dataset.themePref).toBe("system");
    r.fireOsChange(false);
    expect(r.classes.has("dark")).toBe(false);
  });
  it("never throws when storage is unavailable (falls back to system)", () => {
    expect(() => runScript(null, false, true)).not.toThrow();
  });
});
