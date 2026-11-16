# Treasury & cash accounts (Phase 11)

«الخزنة والحسابات» shows the money the business actually holds in each
account. It is owner-only and requires the `treasury:manage` permission.

Routes:

- `/treasury`: setup, balances, cash movement, receivables, unassigned
  payments, movements and reconciliation;
- `/treasury/ledger`: filters by account and date range.

## Balance rule

```
balance(account, day) =
    opening balance (counted by the owner, as of the opening date)
  + valid customer payments attributed to the account   (paid_at ≥ opening date)
  − valid outgoing payments attributed to the account   (costs, expenses, wages, advances)
  + capital in − drawings ± transfers ± audited adjustments   (valid, dated ≥ opening date)
```

- **Never stored.** Balances are always computed in exact piasters
  (`bigint`).
- **Voids.** A voided payment or movement drops out once. Rows are never
  deleted.
- **What never moves money:**
  - order prices and receivables;
  - recorded-but-unpaid expenses and costs;
  - the opening balance (it is an initialization event, not revenue).
- **Owner capital and drawings** move money but are not revenue or expense.
  They are excluded from «صافي الحركة النقدية».
- **Transfers** are one row: money out of one account and into the other in
  the same transaction. In the combined ledger a transfer is shown once as
  «داخلي» and counted in neither total.
- **Negative balances** are shown and flagged, never clamped.
- **Physical counts** (`treasury_reconciliations`) are stored next to the
  system balance at that date. A count never rewrites the books. An optional
  ADJUSTMENT, which needs a reason, is the only way to correct them.

## Cutover (historical data)

### Start or end of the count day

The owner records the count date and **when** the count was made:

| Basis | Meaning | Payments dated the count day | First day counted after the opening |
| --- | --- | --- | --- |
| `START_OF_DAY` | Counted before any money moved that day | Come after the count, so they need an account and are added | the count day |
| `END_OF_DAY` | Counted after the day's last movement | Already inside the counted amount, so they take no account and attributing them is refused | the next day |

- **Stored:** `financial_accounts.opening_count_date` and `opening_basis`.
- **Derived:** `opening_date` (first counted day). A CHECK constraint keeps all
  three consistent.
- **When the balance becomes known:** at the end of `opening_date − 1`. The
  end of one day is the start of the next.
- **Ledger:** the opening row reads «جرد بداية اليوم» or «جرد آخر اليوم».
- **Labels:** every screen labels the amount as counted at the start or the
  end of that day.

- Existing payments keep `account_id = NULL`. Nothing is classified
  automatically and no opening balance is invented.
- The owner creates each account with a counted, confirmed opening balance
  and an opening date (the cutover). Payments dated before an account's
  opening date are inside that counted balance. They are never attributed to
  it, and the server refuses to attribute them.
- **Required account.** After setup, every new money movement dated on or
  after the cutover must name an account.
- **Payments needing attention.** Valid unattributed payments dated on or
  after the cutover (e.g. recorded between the cutover date and setup) are
  listed under «دفعات لسه مش متحدد حسابها». Until the owner attributes them,
  the total shows «الرصيد غير مكتمل — محتاج رصيد افتتاحي ومراجعة الحركات»
  instead of a number.
- **Moving an attributed payment** to another account needs a reason. All
  attributions are audited.
- **Reports keep their values.** Historical cash-flow reports don't use
  `account_id`, so they are unchanged.

## Staff

- Payment forms show account **names only**, via `listAccountOptions` for
  anyone who records money. Balances, the ledger and all treasury actions
  require `treasury:manage`, which is owner-only and not grantable.
- Order, customer and PDF data contain no treasury values.

## Migration `20261116163603_treasury_accounts`

The migration is additive:

- 3 enums;
- `financial_accounts`, `treasury_movements` and `treasury_reconciliations`;
- a nullable `account_id` on `order_payments` and `outgoing_payments`;
- CHECK constraints: EGP only, positive amounts, valid transfer/adjustment
  shape, consistent void fields.

It has no UPDATE, DELETE or backfill.

It was rehearsed on an isolated copy of the previous schema with orders,
valid and voided customer payments, a paid and an unpaid expense, production
records and users. Checksums of all pre-existing financial tables and the
cash totals were identical afterwards, and 0 payments were attributed.

### Rollback

- The release can be rolled back by switching to the previous app version.
  It ignores the new tables and columns.
- The migration itself is not rolled back automatically. Dropping the new
  tables/columns would lose any accounts, movements and attributions recorded
  after deploy, so take a backup first.
