# Order profitability & monthly closing

Owner-only. Built on the existing records (see `financial-model.md` and
`treasury.md`). It adds no ledger and stores no balances: every figure is
derived when the page is read. The only new writes are:

- the owner's monthly review (`monthly_closes`, `monthly_close_events`);
- fixed-expense templates (`recurring_expenses`);
- the month's fixed expense rows, created on request.

Code: `src/lib/finance/profitability.ts` (pure math) and
`src/server/services/profitability-service.ts`.

## Order profitability (bottom of the order's «التكاليف» page)

| Figure | Rule |
| --- | --- |
| Net order revenue | `orders.total_price`, or 0 if the order is cancelled. Refunds are not modelled. |
| Materials | Booked costs in MATERIALS and PACKAGING. |
| Production / external workshops | Booked costs in PRINTING, EMBROIDERY and OUTSOURCED_LABOR. |
| Labour | Wages allocated to the order (existing rule: a day's wage is split over that day's work logs). |
| Other direct | Booked costs in TRANSPORT and OTHER. |
| Total direct costs | Sum of the four lines above. **Booked costs only.** |
| Gross profit | Revenue − total direct costs. |
| Margin % | Gross profit ÷ revenue × 100, rounded half-up to 1 decimal. Shown as «—» when revenue ≤ 0. |
| Draft costs | Shown separately, never included in profit. «Expected profit» = gross profit − drafts. |
| Collected / outstanding | Valid customer payments; outstanding = revenue − collected, never below 0. Over-payment is shown separately. |

**Provisional or final.** Profit is labelled **provisional** until all three
hold:

- the cost review is CLOSED (a legacy order that was never reviewed counts as
  open);
- no draft costs remain;
- the order is fully delivered (COMPLETED).

**Supplier payments.** A booked cost is recognised once. Paying the supplier
only lowers the payable and the treasury balance; it is never subtracted from
profit a second time.

**Corrections.** A cost corrected after closing (audited, with a reason)
changes profit by exactly the difference.

## Monthly closing (`/accounts/monthly`)

### Recognition basis — an owner decision

The owner picks the basis on the page; the default is **DELIVERY**.

- **DELIVERY (default):** an order's revenue and **all** its direct costs
  belong to the month of its **last valid delivery** (status COMPLETED).
  Orders still in progress belong to no month until they are delivered (work in
  progress).
- **BOOKING (provisional management view only):** the month the order was **received** (`received_date`, the
  convention the existing order reports already use). Orders still open are
  included and marked provisional. This view can't be confirmed; only the
  delivery basis is the official month.

**No duplicate recognition.** An order has exactly one last-delivery date, so
it appears in at most one month. A partial delivery is not revenue. If a
delivery is voided, the order leaves that month and the change is reported.

Under both bases:

- **Costs follow their order** (matching), never their own cost date. A later
  cost correction therefore changes the order's month, and the change is
  visible.
- **Cancelled orders** have no revenue. Their losses («خسائر أوردرات ملغية»)
  are recognised once:
  - booked costs, in the month of the **cost date**;
  - wages already allocated to them, in the month of the **work date**.

  Cancelling never removes a wage that was already earned.
- **General expenses** are recognised by `expense_date` and split into fixed
  (`is_fixed`) and operating. Paying them is cash only.
- **Unallocated labour** (worker days with no work logged against an order) is
  an expense of the work-date month.
- **Cash figures** use the payment date.
- **Month-end balances** are as of the last day of the month:
  - receivables: orders received by then, minus payments made by then;
  - supplier payables: costs booked by then (posting time in Cairo), minus
    payments made by then;
  - unpaid expenses: expenses dated by then, minus payments made by then;
  - worker balances: the existing rule.
- **Informational only:** booked costs dated this month on orders not
  recognised this month («deferred»). They are reported, not counted.

```
Gross profit         = revenue − (materials + production + allocated labour + other direct)
Cancellation losses  = cancelled-order booked costs (cost date) + cancelled-order wages (work date)
Net operating profit = gross profit − cancellation losses − operating expenses
                       − fixed expenses − unallocated labour
```

**Wage check.** Every wage of the month (by work date) falls into exactly one
bucket, and the page shows all five:

```
earned = with orders recognised this month + cancelled orders + unallocated + deferred
```

«Deferred» wages sit on orders that are recognised in another month, or not
yet delivered. They are counted in that order's own month as a direct cost.
Paying wages is cash only.

### Historical month-end balances and restatements

Month-end balances use only records dated on or before the month end:

- payments: `paid_at`;
- supplier costs: posting time in Cairo;
- expenses: `expense_date`.

Payments, settlements and new costs recorded in later months never change a
past month.

A **correction** of the month's own records does restate it. Examples:

- voiding a payment, cost or delivery;
- amending a cost;
- changing an order's price or status.

