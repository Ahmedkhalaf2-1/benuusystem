# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable, online-only PWA, mobile-first, used from the browser (not app stores). Must stay responsive on desktop. Self-hosted (Next.js + PostgreSQL on the owner's Ubuntu VPS behind Caddy).

## Users

- **Printing-shop staff** — ordinary employees, not technical or accounting-literate. They use their **phones on the shop floor** to record new orders, production progress, ready pieces, deliveries, worker attendance and output, order costs and expenses. Often one-handed, in a busy workshop, between other work.
- **The owner (OWNER_ADMIN)** — on **phone and sometimes desktop**. Oversees orders, production and deliveries, and is the only one who sees money: costs, supplier balances, wages, company-wide totals. Approves corrections (voids).

## Product Purpose

Benuuprint ERP runs Benuuprint, a make-to-order printing and garment business (DTF, screen printing, embroidery, garment making, phone-case printing). It replaces paper and memory with one simple system that answers, at any moment:

- what each customer ordered (including garment sizes), what was paid and what is still owed;
- how much of each order is produced, ready, delivered, and still to make;
- what each order cost (materials, outside work, labour), what was actually paid out, and what is still owed to suppliers and workers.

Success: an employee records a real event in a few taps without training, and the owner can trust every number because each one is derived from recorded events.

## Positioning

Built around how a small Egyptian print shop actually works: one customer order split into lightweight work groups (e.g. 100 DTF, 50 embroidery, 50 DTF + embroidery) that never double-count physical pieces; daily wages paid per worked day regardless of output; partial deliveries; purchases bought per order on credit. All of it in natural Egyptian business Arabic, without accounting or ERP vocabulary in the interface.

## Operating Context

- Shop floor and front desk; phones with Arabic keyboards (Arabic-Indic digits are accepted everywhere).
- Money is EGP; dates are Egypt-local business dates (Africa/Cairo).
- Typical flows: take an order with an advance → buy fabric (often partly on credit) → record printing/embroidery/manufacturing progress → confirm finished pieces → deliver in parts → collect the rest → pay suppliers and workers.

## Capabilities and Constraints

Implemented (Phases 1–5): authentication with roles (OWNER_ADMIN, STAFF) and granular server-side permissions; customers; orders with work groups and operations (تصنيع، DTF، سلك سكرين، تطريز); customer payments with owner-only voids; order costs, suppliers and payables; general expenses; workers, daily wages (snapshotted per day), productivity and labour allocation per order; production by step, ready-for-delivery confirmation, partial deliveries, automatic order status; full audit log.

Constraints that future work must preserve:

- Every money and quantity figure is derived from recorded events — never stored balances, never invented or sample numbers presented as real.
- Nothing financial or operational is silently deleted or edited; corrections are owner-only voids with a reason.
- Staff never see confidential money (profit, supplier balances, payroll, company-wide totals); enforced server-side.
- No offline mode, inventory, FIFO, SKUs or product-variant systems.
- Quantities are whole numbers today (decimal meters are an open item).
- Garment sizes: suggested automatically for clothing product types only; the employee can switch the size breakdown on or off for any order with a simple, unobtrusive control. Sizes are always optional; non-garment products are never forced to use them. Common sizes XS–4XL plus custom/children's sizes. No variants or SKUs.
- Final profit is not computed yet (needs payroll/overhead allocation rules; a later accounting phase).

## Brand Commitments

- Name: **Benuuprint** (app: "Benuuprint ERP"), deep-purple brand identity, existing "B" mark with cyan/magenta/yellow ink dots (`src/components/brand/brand-mark.tsx`, PWA icons in `public/icons/`).
- Interface language: Arabic, RTL, natural Egyptian business Arabic (e.g. «أوردر جديد»، «عملنا كام؟»، «سلمنا كام؟»، «لسه عليه كام؟»).
- **Approved visual reference (binding for look and quality):** `approved-reference.png` at the project root. Match its visual identity, card style, navigation and overall sophistication closely; its numbers are illustrative and must not be copied. The New Order flow stays **one screen** (no multi-step wizard), despite the step indicator in the image.

## Evidence on Hand

- No real customer, order, worker or financial data in the repository; the owner's development database contains only the owner account. Never fabricate statistics, testimonials or sample business data for display.
- Real assets: the B mark and PWA icons; the approved reference image.

## Product Principles

1. **Simplicity first** — the common action is a few taps on a phone; rare and correction actions stay out of the way.
2. **Numbers you can trust** — every figure is computed from recorded events; nothing is double-counted (a shirt needing DTF and embroidery is one shirt).
3. **Plain Egyptian Arabic, not accounting** — no ledger, journal or ERP jargon in the interface.
4. **Privacy by role** — staff see the work; only the owner sees the money.
5. **History is never rewritten** — corrections are visible, explained, and owner-approved.

## Accessibility & Inclusion

Users vary in literacy and tech comfort: large touch targets (~44px+), clear labels over icons alone, readable contrast, Arabic-Indic digit input, RTL throughout, reduced-motion respected.
