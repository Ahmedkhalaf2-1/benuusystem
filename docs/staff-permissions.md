# Staff permissions & per-order visibility (Phase 10)

## Model

- **OWNER_ADMIN** has every permission, always. Owners are never edited from
  the browser, so the last owner can't be locked out and nobody can promote
  themselves.
- **STAFF** has exactly the permissions the owner granted on the account
  (`users.permissions`, a text array). **New accounts start with none.**
- `src/lib/auth/permissions.ts` evaluates a grant only when:
  - the key is in `STAFF_GRANTABLE`; and
  - every key it depends on (`PERMISSION_REQUIRES`) is granted too.

  Owner-only, unknown or orphaned keys on a row are ignored. A hand-edited
  database row can never widen access.
- **Reads never imply writes**, and seeing an order never implies seeing its
  prices. Dependencies only go from a write to its read, for example:
  - `deliveries:record` needs `deliveries:view`, which needs `orders:view`;
  - anything showing order money needs `orders:view-prices`.
- **Fresh on every request.** Permissions are loaded from the database with
  the session on every request. Granting or revoking takes effect on the very
  next request. The owner can also sign the account out everywhere, either
  with the change or separately.

### Staff-grantable

| Area | Read («يشوف») | Change («يغيّر») |
| --- | --- | --- |
| Orders | `orders:view` (no money), `orders:view-prices` | `orders:create`, `orders:edit`, `orders:archive` |
| Production / delivery | `production:view`, `deliveries:view` | `production:record`, `deliveries:record` |
| Customers | `customers:view` (names), `customers:view-contact` (phones) | `customers:manage` |
| Customer payments | `payments:view`, `documents:customer-financial` (PDFs) | `payments:record` |
| Costs / expenses / suppliers | `costs:view`, `expenses:view`, `suppliers:view` | `costs:record`, `expenses:record`, `suppliers:manage`, `payables:pay` |
| Workers (payroll records) | `workers:view` (names only) | `work:record` |
| Money summary | `finance:view-summary` (this month's money card only) | — |

### Owner-only

These can never be granted to staff:

- `users:manage`, `audit-logs:view`, `orders:manage-access`;
- `orders:edit-price`, `orders:cancel`, `payments:void`, `finance:void`;
- `production:correct`, `workers:correct`;
- `workers:manage`, `workers:view-pay`, `workers:pay`, `labor:view`;
- `suppliers:view-balances`;
- `finance:reports`: the `/accounts` reports, the order margin and the
  reports API.

### Presets

The owner can start from a preset, then change any single permission:

- «عامل إنتاج — عرض فقط»: `orders:view`, `production:view`, `deliveries:view`;
- «عامل إنتاج»;
- «مسؤول تسليم»;
- «استقبال أوردرات»;
- «من غير صلاحيات».

## Per-order visibility («ظهور الأوردر للعمال»)

`orders.visibility`:

| Value | Label | Who sees it besides owners |
| --- | --- | --- |
| `PRIVATE` (default) | خاص بالمدير فقط | nobody |
| `ALL_AUTHORIZED_STAFF` | ظاهر لكل العاملين المصرح لهم | every active staff account with `orders:view` |
| `SELECTED_STAFF` | عمال محددون فقط | accounts listed in `order_access` (by user id) |

- **Effective access = `orders:view` AND the order's visibility.** Archived
  orders also need `orders:archive`.
- **One rule, everywhere.** It lives in `src/server/services/order-access.ts`:
  - `orderScope` for Prisma queries;
  - `orderScopeSql` for raw SQL;
  - `canAccessOrder` / `requireOrderAccess` for single orders.

  It is applied to:
  - the orders list, search, filters and counts;
  - order details;
  - the dashboard (counts, «أوردرات النهارده», attention, recent);
  - the production dashboard;
  - the quick-action pickers;
  - the work-log order search (`/api/orders/search`);
  - customer pages (order list, counts, totals);
  - PDF documents;
  - every write on an order: production, ready, delivery, payment, cost,
    worker output, archive and restore.

  Writes check access after taking the order row lock, the same lock that
  visibility changes take.
- **Hidden looks like missing.** A hidden order is reported exactly like a
  missing one (`NOT_FOUND` / 404). Guessed IDs reveal nothing, not even
  whether the order is cancelled.
- **Owner order** (create, edit, or the «ظهور الأوردر للعمال» panel on the
  order page): visibility is optional and defaults to `PRIVATE`.
- **Staff order:** an order created by a staff member is `SELECTED_STAFF` with
  only its creator. Only the owner can widen it, and staff can't send a
  visibility value at all (`FORBIDDEN`).
- **Concurrency.** Changes lock the order row and check `orders.access_version`.
  A stale form gets `CONFLICT` instead of overwriting someone else's change.
- **Audit.** Every change is audited:
  - `ORDER_VISIBILITY_CHANGED` (from / to);
  - `ORDER_ACCESS_CHANGED` (added / removed user ids).

  Leaving `SELECTED_STAFF` removes the assignment rows.
- **Who can be assigned.** Only active STAFF app accounts can be assigned.
  Payroll `workers` rows and owners can't.

## Financial redaction (server-side)

Money is never computed into objects for viewers who may not see it, so it
can't reach JSON, React Server Component payloads or client props.

- **`OrderSummary.money`** (`totalPrice`, `paid`, `outstanding`) is `null`
  without `orders:view-prices`. Item `unitPrice` and `lineTotal` are absent,
  and `unit_price` is not even selected.
- **`OrderDetails.payments`** is `null` without `payments:view`. The payment
  rows are not loaded.
- **`customerPhone`** and customer `phone` are `null` without
  `customers:view-contact`. Search by phone digits is disabled for such
  viewers, so it can't be used to probe numbers.
- **Customer totals** are `null` without `payments:view`. With it, they cover
  only orders the viewer may see.
- **Payment pages and the order edit form** refuse viewers without prices.
- **`getOrderProduction`** returns physical totals with either production or
  delivery view. The step/ready history needs `production:view`; the delivery
  history needs `deliveries:view`.
- **`getFinanceDashboard`** returns `null` for supplier balances without
  `suppliers:view-balances`, and for expenses without `expenses:view`.
- **Navigation, quick actions and dashboard cards** are derived from the same
  permissions, so staff don't see dead-end links.

## Owner screens

**المزيد → «المستخدمين والصلاحيات»** (`/users`, `users:manage`):

- **Account list:** name, email, active/inactive, role, number of
  permissions, orders assigned by name, and open sessions.
- **Account page:**
  - grouped checkboxes, each marked «يشوف» or «يغيّر», with «فلوس» flags;
  - presets;
  - automatic dependency ticking and unticking;
  - optional sign-out-everywhere when reducing;
  - orders the account can reach;
  - sign-out everywhere;
  - activate / deactivate (deactivation ends all sessions).

Every change takes the user row lock and checks `users.permissions_version`.
It is audited as `USER_PERMISSIONS_CHANGED` (added / removed / after,
`reduced`), `USER_ACTIVATED` / `USER_DEACTIVATED` or `USER_SESSIONS_REVOKED`,
with the owner as the actor.

### Creating accounts and resetting passwords

The owner creates STAFF accounts and resets their passwords on `/users`.
Both actions:

- **re-authenticate the owner**, who must type their own password again;
- **audit wrong owner passwords** as `OWNER_REAUTH_FAILED`, and block further
  tries after 5 failures in 15 minutes;
- **are rate limited** to 10 account creations or password resets per hour;
- **are audited** as `USER_CREATED` / `USER_PASSWORD_RESET`, with the owner as
  the actor.

New accounts start with no permissions. A password reset signs the account
out everywhere.

The shell commands (`npm run users -- …`) still work.

## Migration `20261116151531_staff_permissions_order_visibility`

The migration is additive. It adds:

- the `OrderVisibility` enum;
- `orders.visibility` (default `PRIVATE`) and `orders.access_version`;
- `users.permissions` (default empty) and `users.permissions_version`;
- the `order_access` table.

It doesn't change any total, payment, production, delivery, item, design,
size, session or credential.

### Access changes on deploy

- **Every existing order becomes `PRIVATE`.** Staff see no orders until the
  owner shares them, either per order or with «ظاهر لكل العاملين المصرح لهم».
  This includes orders a staff member created before the upgrade. It is
  deliberately conservative; nothing becomes visible by accident.
- **Existing STAFF accounts get exactly what the old STAFF role allowed,**
  written out as explicit grants. That includes the reads the old role
  implied: order prices, payment history, production and delivery progress,
  and customer phones. No account gains anything. Review and narrow these in
  the UI after deploy (`npm run users -- list` shows them).
- **Owner accounts are unchanged.**

Rehearsed on a copy of the previous schema with representative data:

- 2 orders, priced items, designs, sizes, valid and voided payments,
  production, ready and delivery records;
- an inactive staff account and an open session.

Row checksums of every pre-existing table were identical before and after the
migration.

## Tests

- **Unit:**
  - `tests/unit/permissions.test.ts`: model, owner-only, no inference,
    presets, dependency helpers;
  - `tests/unit/staff-migration.test.ts`: the legacy grant equals the old
    role exactly, and the SQL is additive.
- **Integration:** `tests/integration/staff-access.test.ts` covers:
  - owner full access and zero-permission staff;
  - the read-only production worker, with no money keys or values in the
    JSON;
  - production and delivery read without write;
  - `PRIVATE`, `SELECTED_STAFF` and `ALL_AUTHORIZED_STAFF`;
  - guessed IDs, archived orders, PDFs and customer phones;
  - the finance summary versus the owner's reports;
  - permission management, immediate revocation, deactivation and sessions;
  - financial and production integrity.
