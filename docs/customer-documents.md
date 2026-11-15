# Customer documents (PDF) — Phase 8

Three customer-facing PDFs, generated on the server from the current records.
They are **commercial documents, not tax invoices**: there is no VAT, no tax
registration number and no legal sequential invoice numbering. Each page says
so in its footer.

| Document | Where | Route (GET) |
| --- | --- | --- |
| Order invoice — «فاتورة أوردر» (with delivery history) | Order page → «الحساب» → «تحميل فاتورة PDF» / «معاينة» | `/api/documents/orders/{orderId}/invoice` |
| Customer orders summary — «ملخص الأوردرات» | Customer page → «مستندات العميل» | `/api/documents/customers/{customerId}/orders?from&to` |
| Customer account statement — «كشف حساب» | Customer page → «مستندات العميل» | `/api/documents/customers/{customerId}/statement?from&to` |

- `?download=1` saves the file (`Content-Disposition: attachment`). Without it,
  the PDF opens in the browser's viewer (`inline`), where it can be printed or
  shared on iPhone, Android and desktop.
- File names are Arabic (`filename*`, e.g. «كشف حساب - اسم العميل -
  2026-11-15.pdf») with an ASCII fallback.
- `from` / `to` are optional `YYYY-MM-DD` order dates. Empty means all orders.
  A reversed range is read the right way round. An invalid date returns 400.

## Who can use them

- Only the owner. The permission is `documents:customer-financial`, which only
  OWNER_ADMIN has.
- It is checked in each route and again in the data service
  (`src/server/services/customer-documents-service.ts`).
- Staff get 403 and never see the buttons. Signed-out users get 401.
- Unknown or malformed ids get 404.
- Responses are `Cache-Control: private, no-store`.
- The documents read only customers, orders, groups, sizes, operations and
  payments. They never read costs, wages, suppliers, labour or profit.

## Delivery history in the order invoice (Phase 8.1)

The invoice has a «سجل التسليمات» section between «تفاصيل الشغل» and the payments, and it appears in both download and preview.

- **Source.** Only valid (not voided) `Delivery` records are used. Production stages, printing/embroidery operations and «جاهز» confirmations are never added. A garment that needs DTF + embroidery is one garment, counted once, when it is delivered.
- **Lines.**
  - Lines are in chronological order (delivery date, then recording time, then id).
  - Each line shows: date, group (when the order has several), quantity and unit, delivered sizes, notes, cumulative delivered and remaining to deliver.
- **One delivery form, one line.** A sized delivery form saves one row per size, milliseconds apart. There is no stored batch id, so rows are shown as one handover only when all of these hold:
  - same group, delivery date, recorder and notes;
  - saved within 2 seconds of each other;
  - no size repeated.

  Everything else, including several deliveries on the same day, stays a separate line. Sizes are never distributed or invented.
- **Summary.** It shows:
  - order quantity (the sum of its groups);
  - delivered;
  - remaining;
  - «حالة التسليم»: «لم يتم التسليم», «تسليم جزئي», or «مكتمل التسليم» (every group fully delivered — the same rule that completes an order);
  - last delivery date.
- **Physical vs. money.** Pieces and money are two separate boxes. Neither is inferred from the other, and payments are unchanged.
- **Discrepancies are shown, not hidden.** These cases get a visible note:
  - the order status says «مكتمل» but the records don't add up, or the reverse;
  - a cancelled order has deliveries;
  - a group is over-delivered.

  Voided deliveries are counted in a note and never added.
- **Current state.** Every download reflects the latest records and carries its generation time.

## Calculation rules

All amounts are exact piasters (`bigint`); there is no floating point. The
rules live in one module (`src/lib/documents/customer-account.ts`), so the
three PDFs agree with each other and with the screens.

- **Order charge:** the order's current agreed total price. There are no
  per-item prices; the invoice says so.
- **Payments:** only valid `OrderPayment` rows count. Voided ones are excluded
  everywhere; the invoice states how many were voided. An advance is one
  payment row, so it is counted once.
- **Outstanding:** agreed − valid payments, never below zero. Any excess is
  shown as a credit «له», not as a negative outstanding.
- **Cancelled orders:**
  - They are not owed, and are listed separately (summary) or labelled
    (invoice).
  - Money received on a cancelled order is **not** netted against other
    orders. It is reported as «محتاج قرار» (refund or customer credit),
    because the system has no refund transaction.
  - The app refuses to cancel an order that still has valid payments, so this
    can only appear in older data; the documents handle it anyway.
- **Summary totals:** «المتبقي على العميل» = agreed − paid over the active
  orders in the period. This is exactly the customer screen's «المتبقي عليه»;
  over-payments are called out underneath it.
- **Statement:**
  - It has one debit per active order (on its order date) and one credit per
    valid payment (on its payment date), in date order, with a running
    balance.
  - Payments on cancelled orders stay in the ledger, since the money was
    received, and are named in a warning.
  - So its closing balance = the screen figure − money paid on cancelled
    orders. The integration tests check this identity.
  - The opening balance is the sum of the same entries before `from`.

## Known limitations (data model)

- **Current state, not history.** The schema stores the current price and
  status, not when a price was corrected or when an order was cancelled; those
  exist only as audit-log entries. So:
  - the statement uses today's agreed price on the order date;
  - cancelled orders simply have no charge;
  - a voided payment disappears from every period, even one printed before it
    was voided.

  The statement says this in a note at the top. It is not a reproduction of a
  statement printed earlier.
- **Refunds and customer credits** cannot be recorded, so they are reported as
  unresolved amounts, never invented.
- **Period:** the period filters by order date (summary) and by transaction
  date (statement). Orders received before the period with payments inside it
  show those payments in the statement, and their charge is in the opening
  balance.

## Rendering

- **Library:** PDFKit (pure JavaScript, runs in the Node runtime of
  `next start`; no headless browser on the server).
- **Font:** IBM Plex Sans Arabic (SIL Open Font License, file in
  `src/server/documents/fonts/OFL.txt`).
- **Right-to-left text:** fontkit shapes Arabic. Our own code
  (`src/server/documents/pdf/arabic-text.ts`) runs the Unicode bidi algorithm,
  orders runs visually, and mirrors brackets. Order numbers are wrapped in LTR
  isolates so «#0012» stays intact. The output was compared against Chrome
  for mixed Arabic/English/number lines.
- **Layout:** A4. Table header rows repeat on every page, rows never split,
  and pages show «صفحة X من Y».
