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

# Design System: Benuuprint ERP

## 1. Overview

**Personality:** a precise workshop instrument. Calm graphite and silver,
with one sapphire accent that marks the next action. Benuuprint runs a print
and garment shop: staff use it one-handed on the shop floor, and the owner
trusts its numbers. Every screen answers *what is the state of the work* first
and *what is the money* only for those allowed to see it.

**Mode: Operate.** This is a tool, not a brochure:

- no hero sections, stock photography, scroll animations, 3D, gradients,
  glass or glow;
- brand lives in precise details: the graphite panel, Readex Pro figures, the
  production track and the sapphire focus ring.

**Language:** natural Egyptian business Arabic, RTL first. No accounting or
ERP jargon in the interface (`PRODUCT.md`).

## 2. Colors

All colours are semantic CSS variables in `src/app/globals.css` (`:root` =
light, `.dark` = dark), exposed as Tailwind colours. Never hard-code a hex in
a component.

### Brand and accent

- **Sapphire** (`brand`, `brand-solid`, `brand-soft`, `brand-ink`,
  `brand-muted`) is the only accent. It marks:
  - the primary action;
  - the current selection;
  - focus;
  - links;
  - progress.
- No module has its own colour. Legacy names (`violet`, `blue`, `teal`…) are
  aliases of the brand tokens and must not be used for new work.

### Surface ladder (depth without shadows)

`background` (pearl / deep graphite) → `surface` (sheets) → `well` (inset
groups) → `elevated`, plus the graphite **panel** (`panel`, `panel-2`,
`panel-line`, `on-panel`, `on-panel-muted`).

Nested content **alternates** surfaces (surface → well → surface) instead of
stacking bordered cards. Example: an order item on `well`, its designs on
`surface` with a 1px ring.

### Text

- `ink` for primary text.
- `graphite` / `muted-foreground` for secondary text.
- On the panel, `on-panel` and `on-panel-muted` (silver).
- Placeholders keep 4.5:1 contrast.

### Meaning colours (always paired with a word or icon)

| Meaning | Token | Used for |
| --- | --- | --- |
| Done / received / verified | `success` (`-soft`, `-ink`, `panel-success`) | completed orders, paid, «مطابق», «كل الحركات متحددة» |
| Needs action | `warning` (`-soft`, `-ink`, `panel-warning`) | unpaid («لسه متدفعش»), due soon, incomplete treasury |
| In progress | `brand-soft` / `brand-ink` | in-progress status, partly paid |
| Wrong / overdue / destructive | `danger` (`-soft`, `-ink`, `-solid`) | overdue, negative balance, count difference, delete/void |

An unpaid bill is **amber, not red**: it is a task, not a fault.

### Contrast (WCAG AA, verified per theme)

- **Light:** ink 16.9:1, muted 6.1:1, brand 5.6:1 on white, white on
  brand-solid 5.6:1.
- **Dark:** ink 14.6:1, muted 7.6:1, brand 6.0:1 on surface, white on
  brand-solid 4.8:1.

## 3. Typography

| Role | Face | Size / weight | Notes |
| --- | --- | --- | --- |
| Page title | Readex Pro | 1.6–1.75rem / 600 | `tracking-[-0.02em]`, one per page |
| Section title | Readex Pro | 1.05–1.15rem / 600 | names a thing, never an eyebrow above it |
| Figures (money, pieces) | Readex Pro | 1.1–2.1rem / 600 | `tabular` numerals, always |
| Body / labels | IBM Plex Sans Arabic | 1rem / 400–600 | line-height 1.6 |
| Meta / hints | IBM Plex Sans Arabic | 0.75rem | `graphite`, never below 0.68rem |

### Arabic hierarchy

- Readex Pro carries headings and every quantity. IBM Plex Sans Arabic
  carries text.
- Both are loaded by `next/font` (`--font-display`, `--font-arabic`).
- Arabic-Indic digits are accepted in every input (`normalizeDigits`). Numbers
  are displayed in Western digits with Arabic separators (`formatNumber`,
  `formatMoney`).

The scale is a fixed rem scale (ratio about 1.15). Fluid type isn't used in
the app.

## 4. Layout

### Spacing scale

Tailwind's 4px scale. Rhythm by role:

