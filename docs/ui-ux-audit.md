# UI/UX audit — Benuuprint ERP (Nov 2026)

## Method

- **Where it ran:** the real app (local production build) on fictional data in a
  local `benuuprint_preview` database, as three roles:
  - the owner;
  - a front-desk employee with prices;
  - a production employee without prices.
- **What was captured:** 66 screens at 390px, 768px and 1280px, in light and
  dark themes.
- **Tools:**
  - Impeccable (`audit`, then `polish`) for the technical audit and the polish
    pass;
  - Playwright for the captures;
  - Taste Skill rules applied by hand (see DESIGN.md);
  - awesome-design-md structure for DESIGN.md.
- **Baseline:** captures are in `design-review/ui-overhaul/before/` (local,
  gitignored).

The interface is already coherent: one sapphire accent, semantic colours with
words, a graphite panel, 44px controls, and no horizontal overflow at any
captured width. This is a refinement, not a rebuild.

## Health score (Impeccable audit)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | A few small targets (treasury links, collapsible summaries); contrast passes |
| 2 | Performance | 3 | Server components, no heavy effects; the long treasury page renders three always-open forms |
| 3 | Theming | 3 | Full token system and good dark mode; amber/red used off-meaning on expenses |
| 4 | Responsive | 3 | No overflow; some cramped mobile rows (treasury accounts, order card headers) |
| 5 | Implementation integrity | 3 | One coherent system; nested card-in-card-in-card in the order form |
| **Total** | | **15/20** | **Good**: address the weak spots below |

## Findings by priority

### P1: fix before release

1. **The treasury page is ~8 phone screens long.**
   - **Problem:** the movement, physical-count and add-account forms are always
     open below the balances. The owner has to scroll past all three to reach
     the bottom, and the tools compete with the numbers.
   - **Where:** `src/app/(app)/treasury/page.tsx`.
   - **Fix:** turn each tool into a closed panel with a clear title and a
     one-line purpose. Setup stays open only while no account exists.
2. **Treasury account rows are cramped on phones.**
   - **Problem:** name, type, opening count, last count, deactivate link and
     balance share one flex row. The meta text wraps to four lines beside the
     balance, and the balance column squeezes the text.
   - **Fix:** two rows: identity and balance on top, count details underneath.
     The verified/incomplete state is shown as words, never as colour alone.
3. **Small targets in the treasury.**
   - **Problem:** «إيقاف الحساب» and «إلغاء الحركة» are text-xs links about
     20px tall, next to other controls.
   - **Fix:** raise them to ≥44px tap areas.
4. **The order card header jumps on phones.**
   - **Problem:** customer name, status pill, «تم تسليم جزء» and «متأخر» compete
     on the title line. Long names truncate early ("شركة النيل للمق…") and the
     pills stack into a ragged second column.
   - **Fix:** the name gets the full title line; status chips move to their
     own row with the order number.
5. **The order form nests three box levels.**
   - **Problem:** a Question card holds a bordered item card, which holds a
     well design box. Each level looks the same weight, so it is hard to tell
     where one item ends and the next begins.
   - **Fix:** alternate surfaces (surface → well → surface), and give the item
     header a live summary (pieces · line total).

### P2: next pass

6. **The treasury ledger on desktop is a single text column.**
   - **Problem:** money in, money out and the running balance aren't aligned
     columns, so it can't be scanned like a statement.
   - **Fix:** a table at ≥1024px, with the mobile list kept.
7. **The expenses filter looks like an empty card.**
   - **Problem:** «فترة معيّنة أو نوع مصروف» is a collapsible section with no
     chevron, so it doesn't read as expandable.
   - **Fix:** add a chevron and keep the summary to one line.
8. **Unpaid shows as red.**
   - **Problem:** on expenses, «لسه متدفعش» uses the error colour. Unpaid is
     an action, not an error.
   - **Fix:** amber «يحتاج دفع», in line with DESIGN.md.
9. **The period picker wraps under its heading.**
   - **Problem:** in narrow section headers the picker squeezes the heading
     ("حركة الفلوس / في الفترة").
   - **Fix:** stack it below the heading on phones.
10. **DESIGN.md is incomplete for current work.**
    - **Problem:** forms and validation, tables, sheets, RTL rules and the
      verified/incomplete money rule are missing.
    - **Fix:** add them.

### P3

11. **The avatar initial looks like a Latin "i" at small sizes** («أ» in the
    thin weight). Use a heavier weight.

## Out of scope (logic or data, not UI)

- **Stale branding.** PRODUCT.md "Brand Commitments" and the dashboard surface
  brief still describe the old violet identity. The code and DESIGN.md use
  graphite/silver/sapphire. They need a product-context update, not a UI
  change.
- **No business-rule changes** were needed for any finding above.
