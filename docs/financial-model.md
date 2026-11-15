# Benuuprint — financial model (Phase 6)

Every number in the reports is **derived at read time from recorded business
events**. No balance, total or profit is stored. Voided rows mean "entered in
error" and are excluded everywhere (they stay visible in histories, marked).
All arithmetic is exact: amounts are `NUMERIC(12,2)` in PostgreSQL and whole
piasters (`bigint`) in TypeScript (`src/lib/money.ts`); there is no rounding
except percentages, shown to one decimal (half-up) from exact piasters.

## Authoritative sources

| Event | Table | Valid when | Business date |
| --- | --- | --- | --- |
| Order selling value | `orders.total_price` | status ≠ `CANCELLED` | `received_date` (booking) |
| Customer payment (cash in) | `order_payments` | `voided_at IS NULL` | `paid_at` |
| Order cost (incurred) | `order_costs` | `voided_at IS NULL` | `cost_date` |
| General expense (incurred) | `general_expenses` | `voided_at IS NULL` | `expense_date` |
| Labour cost (incurred) | `worker_workdays` (worked, wage snapshot) | `voided_at IS NULL AND worked` | `work_date` |
| Labour allocation to orders | derived from `worker_work_logs` of each day | log + day valid | the day's `work_date` |
| Cash out | `outgoing_payments` — exactly one of `order_cost_id`, `expense_id`, `worker_id` (+ `WAGE`/`ADVANCE`) | `voided_at IS NULL` | `paid_at` |

All business dates are calendar `DATE`s in Cairo time ("today" =
`todayDateString()` in `Africa/Cairo`). A period is an **inclusive** range of
those dates (`from ≤ date ≤ to`); no timestamps are compared, so there is no
UTC month-boundary drift.

## How each event moves each figure

| Event | Selling value | Cash in | Cash out | Receivable | Payable | Order contribution | Operating expense |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Order created / price edited | sets | — | — | + price | — | + price | — |
| Customer payment | — | + | — | − | — | — | — |
| Order cost recorded (paid or not) | — | — | — | — | + (supplier / loose cost) | − cost | — |
| Payment against an order cost | — | — | + | — | − | — (never a 2nd cost) | — |
| General expense recorded | — | — | — | — | + (unpaid expense) | — | + |
| Payment against an expense | — | — | + | — | − | — | — (never a 2nd expense) |
| Worked day | — | — | — | — | + worker owed | − allocated share only | (labour) |
| Worker wage payment | — | — | + | — | − worker owed | — | — |
| Worker advance | — | — | + | — | − worker owed (may go negative = advance outstanding) | — | — (cash, not cost) |
| Any void | removes the voided event's effect in every column | | | | | | |

## Formulas

- **Cash in (period)** = Σ valid `order_payments.amount` with `paid_at` in period.
- **Cash out (period)** = Σ valid `outgoing_payments.amount` with `paid_at` in
  period, split by target: order costs (suppliers), expenses, worker `WAGE`,
  worker `ADVANCE`. Each payment row belongs to exactly one target, so it is
  counted once.
- **صافي حركة الفلوس** = cash in − cash out. **Not profit and not a cash balance**
  (opening cash/bank balances are not recorded).
- **Receivable per order** = `total_price` − Σ valid payments, for orders not
  `CANCELLED` with a positive remainder. Cancelling an order that has valid
  payments is refused by the existing rules; any legacy cancelled order with
  payments, or an over-paid order, is listed under «محتاج قرار» and excluded
  from the receivable total (there is no refund event yet).
- **Supplier payable** = Σ valid costs with that supplier − Σ valid payments on
  those costs (`supplierBalances`). Costs without a supplier and unpaid general
  expenses are reported separately and never mixed into supplier balances.
- **Worker balance (as of a date)** = Σ wages of valid worked days ≤ date − Σ
  valid worker payments (wages + advances) ≤ date. Positive = owed to the
  worker; negative = advance not yet earned back. A wage is earned in full for
  a worked day regardless of output against target.
- **Allocated labour per order** = for each valid worked day, the day's wage is
  split across that day's valid work logs (by quantity when all logs share a
  unit, by hours when units are mixed) — existing Phase 4 rule
  (`allocateDayWage`). A day with no logs, or mixed units without hours, stays
  **unallocated** and is reported as such; it is never split arbitrarily.
- **هامش الأوردر قبل المصاريف العامة** = selling value − Σ valid order costs
  (all categories, paid or not) − allocated labour. **Percentage** =
  contribution ÷ selling value × 100 (none when the price is 0). Flags shown
  with the figure: order still open, cancelled, no costs, no work logged.
- **Expenses incurred (period)** by `expense_date`; **expense cash paid
  (period)** by the payment's `paid_at`; **unpaid at period end** = Σ expenses
  dated ≤ end − their payments dated ≤ end.

## Permissions

All reports require `finance:view-summary` (owner only); worker obligations also
require `workers:view-pay`; order contribution also `costs:view` + `labor:view`.
Checks run in every service function **and** in the API route
(`GET /api/reports/{overview|cash-flow|movements|receivables|payables|workers|orders|expenses}`).
Staff keep their operational permissions (record payments, costs, expenses,
work) but receive 403 / «للمدير بس» for every report.

## Known limitations (policy decisions for the owner)

1. **Refunds / returned money** are not modelled. A void means "entered in
   error". A real refund needs a new, explicit event before it can be reported.
2. **Opening cash and bank balances** are not recorded, so no "current balance".
3. **Overhead allocation** (rent, electricity… to orders) needs an owner-approved
   rule; contribution is therefore always *before* overhead.
4. **Unallocated labour** (days without work logs) is visible but not assigned
   to any order.
5. Order contribution is shown per order, not recognised as monthly profit.