| Role | Spacing |
| --- | --- |
| Inside a field group | 6px (`space-y-1.5`) |
| Between fields | 16px (`space-y-4`) |
| Between page sections | 16–24px (`space-y-4` to `space-y-6`) |
| Inside a card | 16px on phones, 20px from `sm` (`p-4 sm:p-5`) |
| Page gutter | 16px phones, 32px desktop (`px-4 lg:px-8`) |

More space goes above a heading than below it.

### Grid and container

- **Content width:** `max-w-6xl` for the app shell; `max-w-2xl` to
  `max-w-4xl` for single-task pages (forms, order, treasury).
- **Phones:** one column.
- **From `lg`:**
  - a desktop sidebar replaces the bottom bar;
  - two-column compositions (order detail: work on the right, items and
    money on the left);
  - tables where rows are records (treasury ledger).

### Responsive behaviour

- Mobile-first at 390px. Verified at 390, 768 and 1280.
- No horizontal page scroll at any width. Wide content scrolls inside its own
  container (filter chips, dashboard attention cards).
- Sticky action bars sit above the bottom navigation:
  `bottom-[calc(6.5rem+env(safe-area-inset-bottom))]`, `lg:bottom-4`.

## 5. Elevation and shape

- **No shadows** (shadow tokens resolve to `none`). Depth comes from the
  surface ladder, 1px `line` borders and the graphite panel.
- **Radius scale:**
  - 6, 8 and 10px for chips and small controls;
  - 12px (`rounded-xl`) for buttons and fields;
  - 14–16px (`rounded-2xl`) for cards and panels;
  - `rounded-full` only for status pills, nav markers and avatars.
- **Never** a coloured `border-left`/`border-right` accent, gradient text or
  hard offset shadows.

## 6. Components

### Buttons and interactive states

- **Primary:** `bg-brand-solid text-on-brand`, `h-12` (form submit), one per
  area.
- **Secondary:** `variant="outline"` (surface + `line` border).
- **Destructive:** `bg-danger-solid`, or `text-danger-ink` for quiet links
  that open a confirmation.
- **States:**
  - hover strengthens the border or tints `well`;
  - press scales to 0.97–0.985;
  - disabled is 50% opacity with no pointer;
  - loading swaps the icon for `Loader2` spin and keeps the label.
- **Touch targets:** at least 44px (`min-h-11`) for anything tappable outside
  running text, including «إيقاف الحساب» and «إلغاء الحركة…».

### Cards and page surfaces

- **Card:** `rounded-2xl border border-line bg-surface`.
- **No card inside a card with the same style.** Use the surface ladder.
- **The graphite panel** (`stage` / `bg-panel`) opens key screens (dashboard
  greeting, order hero, treasury balance). Inner chips use
  `bg-panel-2 ring-1 ring-panel-line`.
- **Collapsed sections** use native `<details>` with a chevron that rotates.
  - Tool panels (treasury) have a 64px summary with an icon, a title and a
    one-line purpose. Closed by default unless the page has nothing else to
    show.
  - Inline disclosures (filters, item extras) have a ≥44px summary with an
    icon and a chevron.

### Forms and validation

- The label sits above the control (`Field`), optional fields say «(اختياري)»,
  and hints sit under the control.
- Errors appear under their own field (`role="alert"`, `aria-invalid`). The
  form-level summary (`FormMessage`) says what to fix. On submit, the view
  scrolls to the first invalid field.
- Money fields use `MoneyInput`/`MoneyField` (`ج.م` suffix, decimal keypad).
  Quantities are centred tabular numbers.
- Choices with few options are chip/card radio groups (`role="radio"`,
  `aria-checked`). Long lists are `NativeSelect`.
- **The New Order form stays one screen.**
  - Items are tinted `well` blocks headed by a numbered sapphire badge and the
    item's own name.
  - Designs are outlined surface rows inside the item, with their own number.
  - The sticky save bar always shows pieces, item count and total.
  - The server recomputes every total.

### Navigation

- **Phones:** a bottom bar with Home, Orders, Accounts and More, plus a raised
  sapphire «+» only for accounts that can create orders.
- **Desktop:** a sidebar. Extra destinations (customers, workers, suppliers,
  expenses, treasury, users) appear **only when the account has the
  permission** (`mainNavKeys`, `SIDEBAR_EXTRA_NAV`). No dead ends.
