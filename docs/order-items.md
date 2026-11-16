# Order items, pricing, designs, presses & safe removal (Phase 9)

## Line items («بنود»)

- An order is made of items, shown as «البند 1», «البند 2», …
- Each item is an `OrderGroup` row, so existing ids, production, ready and
  delivery records keep pointing at the same rows.
- An item has:
  - a name («اسم البند / الرسمة»; older items fall back to «البند N»);
  - a physical quantity, material and optional sizes;
  - a unit selling price;
  - notes;
  - the work done on its pieces: either designs (new items) or item-level
    operations (older items).
- **Order quantity is always the sum of the items' quantities.** The form has
  no separate order-quantity field; the server computes it.
- The limit is `MAX_ORDER_GROUPS` = 30 items per order and
  `MAX_DESIGNS_PER_ITEM` = 12 designs per item
  (`src/lib/validations/order.ts`).

## Pricing

| `orders.pricing` | Meaning |
| --- | --- |
| `PER_ITEM` (every new order) | `lineTotal = quantity × unitPrice` per item; `totalPrice = Σ lineTotal`, computed by the server in exact piasters inside the transaction. A total sent by the browser is ignored. |
| `ORDER_TOTAL` (every order created before Phase 9) | One agreed total. Items have no `unit_price`. Nothing is split or back-filled. |

- **Stored total.** `orders.total_price` stays the authoritative stored total
  in both modes. So the existing order screen, customer totals, payments,
  receivables, invoices, statements and reports all keep working unchanged.
  An order is still charged **once** in statements, never once per item.
- **Price changes.** Changing prices on an itemized order follows the existing
  rule: it needs `orders:edit-price` (owner), and the total can't go below
  what's been paid.
- **Converting an older order to item pricing:**
  - Owner only. The owner types real prices for the existing items.
  - If the new sum differs from the agreed total, the owner must tick an
    explicit confirmation.
  - It is recorded as `ORDER_PRICE_CHANGED` (reason: conversion) plus
    `ORDER_PRICING_CONVERTED`.
  - An itemized order can't go back to a single total.

## Designs («الرسومات / أماكن الطباعة»)

- **What a design is.** `OrderGroupDesign` is a child of an item and holds:
  - a name (optional; «رسمة N»);
  - **one** operation (DTF, screen print, embroidery, manufacturing);
  - placements, stored as fixed codes (`CHEST` الصدر, `BACK` الظهر, `BADGE`
    بادج, `RIGHT_SLEEVE` كم يمين, `LEFT_SLEEVE` كم شمال) plus up to 5 custom
    labels under «أخرى». New custom places need no migration;
  - the number of pieces that get it (≤ the item's quantity; empty = every
    piece);
  - planned presses per piece (0 allowed);
  - notes and an order position.
- **Pieces are never doubled.** Two designs on the same 200 shirts are still
  200 physical pieces. Design quantities are work and are never added to
  order, ready or delivered quantities.
- **Required operations.** An item's required operations are the distinct
  operations of its designs (two DTF designs → DTF once).
- **Pricing.** The selling price stays on the item and is never multiplied by
  the number of designs.

### Production per design

- **Recording work.** Stage progress records carry an optional `design_id`.
  For items with designs, work is recorded **per design**, so chest DTF and
  back DTF are tracked separately. A design can't receive more work than its
  pieces (and per size, more than the size).
- **Ready.** It is limited conservatively:
  - a design on every piece caps ready at that design's done count;
  - a design on only part of the item caps the item total at
    `done + pieces that don't need it`;
  - an item with more than one design, or with a partial design, requires the
    existing explicit confirmation that these pieces finished everything they
    need.
- **Partial designs on sized items.** Which sizes get the design isn't stored,
  so the limit applies to the item total and the confirmation covers the rest.
- **Worker output.** A worker's output confirms progress only when exactly one
  design of that operation exists on the item. Otherwise it is refused, with
  a pointer to the order page.
- **Older items** keep item-level operation progress, unchanged. An older item
  that already has item-level progress is never split into designs, because
  that history can't be assigned to a design truthfully.
- **Edit guards:**
  - a design with recorded work can't be removed;
  - its operation can't change once work is recorded;
  - its quantity can't go below the work already done.

## Presses («عدد الكبسات لكل قطعة»)

- **Planned:**
  - per design: `quantity × pressesPerUnit`;
  - per item: the sum of its designs, or `quantity × pressesPerUnit` for items
    without designs;
  - per order: the sum of planned items.
- **Recorded:** only worker output logged in the «كبسة» unit (`WorkUnit.PRESS`)
  against that item. It is never inferred from production or deliveries.
- **Where it shows:** the order page shows plan and recorded side by side.
  Neither is printed on customer documents.
- **Not covered:** recording presses per *design* would need worker output to
  name a design. That's a separate extension; today recorded presses are
  per item.

## «حذف الأوردر» — safe removal (owner only)

- **No delete, ever.** The action archives: `archived_at`, `archived_by_id`
  and `archive_reason` are set, and an `ORDER_ARCHIVED` audit entry keeps the
  order number, title, customer, total and reason.
- **Only untouched orders.** Removal is allowed only with no valid payment,
  cost, payment on a cost, worker output, production, ready or delivery
  record. Voided records don't block. Otherwise it is refused and the screen
  lists what's attached. The owner corrects or voids those first, or cancels
  the order.
- **Where archived orders disappear:**
  - order lists, the dashboard and pickers;
  - customer pages and totals, receivables, profitability, customer documents.

  The owner can review them under «المحذوفة» and restore one with «رجّع
  الأوردر» (audited `ORDER_RESTORED`).
- **No writes.** Nothing can be recorded on an archived order. The same row
  lock that payments, edits, production, costs and worker output take treats
  it as missing, so archiving can't race a new record.
- **No purge.** There is no permanent purge. Test-data cleanup = review the
  order's attached records, void the wrong ones with a reason, then archive.

## Legacy compatibility (migration `…_order_items_designs_archive`)

- **Additive only:**
  - new nullable columns: item name, unit price, presses; archive fields;
  - `orders.pricing`, defaulting to `ORDER_TOTAL` (so every existing order is
    marked as one total);
  - a new, empty `order_group_designs` table;
  - a nullable `production_stage_progress.design_id`;
  - CHECK guards.
- **Verified on an isolated database seeded by the previous release.** All
  order totals, payments (including voided ones), item ids, production and
  ready limits, invoice balances and delivery history, customer totals and
  statements, receivables and cash flow were byte-identical before and after
  the migration.
