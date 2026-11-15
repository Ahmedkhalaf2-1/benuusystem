/**
 * Theme preference: "light" | "dark" | "system" (default), saved in
 * localStorage. The inline script below runs in <head> before the body is
 * parsed, so the right theme is applied before anything is painted (no flash),
 * and it keeps following the OS while the preference is "system".
 */
export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "bp-theme";
export const THEME_COLORS = { light: "#f6f8fb", dark: "#12151b" } as const;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** The theme actually shown for a preference, given whether the OS prefers dark. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  return pref === "dark" || (pref === "system" && systemPrefersDark) ? "dark" : "light";
}

/** Self-contained (no imports at runtime): inlined into <head> as-is. */
export const themeInitScript = `(function(){try{
var K=${JSON.stringify(THEME_STORAGE_KEY)},C=${JSON.stringify(THEME_COLORS)},d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");
function pref(){var v=null;try{v=localStorage.getItem(K)}catch(e){}return v==="light"||v==="dark"?v:"system"}
function apply(){var p=pref(),t=p==="dark"||(p==="system"&&m.matches)?"dark":"light";
d.classList.toggle("dark",t==="dark");d.dataset.theme=t;d.dataset.themePref=p;d.style.colorScheme=t;
var meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement("meta");meta.name="theme-color";document.head.appendChild(meta)}meta.content=C[t]}
apply();m.addEventListener("change",apply);window.addEventListener("storage",function(e){if(e.key===K)apply()});window.__bpApplyTheme=apply;
}catch(e){}})();`;
