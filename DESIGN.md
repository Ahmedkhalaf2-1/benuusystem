---
name: Benuuprint ERP
description: A layered, alive Arabic workspace for a printing and garment shop — each daily action has its own colour, the job's progress leads every screen, and money stays with the people allowed to see it.
colors:
  canvas: "#f3f1f8"
  surface: "#ffffff"
  well: "#f6f4fb"
  hairline: "#ebe7f3"
  input-border: "#dcd6e8"
  ink: "#16122b"
  graphite: "#625b78"
  violet: "#5b34d6"
  violet-deep: "#4322b0"
  violet-night: "#24106b"
  violet-soft: "#eee9fd"
  blue: "#2f6bea"
  blue-ink: "#1f50bd"
  blue-soft: "#e8effe"
  teal: "#12a594"
  teal-ink: "#0b766a"
  teal-soft: "#ddf4f0"
  green: "#22a05a"
  green-ink: "#167444"
  green-soft: "#e1f5e8"
  amber: "#e8960c"
  amber-ink: "#8f5a00"
  amber-soft: "#fdf1da"
  rose: "#e0457b"
  rose-ink: "#b02a5b"
  rose-soft: "#fde8f0"
  red: "#dc3b3b"
  red-soft: "#fde9e9"
  track: "#ebe7f4"
typography:
  display:
    fontFamily: "Readex Pro, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Readex Pro, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    fontFeature: "tnum"
  title:
    fontFamily: "Readex Pro, IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "IBM Plex Sans Arabic, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "8px"
  md: "12px"
  lg: "14px"
  xl: "18px"
  2xl: "22px"
  card: "22.4px"
  panel: "24px"
  stage: "30.4px"
  pill: "9999px"
spacing:
  gutter: "16px"
  card-pad: "16px"
  card-pad-wide: "20px"
  stack: "16px"
  section: "28px"
  touch: "48px"
components:
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    height: "48px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    height: "48px"
  stage:
    backgroundColor: "{colors.violet-night}"
    textColor: "{colors.surface}"
    rounded: "{rounded.stage}"
    padding: "20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
  quick-action:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    height: "108px"
  chip-active:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "40px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    height: "48px"
  status-pill:
    rounded: "{rounded.pill}"
    height: "28px"
---

# Design System: Benuuprint ERP

## Overview

**Creative North Star: "The Living Workshop"**

Benuuprint is the daily tool of an Egyptian printing and garment workshop. Staff use it on phones, one-handed, between machines. The owner uses it on a phone and sometimes on a desktop. The interface should feel alive and confident, like a well-made native app. It is not a printed form, and it is not a generic admin dashboard.

The system rests on four ideas:

