---
name: Benuuprint ERP
description: Modern Luxury Tech — one brand, graphite/silver/pearl neutrals with a single sapphire accent, in complete light and dark themes.
colors:
  light:
    background: "#f6f8fb"
    surface: "#ffffff"
    well: "#f1f4f8"
    elevated: "#ffffff"
    border: "#e1e6ec"
    border-strong: "#c3cad4"
    track: "#e4e9ef"
    ink: "#171a20"
    muted: "#565e6b"
    panel: "#171a20"
    panel-2: "#222731"
    panel-line: "#363d48"
    on-panel: "#f6f8fb"
    on-panel-muted: "#b9c0ca"
    brand: "#2864c5"
    brand-solid: "#2864c5"
    brand-hover: "#1f51a3"
    brand-soft: "#e7eef9"
    brand-ink: "#1d4c99"
    brand-muted: "#9cb8e6"
    success: "#1e8a4c"
    warning: "#c27a0e"
    danger: "#c4372f"
  dark:
    background: "#12151b"
    surface: "#1c212a"
    well: "#171b22"
    elevated: "#252b35"
    border: "#343c48"
    border-strong: "#4a5462"
    track: "#2b323d"
    ink: "#f0f2f6"
    muted: "#a8b1bf"
    panel: "#252b35"
    panel-2: "#2e3541"
    panel-line: "#3d4653"
    on-panel: "#f0f2f6"
    on-panel-muted: "#b2bac7"
    brand: "#6fa0f4"
    brand-solid: "#2f6fd8"
    brand-hover: "#3d7be6"
    brand-soft: "#1d2a40"
    brand-ink: "#9ec0f8"
    brand-muted: "#3e5f93"
    success: "#4cc283"
    warning: "#e6a63c"
    danger: "#ef6b62"
typography:
  display: { fontFamily: "Readex Pro, IBM Plex Sans Arabic, system-ui", fontWeight: 600, letterSpacing: "-0.02em" }
  body: { fontFamily: "IBM Plex Sans Arabic, system-ui", fontSize: "1rem", lineHeight: 1.6 }
rounded: { sm: "6px", md: "8px", lg: "10px", xl: "12px", 2xl: "14px", 3xl: "16px", pill: "9999px" }
---

# Design System: Benuuprint ERP — Modern Luxury Tech

## Brand

- **Primary asset:** `public/benuuprint-3d.png` (approved silver/white 3D logo,
  1254×1254, transparent). It is never redrawn, recoloured or given effects.
- **Derivatives** (`npm run icons` → `scripts/generate-icons.mjs`):
  - `public/brand/benuuprint-logo-{512,1024}.png` — full logo, trimmed, transparent.
  - `public/brand/benuuprint-symbol-{128,256,512}.png` — symbol only (the
    wordmark bar is cut along the transparent gap above it, then trimmed).
  - `public/icons/icon-{192,512}.png`, `maskable-512.png`, `src/app/icon.png`
    (favicon), `src/app/apple-icon.png` — the symbol on a solid graphite
    (#171A20) tile. The full wordmark is never squeezed into small icons.
- **In the app:** `BrandSymbol` (symbol on a graphite tile: header, sidebar, 404)
  and `BrandLogo` (full logo, only on graphite panels: login). The mark is
  white, so it always sits on graphite in both themes.

## Principles

1. **One accent.** Sapphire marks action, selection, focus, links and
   progress. No module has its own colour.
2. **Meaning colours only:** green = received/confirmed/completed, amber =
   needs action/warning, red = overdue/error/destructive. Every colour is
   paired with a word or icon — never colour alone.
3. **No effects:** no shadows, glows, gradients, glass or blur. Depth comes from
   surface steps (background → surface → well/elevated), 1px borders and the
   graphite **panel**.
4. **Precise shapes:** 10–14px radii for cards and fields, 12px for buttons,
   pills only for small status chips and navigation markers.
5. **Rich through composition:** a graphite panel opens the key screens
   (dashboard, order, new order, profiles, login), large Readex Pro figures,
   clear hierarchy — not decoration.

## Tokens

Semantic CSS variables in `src/app/globals.css` (`:root` = light, `.dark` =
dark), exposed as Tailwind colours: `bg-background · bg-surface · bg-well ·
bg-elevated · border-line · border-line-strong · bg-track · text-ink ·
text-graphite · bg-panel · bg-panel-2 · ring-panel-line · text-on-panel ·
text-on-panel-muted · text-brand · bg-brand-solid · bg-brand-soft ·
text-brand-ink · bg-brand-muted · text-on-brand · success/warning/danger
(-ink, -soft, -solid) · text-panel-{success,warning,danger}`.
Legacy names (violet, blue, teal, rose…) are aliases of the brand tokens so
older call sites cannot reintroduce per-module colours. Shadow tokens resolve
to `none`.

Contrast (normal text, WCAG AA): light — ink 16.9:1, muted 6.1:1, brand 5.6:1
on white, white on brand-solid 5.6:1; dark — ink 14.6:1, muted 7.6:1, brand
6.0:1 on surface, white on brand-solid 4.8:1. Verified per screen by the
browser contrast audit (both themes, 0 failures).

## Themes

- **Light:** pearl background, white sheets, graphite type, graphite panels.
- **Dark:** designed separately — deep graphite background #12151B, surfaces
  #1C212A, raised panels #252B35, borders #343C48, readable sapphire #6FA0F4 for
  text and #2F6FD8 for filled buttons.
- **Preference:** Light / Dark / System in «المزيد» → «شكل البرنامج», stored in
  `localStorage` (`bp-theme`). An inline script in `<head>`
  (`src/lib/theme.ts`) applies it before first paint (no flash), follows OS
  changes in System mode, and keeps the browser `theme-color` in step.
- **PWA:** manifest `theme_color` #171A20, `background_color` #F6F8FB.

## Components

- **Panel** (`stage` utility / `bg-panel`): graphite block with on-panel text,
  inner chips on `bg-panel-2` with `ring-panel-line`.
- **Cards:** `bg-surface border border-line rounded-2xl`; hover strengthens the
  border.
- **Buttons:** primary `bg-brand-solid text-on-brand`; secondary
  `bg-surface border-line`; destructive `bg-danger-solid`. One primary per area.
- **Quick actions:** six equal tiles, sapphire-tint icon squares; «أوردر جديد»
  is the only filled tile.
- **Production bar:** delivered = solid sapphire, ready = muted sapphire,
  remaining = track; on the panel: delivered = on-panel, ready = sapphire.
  Always labelled with numbers.
- **Status pills:** new = neutral, in progress = sapphire tint, completed =
  green tint, cancelled = muted + struck through, overdue = red tint.
- **Bottom bar:** solid surface with a border, raised sapphire «+».

## Do / Don't

Do keep every colour semantic, keep the logo on graphite, keep figures in
Readex Pro tabular numerals, and test both themes. Don't add shadows, glows,
gradients, blur, neon, per-module colours, or effects to the logo.