- Back links (`BackLink`) sit at the top of task pages.

### Tables and lists

- **Phones:** one row per record, title + meta on the start side and the
  figure on the end side, divided by `divide-hairline`.
- **Desktop records with money:** a `<table>` with a caption, `th scope`, a
  `well` header and right-aligned (`text-end`) tabular money columns: date ·
  description · account · in · out · balance.
- Internal movements (transfers, opening balances) are labelled «داخلي» and
  excluded from totals.

### Status badges

- `StatusBadge` pills: new = neutral, in progress = sapphire tint, completed
  = green tint, cancelled = muted and struck through, overdue = red tint,
  partly delivered = neutral with a sapphire dot.
- On list cards the badges sit on their **own row** under the title, never
  competing with the customer name.
- `SettlementBadge`: paid green, partly paid sapphire, unpaid amber.

### Production track (signature)

- A segmented bar: delivered = solid sapphire, ready = muted sapphire,
  remaining = track.
- It is always labelled with numbers.
- Reused on order cards, the order hero and per-size rows.

### Money truthfulness (treasury and reports)

- A total that depends on unattributed movements shows «غير مكتمل», never a
  number styled as verified. The panel carries a status chip: «كل الحركات
  متحددة» (success) or «غير مكتمل — مش رصيد نهائي» (warning).
- Recorded balance and the last physical count are shown **separately**, the
  count with its difference.
- Receivables are their own card, worded as money not yet in any account.
  Net cash movement is captioned as not a balance and not profit.
- Negative balances are shown in red with a reason, never clamped.

### Modals and sheets

Inline disclosure first:

- confirmations are inline forms that need a reason (void, delete);
- tools open in place (`<details>`).

No modal is used today. If one is ever needed, use the native `<dialog>`
with focus trapping and Escape to close.

## 7. Themes

- **Light:** pearl background, white sheets, graphite type, graphite panels.
- **Dark:** designed separately, not inverted:
  - deep graphite `#12151B`;
  - surfaces `#1C212A`;
  - raised `#252B35`;
  - readable sapphire `#6FA0F4` for text and `#2F6FD8` for fills.
- **Preference:** Light / Dark / System in «المزيد», stored in `bp-theme`,
  applied before first paint (`src/lib/theme.ts`).
- Every screen is checked in both themes.

## 8. Accessibility

- WCAG AA contrast in both themes.
- Visible `:focus-visible` ring in sapphire.
- Landmarks: header, nav, main.
- Headings go one level at a time.
- Every icon-only control has an `aria-label`. Decorative icons are
  `aria-hidden`.
- Touch targets are at least 44px.
- `prefers-reduced-motion`: transitions stop (`motion-reduce:transition-none`
  and the global rule), and nothing hides content behind motion.
- Motion is 150–250ms state feedback only: press, chevron, hover. No entrance
  choreography.

## 9. RTL conventions

- `<html dir="rtl" lang="ar">`. Use logical properties and utilities (`ps-`,
  `pe-`, `ms-`, `me-`, `start-`, `end-`, `text-start`, `text-end`).
- **Directional icons point the reading way:** «رجوع» uses an arrow pointing
  right (→); «التفاصيل» and «كل …» use a chevron pointing left (‹). A
  transfer reads «من ← إلى».
- **Mixed content:**
  - order numbers, emails, phone numbers and dates in inputs are `dir="ltr"`
    inside RTL text;
  - money is "1,500 ج.م" (amount then currency);
  - English design names (DTF, AUC) sit inline without a forced direction.
- **Number alignment:** numbers align to the end in table money columns and
  to the start in prose.

## 10. Do and don't

**Do:**

- keep every colour semantic, paired with a word;
- keep figures in Readex Pro tabular numerals;
- alternate surfaces for nesting;
- collapse rarely used tools;
- test 390, 768 and 1280 in both themes;
- keep staff screens free of money they may not see (enforced server-side; the
  UI only reflects it).

**Don't:**

- add shadows, glows, gradients, blur or per-module colours;
- show a hero metric template on task pages;
- put an eyebrow label above a heading;
- show a fake or zero balance as verified;
- leave a dead-end navigation item;
- use a modal where an inline control works.