1. **One brand stage per screen.** The top of each main screen is a deep violet panel textured with a halftone dot screen (the printer's own dot). It carries the greeting, the job, or the person the screen is about.
2. **Every daily action has a colour, and the colour means the same thing everywhere.** That includes the dashboard quick actions, workflow headers, history timelines, progress bars and status pills.
3. **Progress first.** Any job shows how many pieces were ordered, made, are ready and were delivered before anything else.
4. **Raised, layered surfaces.** White cards float on a cool lilac canvas with soft violet-tinted shadows. Inside a card, recessed "wells" group related things, so cards are not nested inside cards.

Money is permission-controlled. Staff never see costs, labour, payroll or profit. Where the owner sees a figure, staff simply see less, never a locked placeholder.

**Key characteristics**
- A deep-violet halftone stage at the top of the Dashboard, Order Details, New Order, customer profile, «المزيد» and Login. The worker profile and workers list use a rose stage.
- Six hue-coded quick actions on the dashboard, each opening a real workflow.
- The production bar: delivered (violet), ready but not delivered (teal), still to make (track).
- A floating bottom tab bar with a raised «+» for New Order.
- Large numbers in Readex Pro with tabular figures. Body text in IBM Plex Sans Arabic.
- Natural Egyptian Arabic, right to left, with Western digits in figures and Arabic-Indic digits accepted in every numeric input.

## Colors

The colours have fixed meanings. Never use one only for decoration.

| Role | Solid | Ink (text) | Soft (fill) | Means |
| --- | --- | --- | --- | --- |
| Violet | `#5b34d6` | `#5b34d6` | `#eee9fd` | Brand, primary action, new order, delivered pieces, the selected option |
| Blue | `#2f6bea` | `#1f50bd` | `#e8effe` | Production: recording work and work steps (DTF, embroidery…) |
| Teal | `#12a594` | `#0b766a` | `#ddf4f0` | Ready pieces waiting to be handed over; deliveries |
| Green | `#22a05a` | `#167444` | `#e1f5e8` | Money received, paid, settled, success |
| Amber | `#e8960c` | `#8f5a00` | `#fdf1da` | Expenses and costs; due soon; caution |
| Rose | `#e0457b` | `#b02a5b` | `#fde8f0` | Workers: attendance and workdays |
| Red | `#dc3b3b` | `#dc3b3b` | `#fde9e9` | Overdue, void and cancel actions, errors |

- **Neutrals:**
  - canvas `#f3f1f8`;
  - surface `#ffffff`;
  - well `#f6f4fb`, for recessed groups inside a card;
  - hairline `#ebe7f3`;
  - ink `#16122b` (17:1 on white);
  - graphite `#625b78` (5.9:1 on white), for secondary text.
- **Stage:** `#24106b` → `#3a1a9c`, with a 14px halftone of white dots at 13% and one soft blurred colour light. Text on the stage is white; secondary text is white at 70–80%.
- **Owner money card:** ink `#16122b`. Received money is shown in mint `#7ee2a8` and cash out in peach `#ffb28a`.
- **Never:**
  - grey text on colour (use a tint of that colour or white at reduced opacity instead);
  - gradient text;
  - colour without meaning.

## Typography

- **Readex Pro (variable):**
  - headlines: 1.5–1.9rem, semibold, tracking −0.02em, line-height ≥1.35 so Arabic marks never collide;
  - figures: quantities and money, with tabular numerals;
  - card titles: 1.02–1.15rem, semibold.
- **IBM Plex Sans Arabic** for body text (16px), labels (12–14px) and helper text.
- Order numbers, size labels (S, M, XL), phone numbers and dates in Latin are set `dir="ltr"` inside RTL text.
- Body text stays short: helper lines are one sentence in plain Egyptian Arabic.

## Layout

- **Phones first.** One column with a 16px gutter. A floating tab bar sits 10px above the safe area, 64px tall, with radius 25.6px.
- **Sticky action bars** sit above the tab bar at `bottom: calc(6.5rem + safe-area)`. This applies to the New Order save bar, the production and delivery submit buttons, and the order page's «تسجيل إنتاج / تسليم قطع».
- **Desktop (≥1024px).** A right-hand sidebar replaces the tab bar. Content is at most 64rem wide. Key pages use a main column plus a 20–22rem side column: Dashboard (owner money), Order Details (account, costs, labour, details).
- **Rhythm:** 28px between dashboard zones, 16px between cards, 16–20px inside cards.
- **New Order is one scrolling page.** Optional details fold away, nothing is hidden only to shorten it, and there is no wizard.

## Elevation & Depth

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-soft` | `0 1px 2px rgb(22 18 43/.05), 0 6px 18px -10px rgb(44 20 117/.16)` | Inputs, chips, small controls |
| `--shadow-card` | `0 1px 2px rgb(22 18 43/.04), 0 12px 32px -16px rgb(44 20 117/.22)` | Cards and quick actions |
| `--shadow-lift` | `0 2px 6px rgb(22 18 43/.06), 0 22px 44px -20px rgb(44 20 117/.34)` | Hover and pressed-up cards, the owner money card |
| `--shadow-violet` | `0 2px 6px rgb(61 31 160/.22), 0 14px 30px -12px rgb(91 52 214/.55)` | The stage, primary buttons, the «+» key |
| Hue glow | `0 8px 18px -8px <hue>/0.7` | The solid icon square of a coloured action |

Every shadow has an offset and a soft blur. There are no hard offset shadows and no colourless halos.

## Shapes

- **Radius scale:** 8 / 12 / 14 / 18 / 22 / 28px.
  - Stage: 30px.
  - Cards: 22–24px.
  - Buttons and inputs: 18px.
  - Icon squares: 12–16px.
  - Chips, status pills, the tab bar's «+» and avatars: fully round.
- **Icons:** Lucide line icons at 16–24px. Solid icon squares (white glyph on a hue) mark actions. Soft squares (hue glyph on the hue's soft fill) mark sections inside cards.
- **Product glyphs:** a T-shirt for clothing, a phone for phone cases, and a parcel for anything else.

## Components

- **Quick actions** (dashboard). A 3-column grid of 108px tiles.
  - «أوردر جديد» is a filled violet gradient.
  - The others are white tiles with a solid hue icon square: تسجيل إنتاج (blue), تسليم قطع (teal), تحصيل دفعة (green), تسجيل مصروف (amber), حضور العمال (rose).
  - Each tile shows only if the user's permissions allow it.
  - Production, delivery and payment open **`/orders/pick`**, a searchable list limited to orders where that action is possible.
- **Production bar** (`ds/production-track.tsx`). Delivered (violet gradient), ready (teal) and remaining (track `#ebe7f4`), separated by 3px gaps, in sizes sm, md and lg. On the stage it uses white, light-teal (`#5eead4`) and translucent white.
- **Attention cards.** A horizontal snap carousel on phones and a grid on desktop. Each card has a solid reason tag: red «متأخر», amber «التسليم بكرة», or teal «N قطعة جاهزة تستنى التسليم».
- **Order card.** Product glyph, customer, title and number, a status pill, the production bar, delivered/required, a due chip coloured by urgency, and a money strip that appears only with permission.
- **Status pill.** A 28px tinted pill with a dot:
  - New: violet.
  - In progress: blue.
  - Completed: green.
  - Cancelled: grey, struck through.
  - Delivered in part: teal.
  - Overdue: solid red.
  - On the stage, pills are frosted white.
- **Flow header** (`ds/primitives.tsx`). Used on every workflow screen: a back link, a 52px solid hue icon square, the title, and context such as the order number, customer and title.
- **Flow card.** A white card for one step. It can have a soft hue icon title.
- **Choice cards.** Large radio tiles: the selected one has a violet-soft fill with a 2px violet ring, the others sit in a well with a hairline ring.
- **Quantity entry:**
  - one large 64px centred field in Readex Pro;
  - a «كل اللي فاضل (N)» or «سلّمنا كل الجاهز (N)» chip that fills the most that can be recorded;
  - for sizes, a 2-column grid of tiles, each with a «لحد N» shortcut, a live total pill and a fill-all chip.
- **Fold.** A white card that opens and closes, with a soft hue icon, a title, the key figure while closed (e.g. «المتبقي 40,000 ج.م»), and a chevron that turns.
- **History timeline.** Icon dots in the action hue: production (blue), ready (teal), delivery (violet). A hairline spine connects them, and voided entries are faded and struck through.
- **Bottom tab bar.** The active tab is violet with a violet-soft pill behind its icon. The raised «+» is a gradient circle with a canvas-coloured ring.
- **Flash.** A green-soft banner with a check icon.
- **Void and correction forms.** Inline, inside a red-soft panel, with the reason required and a solid red confirm button. The record stays in the history.
- **Empty states.** A dashed lilac border, a violet-soft icon, one sentence, and the one action that starts things.
- **Loading.** A skeleton of the stage and cards that pulses gently and stops under reduced motion.

## Interaction

- Every tappable control is at least 44px; main actions are 48–56px.
- Press feedback is a scale of 0.96–0.98 on tiles and buttons. Hover adds a stronger shadow, and focus shows a violet ring.
- Motion is limited to one entrance per screen (`animate-settle`), the progress bars filling, chevrons turning and pressed states. Everything respects `prefers-reduced-motion`.
- Forms validate on the device first with the server's rules, and errors appear next to the field (per size for sizes). Saves are idempotent, so a double tap records once.
- Success returns to the order or profile with a green flash.

## Do's and Don'ts

**Do**
- Use the action's hue for everything about that action, and only for that.
- Lead with progress and the next action. Keep the owner's money in the side column or behind permission.
- Keep figures in Readex Pro with tabular numerals.
- Give every list an empty state that says what will appear and how to start.
- Keep secondary details in Folds instead of deleting them.

**Don't**
- Don't put colour on text or numbers that don't carry that colour's meaning.
- Don't nest cards: use a well inside a card.
- Don't use eyebrow labels, gradient text, hard offset shadows, or decorative charts and fake numbers.
- Don't show costs, labour, payroll or profit to staff, and don't mix incurred expenses with cash paid.
- Don't add wizard steps to New Order.

## Development note: stale CSS in `next dev`

During the redesign, the dev server sometimes kept serving an old stylesheet after `globals.css` was rewritten. Three controlled checks could not reproduce it:
- an edit while the server was running;
- an edit while it was stopped, followed by a restart;
- a production build alongside dev.

In all three, Turbopack's persistent dev cache invalidated correctly, and the dev server sends `Cache-Control: no-cache`. So caching was **not** disabled. Instead, `npm run dev:fresh` clears only `.next/dev` and starts the dev server. Use it if styles ever look outdated after a large CSS change. Production builds (`.next/cache`, `next build`) are unaffected.