Each correction keeps its audit trail (who, when, why). The page lists the
corrections made after the month ended («restatements»). If the month was
confirmed, the changed figures appear next to the confirmed values.

### Refunds and over-payments (unresolved)

There is no refund workflow. Two cases are listed under «فلوس عملاء محتاجة
قرار» as of the month end:

- cancelled orders that still hold customer payments;
- orders paid above their price (the surplus).

Neither is revenue, neither is netted, and no payment is changed. While any
exists, the month is **not reconciled**: the page says so, and confirming
requires acknowledging the warning.

**«Reconciled»** means all of the following hold:

- the treasury balance is known for the month;
- calculated closing = ledger closing;
- no payment is missing a treasury account;
- no physical count has an open difference;
- no refund or over-payment item is open.

### Treasury panel

The panel is computed from the existing treasury ledger (`loadEntries` /
`balanceAt`).

**Opening balance.** The opening balance is the sum, at the end of the day
before the month, of every account whose balance was known then. An account
first counted during the month adds its counted opening balance on a separate
line.

**Inflows:**

- customer collections;
- owner capital;
- count adjustments (in).

**Outflows:**

- supplier payments;
- expense payments;
- worker payments (wages and advances);
- owner drawings;
- count adjustments (out).

**Transfers between the business's own accounts** are internal. They are
counted in neither inflows nor outflows; their total is shown on its own.

**Reconciliation.** Calculated closing = opening + new openings + inflows −
outflows. It is compared with the ledger's closing balance, and any difference
is shown. Nothing is ever adjusted automatically.

The panel also lists:

- valid payments dated on or after the cutover that have no account (they are
  outside the treasury, so the treasury balance is incomplete);
- physical counts in the month that still differ from the books.

### Department view

Pick a department on the page.

- **Revenue:** the department's share of each order's value, using the
  existing department allocation rule.
- **Not allocatable:** orders priced as one total, items without a price, or
  outdated splits. Their value belongs to no department and is reported as a
  separate amount.
- **Costs:** costs tagged with the department or its order items. Order-wide
  costs count only when the whole order belongs to the department; otherwise
  they are reported as «unattributed».
- **Hidden:** expenses, treasury and the review are company-wide and do not
  appear here.
- **No double counting:** each order appears once company-wide; department
  shares add up to that order's value.

### Review workflow

1. **Preview.** The month is shown live, including the current month (marked
   as not finished).
2. **Warnings.** Each of these produces a warning:
   - orders whose cost review is open;
   - orders with draft costs;
   - orders not yet delivered (BOOKING basis);
   - completed orders that have no delivery date;
   - payments not attributed to a treasury account;
   - a treasury discrepancy;
   - physical counts with open differences;
   - fixed expenses due but not yet generated.
3. **Confirm.** Possible only after the month has ended. If there are warnings,
   the owner must tick an acknowledgement, and the warnings are recorded with
   the confirmation. Confirming stores a snapshot of the key figures; nothing
   is locked or posted.
4. **Changed after confirmation.** If a later correction (cost amendment, late
   payment, delivery and so on) changes a figure, the month shows «CHANGED»
   with the before and after values. The owner can confirm again, which adds a
   new event; the earlier snapshot stays in the history.
5. **Reopen.** Needs a reason.
6. **Audit.** Every confirm and reopen is written to `monthly_close_events`
   (with its snapshot) and to `audit_logs`. Concurrent edits are refused using
   `version`.

### Fixed expenses (`/expenses/recurring`)

Each template holds:

- category (`SALARIES` is new: staff who are not daily-wage workers);
- amount;
- description;
- day of the month (1–28);
- first month and optional last month.

Templates never move money. «سجّل المصاريف الثابتة للشهر» creates that month's
rows, unpaid and marked fixed. It is idempotent: at most one row per template
per month, enforced by a unique key. Rows dated in the future are not created
early. A row is then paid through the existing expense payment.

Any expense can also be recorded by hand as fixed: tick «مصروف ثابت» in the
expense form. Existing expenses stay operating.

## Security

Profitability and the monthly closing need the permissions `finance:reports`,
`costs:view` and `labor:view`. The monthly closing also needs
`treasury:manage` and `expenses:view`. All of these are owner-only.

Partners and staff (even with costs or expenses access) receive FORBIDDEN from
every function. The page checks them as well.

## Remaining owner decisions

1. **Refund workflow.** Settling the open refund and over-payment items needs
   a decision:
   - an explicit refund event (money out to the customer); or
   - applying a credit to another order.

   Until then they are reported only.
2. **Refunds.** Refunds and returned money are still not modelled. Over-paid
   orders, and cancelled orders that have payments, are reported but not
   settled.
3. **Overhead allocation.** Rent, electricity and similar costs are not
   allocated to orders or departments. Net profit exists only company-wide.
4. **Completed orders without a delivery record.** These are listed for
   attention and are not placed in any month.
