---
version: 1
slug: "src-app-app-dashboard-page-tsx"
primary_target: "src/app/(app)/dashboard/page.tsx"
related_targets: ["src/app/(app)/orders/new/page.tsx","src/app/(app)/orders/[id]/page.tsx"]
---

# Surface brief — Benuuprint app shell: الرئيسية · أوردر جديد · تفاصيل الأوردر

Scope: the signed-in app shell (header, bottom nav, desktop rail) and three pilot screens: Dashboard (`/dashboard`), New Order (`/orders/new`, also the edit form), Order Details (`/orders/[id]`), plus the size-aware production/delivery forms they open. Visitor mode: **Operate**.

Audience & task: shop staff on phones on the shop floor (create an order with sizes in one pass, record production/deliveries); the owner on phone/desktop (spot what needs attention, see money). Content is always real database data; empty states when there is none.

Constraints: Arabic RTL, mobile-first, standard controls; staff never see money; New Order stays ONE screen (no wizard) — pinned by the owner; the approved reference `approved-reference.png` is binding for look and quality, its numbers are illustrative only.

## Direction contract

THESIS: A print shop's work, held in one violet hand: every screen leads with the job's real state (what's due, what's ready, what's left) in a calm, premium Arabic shell. It refuses the category default of a grey admin grid of identical stat tiles and long undifferentiated forms.

OWN-WORLD: Warm light canvas #F5F4F1 under white rounded surfaces (20–28px radii, soft offset shadows, no borders-as-structure); deep violet #5730B8 owns the shell, the primary action and the hero bands; ink #171622 type; lime #D8F36A only as a filled highlight with ink text (the "ready" signal); success #18A585 fills, #0F7A62 text. Alexandria for headings and numbers, IBM Plex Sans Arabic for UI text; tabular numerals. Pill-shaped active nav and chips, lucide icons in tinted rounded wells.

STORY: The employee opens the app and immediately sees today's work and what needs attention; one obvious violet "أوردر جديد" starts an order; on an order they see produced / ready / delivered at a glance and can act in one tap. The owner additionally sees money where it matters.

FIRST VIEWPORT: Dashboard (390px): header with B mark + "Benuuprint ERP" at the start (right), bell-free icon actions at the end; greeting with avatar; a quick-action row led by a filled violet "أوردر جديد" tile beside white tiles; then "نظرة سريعة اليوم" as one composed summary panel (attention item first). Signature move: the **production track** — a segmented progress band (ordered → ready → delivered) drawn with violet/lime fills, reused on order cards, the order hero and per-size rows.

FORM: Pinned reference (approved comp from the owner); code-led build (Operate surface, no image generation). seed: none (pinned) — "The approved visual reference … is binding for the visual direction and quality" / "Match the look, keep one screen".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
