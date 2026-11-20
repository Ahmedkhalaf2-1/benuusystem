# Department dashboards, partner access and order flexibility: architecture plan

> **Status:**
> - Phase 1 (order flexibility and backdating): committed locally
>   (`aaf9fb3`), section 16.
> - Phase 2 (departments, partners, dashboards): implemented locally,
>   uncommitted, section 17.
> - Phase 3 (department finance, allocated collections, partner settlements,
>   presets): implemented locally, uncommitted, section 18.
> - Nothing is pushed or deployed. Owner decisions still open are listed in
>   18.8.
>
> **Snapshot:** branch `feature/ui-ux-overhaul` @ `9877d55`, the same build
> that is live in production. Production data was reset on 2026-11-20: 2 user
> accounts, 1 payroll worker, **0 orders, customers or payments**.
>
> **Labels:** **[EXISTS]** = confirmed in code. **[PROPOSED]** = new.
> **[DECISION]** = needs the owner before it is built.

---

## 1. Existing architecture findings

### 1.1 Stack and shape [EXISTS]

- One Next.js 16 App Router app (`src/app/(app)`) with server components,
  server actions and a few route handlers (`src/app/api`).
- PostgreSQL through Prisma 7 (`prisma/schema.prisma`, 10 additive
  migrations).
- Business logic lives in `src/server/services/*`. Every service takes an
  `Actor` and authorizes server-side.
- Arabic RTL, mobile-first PWA. One deployment and one database.

### 1.2 What does NOT exist (confirmed by search of schema and source)

| Concept in the brief | Exists? | What exists instead |
|---|---|---|
| Samples / approved-sample rule | **No.** There is no sample model, status or check anywhere. Orders are created directly. | — |
| Quotations | **No** | The agreed price is entered on the order. |
| Departments | **No** department entity | Work types per item/design: `PrintOperation` = `DTF`, `SCREEN_PRINT`, `EMBROIDERY`, `MANUFACTURING`. Product type is **free text** on the order (`productType`, e.g. «جراب موبايل»). Worker jobs (`WorkerJob`) mirror the trades. |
| Partners | **No** | Outside workshops can be recorded as `Supplier` with `OrderCost` (categories include `EMBROIDERY`, `PRINTING`, `OUTSOURCED_LABOR`) and `OutgoingPayment`. |
| Product catalog / SKU / variants / stock / inventory | **No.** PRODUCT.md lists inventory, SKUs and variants as explicit non-goals. | A suggestion list `PRODUCT_SUGGESTIONS` (تيشيرت، هودي، سويت شيرت، جراب موبايل…) and free-text `productType`. |
| Department-level money | **No** | See 1.4. |

> **Correction to the brief:** the rule "production orders must originate
> from approved samples" does not exist in this codebase, so there is nothing
> to preserve or bypass. If the business wants a sample step, that is a new
> feature and a business decision (section 13).

### 1.3 Orders [EXISTS]

- **`Order`:**
  - `id` (uuid) and `number` (gapless, unique; shown as `#0001`);
  - `title` («اسم الأوردر», required, max 150);
  - `customerId`, `productType` (text), `material`, `quantity`, `unit`;
  - `totalPrice`, `pricing` (`PER_ITEM` | legacy `ORDER_TOTAL`);
  - **`receivedDate` (date)**, `deliveryDate` (date), `notes`;
  - `status` (`NEW` → `IN_PROGRESS` → `COMPLETED`, plus `CANCELLED`);
  - `completedAt`, archive fields;
  - `visibility` (`PRIVATE` | `ALL_AUTHORIZED_STAFF` | `SELECTED_STAFF`) and
    `order_access`;
  - `idempotencyKey`, `createdById`, **`createdAt`**, **`updatedAt`**.
- **`OrderGroup` (an «بند», i.e. an item):** `name`, `quantity`, `material`,
  `unitPrice` (per-item pricing), `pressesPerUnit`, `notes`, operations, sizes
  (`OrderGroupSize`) and designs (`OrderGroupDesign`: name, one `operation`,
  placements, quantity, presses).
- **Status is automatic** (`refreshOrderStatus`): it follows the recorded
  production and deliveries. The only manual change is cancellation, which is
  owner-only.
- **Production** is tracked per item, size and design (`ProductionStageProgress`,
  `ProductionReady`, `Delivery`). Pieces are never double-counted across
  operations.
- **Creation is one server transaction** (`createOrder`) with idempotency, an
  optional inline new customer and an optional advance payment. Audit:
  `ORDER_CREATED`.

### 1.4 Money [EXISTS]

- **Customer payments (`OrderPayment`)** belong to the **whole order**
  (`orderId`). They have **no item, design or department allocation**. They
  are voidable with a reason, and attributable to a treasury account.
- **Order value:**
  - `PER_ITEM`: Σ `quantity × unitPrice`. **The price is per item, not per
    design.**
  - `ORDER_TOTAL` (legacy): one total, no item prices.
- **Outstanding** = `totalPrice − Σ valid payments`, always derived and never
  stored.
- **Order costs (`OrderCost`):** category, optional supplier, paid via
  `OutgoingPayment`. Supplier balances are derived.
- **Labour** is wages attributed to orders from worker output (derived).
- **Treasury:** accounts, movements and reconciliation (Phase 11).

**Consequence:** the only thing a department value could be derived from today
is the **item line total**, and only for `PER_ITEM` orders. Customer
collections can't be attributed to departments without a new rule (section 7).

### 1.5 Access control [EXISTS]

- **Roles:** `OWNER_ADMIN` (everything) and `STAFF` (deny by default).
- **Per-user grants** live in `users.permissions`
  (`src/lib/auth/permissions.ts`). Dependencies are enforced, owner-only keys
  are never grantable, and grants are re-read from the database on every
  request.
- **Per-order visibility:** effective order access = `orders:view` **and** the
  order's visibility. It is enforced in `order-access.ts` (`orderScope`,
  `orderScopeSql`, `canAccessOrder`) for lists, counts, search, dashboards,
  pickers, PDFs and every write. Hidden orders return `NOT_FOUND`.
- **Server-side money redaction:**
  - `OrderSummary.money` is `null` without `orders:view-prices`;
  - item prices are absent;
  - payments are `null` without `payments:view`;
  - phone numbers require `customers:view-contact`.
- **Audit log** (`audit_logs`): every write records the actor and metadata.

### 1.6 Frontend [EXISTS]

- **Dashboard** (`/dashboard`): a graphite greeting panel with status counts,
  quick actions, «أوردرات النهارده», «محتاج انتباهك», recent orders, and the
  owner's money card.
- **Orders:** `/orders` (filters, sort, search), `/orders/[id]`,
  `/orders/new`, `/orders/[id]/edit`, plus production, delivery, payment and
  cost sub-pages.
- **Other sections:** customers, workers, suppliers, expenses, `/accounts`
  reports, `/treasury`, `/users`.
- **Navigation:** `mainNavKeys` and `SIDEBAR_EXTRA_NAV` filter items by
  permission.
- **Data access:** server components call services directly. Mutations are
  server actions. There's a small set of JSON route handlers.
- **Shared components:** `OrderCard`, `ProductionTrack`, `StatusBadge`,
  `Fold`, `PeriodPicker`, `AccountField`, `OrderVisibilityPicker` and the
  permission editor.

---

## 2. Current functionality that can be reused

| Need | Reuse |
|---|---|
| Backdated orders | `Order.receivedDate` already stores the business receipt date, separate from `createdAt`/`updatedAt`, **with no lookback limit**. Reports and customer statements already use `receivedDate`. |
| Order name ("Emma Tourism") | `Order.title` («اسم الأوردر») already exists, is required, is searched (`orderListWhere`) and appears on cards, the detail page, the dashboard and PDFs. |
| Ready-made products | An item with no work type («بدون طباعة أو تطريز», `plain`) is already valid. Production treats it as immediately ready-capable (`maxReady = quantity`), so it can be confirmed ready and delivered with no manufacturing data. Sizes are optional. |
| Department classification signal | `PrintOperation` per item/design and `productType`, usable as **suggestions** only. |
| Scoped access | `orderScope` / `requireOrderAccess` pattern, per-user grants, redacted DTOs and `NOT_FOUND` for hidden orders. |
| Partner payables | `Supplier`, `OrderCost` (with `EMBROIDERY`/`PRINTING`/`OUTSOURCED_LABOR` categories), `OutgoingPayment`, derived supplier balances. |
| Dashboards | `getDashboardOverview` and `getProductionDashboard` query shapes, `OrderCard`, `ProductionTrack`, `PeriodPicker`, the graphite panel. |
| Account administration | `/users` (create staff, permissions, sessions), extended with department assignment. |

---

## 3. Required backend modifications [PROPOSED]

1. **A department dimension on order items.** One department per `OrderGroup`
   (see 7.1 for why per item rather than per order or per design).
2. **Department and partner access:** department grants per user (4.2), and a
   new scope function `departmentScope(actor)` next to `orderScope`.
3. **Partner-safe read services:** new services that return **only** the
   actor's department items, with their own DTOs. The existing `OrderDetails`
   is never reused, so totals, other items, phone numbers and payment rows
   can't leak.
4. **Department dashboard service:** counts, values and recent orders over the
   actor's departments, with every money query filtered by department.
5. **Order validation changes** (section 9): make `material` optional, offer a
   ready-made item preset, reject future receipt dates, and add an explicit
   advance-payment date for backdated orders.
6. **Order list and dashboard:** add sorting and filtering by `receivedDate`,
   and label "recently recorded" (`createdAt`) apart from "recently received".
7. **Audit:** include `receivedDate` and departments in the `ORDER_CREATED` and
   `ORDER_UPDATED` metadata. Audit entries already carry the real `createdAt`.
8. **Optional, decision-dependent:** customer collection attribution per
   department (7.3) and partner settlement view (7.4).

---

## 4. Required Prisma schema changes [PROPOSED]

All changes are additive. Nothing is dropped or rewritten. Production has no
orders, so backfill risk is minimal; the backfill rules still exist for
completeness and for local and preview data.

```prisma
/// A business line: «تطريز», «جرابات», «طباعة», «ملابس كاملة». A table, not
/// an enum, so future departments need no code change.
model Department {
  id        String   @id @default(uuid(7)) @db.Uuid
  key       String   @unique @db.VarChar(40)   // EMBROIDERY | COVERS | PRINTING | GARMENTS (seeded)
  name      String   @db.VarChar(80)
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  items     OrderGroup[]
  members   DepartmentMember[]
}

/// Which accounts may work in / see the money of which department.
/// No user identity is hard-coded; a partner is just an account with members.
model DepartmentMember {
  departmentId String  @db.Uuid
  userId       String  @db.Uuid
  canViewWork  Boolean @default(true)   // orders/items/production of this department
  canViewMoney Boolean @default(false)  // department value, attributed collections
  grantedById  String  @db.Uuid
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  @@id([departmentId, userId])
  @@index([userId])
}

model OrderGroup {
  // + one department per item (nullable during transition; required for new items)
  departmentId String? @db.Uuid
  @@index([departmentId])
}

model User {
  /// PARTNER = external party: never gets company-wide grants, sees only
  /// department-scoped data. Additive; existing rows default to INTERNAL.
  kind UserKind @default(INTERNAL)
}
enum UserKind { INTERNAL PARTNER }
```

**Optional, only after the decisions in section 13:**

```prisma
/// Explicit split of a customer payment across departments, only if the owner
/// chooses explicit allocation (7.3, option B).
model PaymentAllocation {
  id           String @id @default(uuid(7)) @db.Uuid
  paymentId    String @db.Uuid
  departmentId String @db.Uuid
  amount       Decimal @db.Decimal(12, 2)   // CHECK amount > 0; Σ per payment = payment.amount (service-enforced)
  @@unique([paymentId, departmentId])
}

/// Links a partner to the supplier record used for what we owe them (7.4).
// Department.partnerSupplierId String? @db.Uuid   (or User.supplierId)

/// Lightweight product presets (no stock), only if the owner wants a picklist (section 10).
model ProductPreset {
  id String @id @default(uuid(7)) @db.Uuid
  name String @unique
  departmentId String? @db.Uuid
  unit QuantityUnit @default(PIECE)
  defaultUnitPrice Decimal? @db.Decimal(12, 2)
  isActive Boolean @default(true)
}
```

**Indexes:**
- `order_groups(department_id)`;
- `department_members(user_id)`;
- `orders(received_date)` (the list will sort and filter on it; only
  `received_date` inside reports is used today);
- if allocations are added, `payment_allocations(department_id)`.

**Constraints:** keep all existing ones. A CHECK forbidding `PARTNER` accounts
from holding owner-only grants isn't possible in SQL. The service enforces it,
like today's `STAFF_GRANTABLE`.

---

## 5. Proposed endpoints and response contracts [PROPOSED]

The app uses server components and server actions, so these are **service
functions** first. JSON routes are only needed if a mobile client is added
later.

| Service / route | Who | Returns (never more) |
|---|---|---|
| `getDepartmentDashboard(actor, deptKey, period)` · page `/departments/[key]` | owner; members with `canViewWork` | `{ department, counts: { total, active, completed, cancelled }, statusBreakdown, recentItems[], activity[], money? }`. `money` only with `canViewMoney`: `{ value, attributedCollected?, attributedOutstanding?, unallocatedLegacyOrders }` |
| `getAdminDepartmentsOverview(actor, period)` · part of `/dashboard` | owner | one row per department with the same fields, plus a company total and an "unassigned items" bucket |
| `listDepartmentOrders(actor, deptKey, filters)` · `/departments/[key]/orders` | members | `DepartmentOrderRow`: `{ orderId, number, title, receivedDate, deliveryDate, customerName?, items: [{ id, name, quantity, production }], deptValue? }`. **No order total, no other departments' items, no phone number.** |
| `getDepartmentOrder(actor, deptKey, orderId)` · `/departments/[key]/orders/[id]` | members | `{ header, items (dept only), production (dept items only), money?: { deptValue, attributedCollected?, payments?: [{ date, attributedAmount }] } }`. `NOT_FOUND` when the order has no item in the department. |
| `getPartnerStatement(actor, deptKey, period)` · `/departments/[key]/money` | `canViewMoney` | value of assigned work, attributed collections, outstanding, payment history (attributed lines) and order-level summaries. **Plus, separately**, settlement balance (what Benuuprint owes or paid the partner) if 7.4 is adopted. |
| `setItemDepartment(actor, orderId, groupId, deptId)` | `orders:edit` (owner or internal) | audited `ORDER_ITEM_DEPARTMENT_CHANGED` |
| `setDepartmentMembers(actor, deptId, members[])` | owner (`users:manage`) | audited, with optimistic locking like `updateStaffPermissions` |

**Contract rule:** every partner-facing DTO is built with an explicit `select`
from the department's items. Nothing is computed from or serialized out of
`Order.totalPrice`, the `OrderPayment` rows of other departments, or
`customer.phone`.

---

## 6. Department and partner permission matrix [PROPOSED]

| Capability | Owner | Internal staff (existing grants) | Embroidery partner | Covers partner |
|---|---|---|---|---|
| Admin consolidated dashboard (all departments, company money) | ✔ | ✘ (company money stays owner-only) | ✘ | ✘ |
| Department dashboard: work | ✔ all | ✔ if a member with `canViewWork` | ✔ Embroidery only | ✔ Covers only |
| Department dashboard: money | ✔ all | ✔ if `canViewMoney` | ✔ Embroidery only, if granted | ✔ Covers only, if granted |
| See an order | ✔ | `orders:view` + visibility (unchanged) | only its **Embroidery items**, through the department view | only its **Covers items** |
| See the order total / other departments' items | ✔ | with `orders:view-prices` (unchanged) | ✘ never | ✘ never |
| Customer name | ✔ | ✔ | **[DECISION]** (default ✔: needed to work) | **[DECISION]** |
| Customer phone / contact | ✔ | `customers:view-contact` | ✘ (default) | ✘ (default) |
| Customer payment rows | ✔ | `payments:view` | ✘. Only **attributed amounts** for their department, if 7.3 is adopted | ✘ (same) |
| Record production / ready / delivery on their items | ✔ | existing grants | **[DECISION]** (grant `production:record` scoped to the department) | **[DECISION]** |
| Create or edit orders, prices, payments | ✔ | existing grants | ✘ | ✘ |
| Treasury, reports, suppliers, wages, users | ✔ | owner-only, as today | ✘ | ✘ |

### Enforcement design

- **`User.kind = PARTNER` is the hard backstop.** For partners:
  - `permissionsFor()` returns **only** `dashboard:view` plus
    department-scoped capabilities, whatever is stored;
  - `orderScope()` throws, so the general order screens are unreachable;
  - partners can read only through `department-*` services, which filter by
    `DepartmentMember`.
- **Internal staff** keep today's model, optionally with department
  membership to get department dashboards.
- **Defence in depth:**
  - every department service re-checks membership for the requested `deptKey`;
  - a non-member and an unknown department both return `NOT_FOUND`;
  - list counts are computed from the same filtered query, so hidden data
    never shows up as numbers.
- **Future partners or multiple departments:** add `DepartmentMember` rows. No
  user is hard-coded.

---

## 7. Financial data model and allocation requirements

### 7.1 Granularity: where a department can attach [ANALYSIS]

- **Per order: unsuitable.** One order can mix departments (e.g. 200 printed
  shirts + 50 phone covers).
- **Per design: unsuitable for money.** Designs carry **no price**: a shirt
  item with a DTF chest logo and an embroidered back name has one
  `unitPrice`. Designs can still carry the department for work views.
- **Per item (`OrderGroup`): proposed.** It is the smallest unit that already
  has a value (`quantity × unitPrice`).

**[DECISION]** when one item needs two departments (a printed and embroidered
shirt). Options:
- **(a)** The owner splits it into two priced lines (e.g. «تيشيرت مطبوع» +
  «تطريز اسم») so each department has its own value. This needs no new rule
  and is recommended.
- **(b)** Store a per-design price share. This is a new pricing concept and
  isn't recommended.

### 7.2 Department value [PROPOSED, derived, never stored]

`deptValue = Σ quantity × unitPrice` over the department's valid items, for
`PER_ITEM` orders.

- **Legacy `ORDER_TOTAL` orders** have no item prices, so no department value
  is invented. They are counted as **"غير موزّع"** (unallocated) and shown
  separately. Production currently has none.
- **Cancelled or archived orders** are excluded, as they are from order totals
  today.

### 7.3 Customer collections per department [DECISION REQUIRED]

Payments are order-level. "Collected for embroidery" doesn't exist today.
Options:

| Option | How | Pros | Cons |
|---|---|---|---|
| A. Pro-rata (derived) | attributed = payment × deptValue / orderTotal, computed in piasters with a deterministic remainder rule | no extra data entry; never double-counts (Σ attributed = payment) | it is a *rule*, not what the customer intended; changes if items change |
| B. Explicit allocation | `PaymentAllocation` rows entered when recording a payment (default pre-filled pro-rata, editable) | exact, auditable | extra step for staff; needs void/edit rules; must sum to the payment |
| C. Settle per department | customer pays per department (separate orders per department) | simplest accounting | changes how orders are taken; one customer order becomes several |

**No-double-count invariant (all options):** Σ attributed per payment =
payment amount, and Σ over departments per order = order paid.
Unattributable legacy money shows as «غير موزّع», never split silently.

**Recommendation:** A for dashboards (read-only, labelled «محسوب بالنسبة»),
moving to B only if partner settlements must follow actual customer money.

### 7.4 Customer collections vs partner settlement [DECISION REQUIRED]

- **What the customer paid** (7.3) and **what Benuuprint owes the partner**
  are different numbers. The partner may be owed a fixed price per piece, a
  percentage, or the entire department value.
- The existing model already covers *what we owe a workshop*: the partner is
  a **Supplier**, each job is an **`OrderCost`** (category `EMBROIDERY` or
  `OUTSOURCED_LABOR`) on the order, and payments are **`OutgoingPayment`**
  with derived balances and treasury attribution.
- **Proposed:** link each partner department to its supplier record
  (`Department.partnerSupplierId`). The partner statement then shows:
  1. work value and attributed collections (customer side);
  2. **separately**, settlement balance: costs recorded for them, paid, and
     outstanding (supplier side).
- **[DECISION]:**
  - the commission or settlement rule (fixed per piece, percentage, or the
    agreed cost per job);
  - whether settlement can depend on collection ("paid when the customer
    pays").
- Nothing is computed until this is decided.

---

## 8. Backdated order design

**[EXISTS]:**
- `receivedDate` is a user-selected business **date** (`DATE`, Africa/Cairo
  business day), with no lookback limit.
- `createdAt` and `updatedAt` are system timestamps (`@default(now())`,
  `@updatedAt`). They are never set from user input.
- Only `deliveryDate ≥ receivedDate` is validated.
- Reports and customer statements use `receivedDate`.

**Gaps found:**
1. **A future `receivedDate` is accepted.** **[PROPOSED]:** reject it (same
   rule as payments: «مينفعش يكون في المستقبل»).
2. **The advance payment is dated `receivedDate`.** For an order entered late,
   the advance may have been paid on the receipt day or today, and the date
   decides the treasury account rule (before or after the cutover).
   **[PROPOSED]:** an explicit `advancePaidAt` (default = receipt date,
   editable, not in the future, not before the receipt date).
3. **The order list "newest" sort and the dashboard "recent" use
   `createdAt`.** **[PROPOSED]:**
   - sort options «الأحدث استلامًا» (`receivedDate`) and «آخر اللي اتسجل»
     (`createdAt`);
   - a received-date range filter;
   - the dashboard "recent" relabelled «آخر الأوردرات المتسجلة»;
   - a «اتسجل متأخر» chip on the order page when `createdAt` is more than one
     day after `receivedDate`, showing both dates.
4. **`ORDER_CREATED` audit metadata lacks `receivedDate`.** **[PROPOSED]:**
   include it, plus `entryLagDays`. The audit row's own `createdAt` remains
   the real entry time.
5. **No timezone change.** Business dates stay `DATE` in Cairo time.
   Timestamps stay `timestamptz`.

---

## 9. Flexible order workflow design

**[EXISTS] currently required on create:**
- customer;
- `title`;
- `productType`;
- **`material`** (order level);
- per item: quantity, **work type or explicit «بدون»**, and a name and unit
  price with item pricing;
- `receivedDate`;
- **`deliveryDate`**;
- price > 0.

Optional today: sizes, designs, placements, presses and notes. There is no
sample or quotation step.

**[PROPOSED]**, keeping the invariants (customer, at least one item with a
quantity, a positive server-computed price, idempotency, permissions):

| Field | Change |
|---|---|
| `material` | Optional. Make the column nullable (additive) or store `""` and show «—». |
| Work type | Default **«بدون»** when the item comes from the ready-made preset. Explicit choice stays for custom work. |
| Specifications (colours, artwork, printing/embroidery details, manufacturing notes) | Remain optional designs and notes. The form shows them collapsed under «تفاصيل التصنيع (اختياري)». |
| `deliveryDate` | **[DECISION]**: keep it required (overdue alerts depend on it) or allow «لسه مش محدد». Making the column nullable changes overdue and attention logic. |
| Price | Stays required and > 0. **[DECISION]** if free or sample orders exist. |

**Workflows:** one form, no new order types needed.
1. **Custom manufacturing order:** today's flow (items with designs and
   operations).
2. **Manual / simple order:** minimal fields, specifications collapsed.
3. **Ready-made product order:** «منتج جاهز» items (preset name, «بدون» work
   type, optional sizes). Production can mark them ready and delivered at once
   (existing behaviour).

A stored order "type" isn't required by the architecture. An item-level flag
is only worth adding if the department dashboards need to separate
ready-made sales (**[DECISION]**).

---

## 10. Ready-made product integration

- **[EXISTS]:** no catalog, SKU, variant, stock or inventory. PRODUCT.md
  states inventory and SKUs are out of scope. Ready-made selling works today
  as «بدون» items with optional sizes.
- **[PROPOSED, minimal]:** an optional `ProductPreset` picklist (name, default
  department, unit, optional default unit price). It pre-fills an item and has
  **no stock**. It replaces the hard-coded `PRODUCT_SUGGESTIONS` for owners who
  want to manage the list.
- **[DECISION]:** whether finished-goods **stock** is wanted (counts, reserve
  on order, decrease on delivery). That would be a new module and a change to
  PRODUCT.md, so it isn't proposed by default. No stock reservation is assumed
  anywhere.

---

## 11. Frontend pages and components affected

| Area | Change |
|---|---|
| `/dashboard` (owner) | Add a «الأقسام» strip: one compact row per department (orders, active, value, collected) linking to its dashboard. The money columns keep the existing owner-only rule. |
| **New** `/departments/[key]` | Department dashboard. Reuses the graphite panel, `OrderCard` variant (department items only), `ProductionTrack`, `StatusBadge` and `PeriodPicker`. |
| **New** `/departments/[key]/orders`, `/[id]`, `/money` | Partner-safe list, detail and statement. **New DTO components**: the existing `OrderCard`/`OrderDetails` are not reused, because they assume whole-order data. |
| Navigation | `mainNavKeys`: partners get Home (their department dashboard) and «شغلي» only. Internal members get «الأقسام». |
| Login landing | Partners land on `/departments/[their key]`. With more than one department, they get a department chooser. |
| `/orders/new`, edit | Department select per item (pre-suggested from work type and product), «منتج جاهز» item preset, collapsed specifications, optional material, `advancePaidAt`, no future receipt date. |
| `/orders` | Sort by receipt or recording date, receipt-date filter, «اتسجل متأخر» chip. |
| `/users/[id]` | «الأقسام» section: department membership, view work / view money, and an internal/partner account type. |
| Shared | `DepartmentBadge`. Department colours **are not added** (DESIGN.md: one accent); departments are named in words. |

---

## 12. Backward compatibility and migration risks

| Risk | Mitigation |
|---|---|
| Existing items have no department | Production has 0 orders. For local and preview data, a one-off **suggested** backfill (from work type and product type) applied only after owner review. `departmentId` stays nullable, and unassigned items show in an «غير محدد» bucket and never vanish. |
| Partner data leaks through existing endpoints | Partners never reach `orderScope`-based services (it throws). Partner DTOs are separate. Tests assert JSON contains no `totalPrice`, other items, phone numbers or payment rows. |
| Double-counting money across departments | Pro-rata or explicit allocations must sum exactly to each payment. Legacy money goes to «غير موزّع». |
| Customer and partner money mixed up | Separate sections, data sources (payments vs supplier costs) and labels. |
| Backdated advance on the wrong treasury rule | Explicit `advancePaidAt`. The treasury rule uses that date. |
| Item price changes after collections (pro-rata shifts) | Show the basis «محسوب بالنسبة»; option B fixes the allocation at payment time. |
| Optional `material` / `deliveryDate` breaking queries | Nullable columns with display fallbacks. Overdue logic skips null delivery dates (only if the decision allows null). |
| Performance of department aggregates | Index `order_groups(department_id)`; aggregates in SQL, not JS. |

All migrations are additive (new tables, nullable columns, indexes), so the
previous release keeps working against the new schema and rollback means
switching the release.

---

## 13. Required business decisions

1. **Department of each kind of work.**
   - Confirm the mapping: «طباعة» = DTF + screen printing; «تطريز» =
     embroidery; «جرابات» = phone covers; «ملابس كاملة» = garment making
     and/or ready-made garments.
   - Are ready-made sales a department of their own?
2. **One item, two departments:** split into priced lines (recommended), or
   another rule?
3. **Customer collections per department:** pro-rata display (A), explicit
   allocation (B), or separate orders per department (C)?
4. **Partner settlement rule:** fixed per piece, percentage, or agreed cost per
   job? Does it depend on customer collection?
5. **What partners see:** customer name (yes/no), customer phone (default no),
   delivery dates, notes.
6. **What partners may do:** read-only, or record production, ready and
   delivery on their items? Should they see wages or costs (default no)?
7. **Order visibility vs department:** does department membership alone give a
   partner access to those items, or must the owner also share each order?
8. **Delivery date required?** And are zero-price orders allowed?
9. **Finished-goods stock:** wanted or not (it changes product scope)?
10. **Samples or quotations:** wanted as a new step? There is none today.

---

## 14. Phased implementation plan

| Phase | Scope | Depends on |
|---|---|---|
| **0. Decisions** | Answers to section 13 | — |
| **1. Order flexibility and backdating (low risk, no new money rules)** | Reject future receipt dates; `advancePaidAt`; receipt-date sort and filter; «اتسجل متأخر»; audit `receivedDate`; optional `material`; «منتج جاهز» item preset; collapsed specifications | Decisions 8, 9 |
| **2. Departments (work only)** | `Department` table and seed; `OrderGroup.departmentId` with a suggested default; department select in the form; owner «الأقسام» strip; `/departments/[key]` work dashboard for the owner | 1, 2 |
| **3. Department membership and partner accounts (work only)** | `DepartmentMember`; `User.kind`; partner hard backstop in `permissionsFor` and `orderScope`; partner-safe services and DTOs; partner landing and navigation; `/users` department section | 5, 6, 7 |
| **4. Department money** | `deptValue`; collection attribution (A, or B with `PaymentAllocation`); partner money dashboard and statement; «غير موزّع» bucket | 3 |
| **5. Partner settlements** | Partner ↔ supplier link; settlement balances from `OrderCost`/`OutgoingPayment`; settlement rule if not "agreed cost per job" | 4 |
| **6. Optional** | `ProductPreset` management; stock only if decided | 9 |

Each phase ships behind the existing release flow:
1. additive migration;
2. backup;
3. rehearsal on a restored production copy;
4. financial baseline diff;
5. owner approval.

---

## 15. Testing strategy

- **Authorization:**
  - a partner account never reaches the general order services (`orderScope`
    throws);
  - department services return `NOT_FOUND` for non-members, unknown
    departments and orders without their items;
  - JSON of partner DTOs contains **no** `totalPrice`, other departments'
    items, phone numbers or customer payment rows (key and value scans, as in
    `staff-access.test.ts`);
  - counts and search never include hidden items;
  - stored owner-only grants on a partner row are ignored;
  - revoking membership takes effect on the next request;
  - partners can't change their own memberships.
- **Finance:**
  - department values sum to the order total for `PER_ITEM` orders;
  - legacy `ORDER_TOTAL` shows as unallocated;
  - attributed collections sum exactly to each payment (piaster remainder
    rule);
  - voided payments disappear from every department once;
  - mixed-department order with partial payments;
  - customer collections never equal or replace partner settlement figures;
  - treasury totals unchanged.
- **Migrations:**
  - additive-only SQL check (as in `staff-migration.test.ts`);
  - rehearsal on a restored production copy;
  - financial baseline diff identical.
- **Workflows:**
  - create a custom, a simple and a ready-made order;
  - backdated order with an advance on a different date (treasury rule follows
    `advancePaidAt`);
  - future receipt date rejected;
  - receipt-date sorting and filtering;
  - ready-made items marked ready and delivered without production stages.
- **UI:**
  - Playwright at 390, 768 and 1280: department dashboards for owner, internal
    member and each partner;
  - navigation shows only allowed destinations;
  - no money for members without `canViewMoney`;
  - RTL and both themes.

---

## 16. Phase 1 implementation results (2026-11-20)

**Scope delivered:** backdated orders, the advance's own payment date,
optional material and design details, the «منتج جاهز» item workflow, and
receipt-date sorting. No departments or partner work was started.

### Database

- **No migration.** Nothing in Phase 1 needed a schema change.
- An optional `material` is stored as `""` in the existing `NOT NULL` column
  and shown as «—». Material suggestions ignore it.
- Ready-made items reuse the existing «بدون» item: no designs and no work
  type.
- The `orders(received_date)` index was **not** added. The list sorts on it,
  but data volume doesn't justify a migration yet. Add it with Phase 2's
  additive migration.

### Backend (`src/lib/validations/order.ts`, `src/server/services/order-service.ts`)

| Change | Detail |
|---|---|
| Future receipt date | Rejected on create: «تاريخ الاستلام مينفعش يكون في المستقبل». On edit, it is rejected only when the date **changes**, so an older row is never locked. No lookback limit. |
| `advancePaidAt` | New optional field on the create contract. Must be a valid date and not in the future. When missing (older callers), it defaults to **today**, never the receipt date. The payment's `paidAt` and the treasury rule (`accountForNewPayment`) use it. |
| Audit | `ORDER_CREATED` now carries `receivedDate`, `deliveryDate`, `entryLagDays` and `advancePaidAt`. `PAYMENT_RECORDED` for the advance carries `paidAt`. `ORDER_UPDATED` always carries `receivedDate`, and `changes.receivedDate` when it changed. `createdAt`/`updatedAt` stay system-managed. |
| `material` | Optional (max 80 characters). Items inherit the order's value, which may be `""`. |
| Sorting | `newest` = `receivedDate desc, createdAt desc, number desc`. `oldest` = the mirror of it. New `recorded` = `createdAt desc, number desc`. `delivery` is unchanged. |
| `daysBetween` | New helper in `src/lib/dates.ts` (Cairo business dates). |

### Frontend

- **`/orders/new` and edit:**
  - Material and unit fold into «الخامة والوحدة (اختياري)».
  - Each item has a «طباعة / تطريز | منتج جاهز» switch. Ready-made shows
    preset chips (`READY_MADE_PRESETS`: تيشيرت، هودي، سويت شيرت، بولو، كاب،
    شنطة) or a typed name, and no manufacturing fields. The first preset also
    fills an empty product type.
  - A design needs only its work type. Its name, placement, pieces, presses
    and notes fold into «تفاصيل الرسمة (اختياري)», which opens when it has
    values or errors.
  - The «التواريخ» section shows the receipt date with `max=today`, a
    backdated notice, then the delivery shortcuts (counted from today) and
    the date.
  - The advance has «تاريخ دفع المقدم»: defaults to today, `max=today`, with
    «النهارده / يوم الاستلام» chips for backdated orders. When the advance is
    dated before the treasury cutover, the account picker is replaced by a
    note and no account is sent.
- **`/orders`:**
  - sorts «الأحدث استلامًا / الأقدم / أقرب تسليم / آخر تسجيل»;
  - a «الاستلام» column on desktop;
  - «استلام …» on cards.
- **`/orders/[id]`:**
  - an «اتسجل متأخر» note when the order was entered more than one day after
    its receipt date;
  - «—» for an empty material.
- **Unchanged:** the dashboard («آخر الأوردرات» still means recently
  recorded), reports and PDFs. Reports already use `receivedDate` and
  `title`.

### Tests

- New `tests/integration/order-flexibility.test.ts` (13 tests) covers:
  - a normal order named «Emma Tourism»;
  - historical receipt dates with real timestamps and audit;
  - future dates on create and edit;
  - the advance on a different date, the default to today, and invalid or
    future advance dates;
  - the treasury cutover following the advance date, with the balance
    checked;
  - an order without material or design details;
  - essentials still required;
  - ready-made T-shirt and Hoodie orders (with sizes) reaching ready →
    delivered → completed;
  - a mixed order;
  - receipt-date sorting with deterministic ties;
  - search by name;
  - financial totals.
- New `tests/unit/order-flexibility.test.ts` (10 tests) covers the shared
  schema rules and `daysBetween`.
- `orders.test.ts`: the dashboard test now passes `advancePaidAt` explicitly,
  because it relied on the old "advance = receipt date" behaviour.
- **Results:**
  - `vitest run`: 34 files, 307 tests passed;
  - `npm run typecheck`: clean;
  - `eslint`: clean;
  - `npm run build`: succeeded;
  - manual check on the local `*_preview` database at mobile width: a
    backdated Hoodie order with the advance on another date, the detail page,
    sorting, search, and an unchanged edit save.

### Still open (owner decisions; no rule invented)

- **Advance dated before the receipt date:** allowed, as for every other
  payment today. Decide whether to forbid it.
- **Delivery date:** still required (decision 8).
- **Zero-price orders:** still refused (decision 8).
- **Presets:** a fixed list in code. A managed `ProductPreset` table waits
  for Phase 6.
- **Treasury cutover with several accounts:** the form hides the account
  picker before the **earliest** opening date. An account opened later still
  refuses earlier payments with the existing server message.

---

## 17. Phase 2 implementation results (2026-11-20)

### 17.1 Database: migration `20261120120000_departments_partners` (additive)

- `Role` gains `PARTNER`. No existing account changes role.
- `departments`:
  - columns: `id`, `key` (nullable, unique; for seeded rows only), `name`
    (unique), `is_active`, `sort_order`, `created_by_id`, timestamps;
  - seeded with تطريز (EMBROIDERY), كوفرات (COVERS), طباعة (PRINTING) and
    ملابس / منتج كامل (GARMENTS);
  - departments are never deleted, only deactivated.
- `department_members`:
  - key `(department_id, user_id)`, indexed by `user_id`;
  - three independent switches: `can_view_work`, `can_view_money`,
    `can_record_production`;
  - also `granted_by_id` and timestamps;
  - cascades with the user or department.
- `order_groups.department_id` is a nullable FK (`ON DELETE RESTRICT`) with an
  index.
- **The only `UPDATE`** fills `order_groups.department_id` for existing items,
  using the same rule as the app's suggestion (`src/lib/departments/suggest.ts`):
  - "covers" in the item name, or the product type if unnamed → COVERS;
  - otherwise the primary work type (the first design's operation, else the
    first item-level operation):
    - EMBROIDERY → EMBROIDERY;
    - DTF / SCREEN_PRINT → PRINTING;
    - MANUFACTURING or none → GARMENTS.
  - A test runs the SQL and checks that it matches the TypeScript rule.
- No prices, totals, payments, treasury, production or delivery rows are
  touched. Nobody gains access: memberships start empty.
- **Deployment note:** `ALTER TYPE "Role"` must be run by the role that
  **owns** the type, which is the production app role. On the local preview
  database, the restricted `preview_runner` role can't run it. The failed
  attempt was marked rolled back there and nothing was applied. Confirm the
  production migration role owns `Role` during rehearsal.

### 17.2 Backend

**Permissions (`src/lib/auth/permissions.ts`)**

- `permissionsFor()` returns **nothing** for `PARTNER`, whatever is stored on
  the row. This is the hard backstop: every company-wide service refuses
  partners, including orders, customers, payments, treasury, reports,
  `/dashboard`, PDFs and the JSON APIs.
- `homePathFor()` sends partners to `/departments`.

**`department-access.ts`**

- `departmentGrants()`:
  - the owner reaches every department;
  - anyone else reaches active departments where they have a membership with
    `canViewWork`;
  - grants are re-read from the database on every request.
- `requireDepartment()` returns `NOT_FOUND` for an unknown, inactive,
  ungranted or malformed department, and `FORBIDDEN` for a missing money or
  production switch.

**`department-service.ts`** (explicit allowlist DTOs)

- `getDepartmentDashboard`:
  - order counts (total, active, completed, cancelled);
  - item work-status counts;
  - pending pieces and ready-not-delivered;
  - the 6 most recent department orders and the last 10 activity records.
- `listDepartmentOrders` (filter, search, pages).
- `getDepartmentOrder`: the order header plus **this department's items
  only**, with progress, designs, sizes and item notes.
- **Never included in any of them:**
  - the order total, paid or outstanding;
  - other departments' items;
  - the customer phone and order notes;
  - payments, costs and wages.
- `getDepartmentsOverview` (owner): per-department stats, an
  "unassigned items" bucket and a **no-double-count check**: Σ department
  values + unassigned = Σ totals of item-priced orders.
- Department and membership management (owner only, audited):
  - `createDepartment`, `updateDepartment` (name, active);
  - `setDepartmentMembership`, `revokeDepartmentMembership`;
  - nobody can edit their own access or an owner's.

**Orders**

- Every new or edited item gets **one** department:
  - an explicit department must be active (an existing item may keep a
    department that was since deactivated);
  - if none is sent, an existing item keeps its department;
  - otherwise the documented suggestion is applied.
- The department is included in the audit metadata and in `OrderDetails.groups[].department`.

**Production**

- `recordStageProgress` and `recordReady` accept a department scope:
  - authorized by the membership's `canRecordProduction`, re-checked under the
    order lock;
  - limited to that department's items on non-archived orders;
  - audited with `departmentId` and `via: "department"`.
- Deliveries, prices, payments and voids stay with the general permissions,
  which partners never have.

**Partner accounts** (`staff-access-service.ts`)

- The owner creates them with `kind: "PARTNER"`, using the same password
  re-authentication, rate limit and audit as staff accounts.
- Activate/deactivate, password reset and sign-out work as for staff.
- `updateStaffPermissions` refuses partners.
- Partners can't be assigned order visibility (`listAssignableStaff` lists
  STAFF only).

**Audit actions:** `DEPARTMENT_CREATED`, `DEPARTMENT_UPDATED`,
`DEPARTMENT_ACCESS_CHANGED` (before and after), `DEPARTMENT_ACCESS_REVOKED`.

### 17.3 Frontend

- **`/departments`:**
  - the owner sees the overview cards, the unassigned warning and the
    no-double-count panel;
  - members see their departments, and go straight in when there's only one.
- **`/departments/[id]`:** the dashboard (stage panel, recent orders, item
  statuses, activity) and the money panel when `canViewMoney` is on.
- **`/departments/[id]/orders`:** a list with open/completed/all filters,
  search and paging.
- **`/departments/[id]/orders/[orderId]`:** the department-scoped order, with
  «تسجيل إنتاج / جاهز» when allowed.
- **`.../production`:** reuses `ProductionForm` in department mode.
- **`/departments/manage`** (owner): add, rename and deactivate departments,
  and see who has access.
- **`/users`:** «إضافة حساب جديد» with موظف/شريك, and a «حسابات الشركاء» list.
- **`/users/[id]`:** a «الأقسام» section with three switches per department
  plus revoke. Partners don't get the permission editor.
- **Navigation:**
  - partners get «شغل القسم» + «المزيد» only and land on `/departments`;
  - `/dashboard` redirects partners;
  - «الأقسام» appears in the sidebar for the owner and for department members.
- **Order form:** a «القسم» chip row per item, with the suggestion
  pre-selected (marked «مقترح») and a hint when an item's work spans two
  departments. The order page shows each item's department.

### 17.4 Tests

- `tests/integration/departments.test.ts` (13 tests):
  - departments CRUD and auth;
  - item assignment (explicit, suggested, kept, invalid, inactive);
  - partner creation, login, landing and deactivation;
  - the partner backstop (stored grants ignored; every general service
    refused);
  - JSON leak scans (no totals, other items, phones, notes, payments or
    values without the switch);
  - `NOT_FOUND` for other departments, unknown or malformed ids, orders
    without department items and archived orders;
  - cross-partner isolation;
  - revocation, work-off and deactivation taking effect on the next request;
  - money values with and without the switch;
  - no double count (balanced overview, cancelled orders excluded);
  - department production writes, audited, refused on other items,
    departments and deliveries;
  - owner and staff-member visibility;
  - existing orders, payments and Phase 1 flows;
  - the backfill SQL matching the TypeScript rule.
- `tests/unit/departments-migration.test.ts` (6 tests): additive SQL, one
  `UPDATE`, the seeds, the suggestion rule and the partner backstop.
- **Totals:** full suite 36 files / 326 tests passing; `typecheck`, `eslint`
  and `next build` clean.

### 17.5 How department money is shown in Phase 2

- **Department value** = Σ quantity × unit price of the department's items on
  non-cancelled, non-archived orders. It's labelled «قيمة شغل القسم», never
  revenue or collected.
- Items on older `ORDER_TOTAL` orders have no price of their own and are shown
  as «غير موزّع». No value is invented for them.
- Customer collections per department are always shown as **pending**
  (`collections: "PENDING_PHASE_3"`). Partners never see whole-order payments.

### 17.6 Owner decisions still open (Phase 3 depends on these)

1. **Collections per department:** pro-rata (A), explicit allocation (B) or
   separate orders (C) (section 7.3).
2. **Partner settlement rule:** per piece, a percentage, or an agreed cost per
   job; and whether it depends on customer payment (section 7.4). The
   partner ↔ supplier link isn't built yet.
3. **One item, two departments:** today it belongs to the department chosen
   (by default, its first design's work). Confirm the "split into two priced
   items" rule.
4. **What partners see:** the customer **name** is shown and the phone is
   not. Confirm, or hide the name too.
5. **Department membership vs. order visibility:** membership alone currently
   gives access to the department's items, even on a private order. Confirm,
   or require the order to be shared as well.
6. **Partner production rights:** partners may record steps and «جاهز» (when
   switched on), but never deliveries. Confirm.
7. **Ready-made sales:** they are currently in «ملابس / منتج كامل». Should
   they be a department of their own?

---

## 18. Phase 3 implementation results (2026-11-21)

### 18.1 Database: migration `20261121090000_department_finance_presets` (additive)

**New columns**

| Table | Column | Purpose |
|---|---|---|
| `department_members` | `can_view_collections` (default **false**) | allocated collections switch |
| `department_members` | `can_view_settlements` (default **false**) | own settlement switch |
| `orders` | `hidden_from_departments` (default **false**) | hide an order from department views |
| `users` | `supplier_id` (nullable, unique FK) | partner ↔ settlement supplier |
| `order_costs` | `department_id` (nullable FK, indexed) | which department the job is for |
| `order_costs` | `quantity`, `unit_cost` (nullable) | «بالقطعة» |

`order_costs` gets two CHECK constraints: `quantity` and `unit_cost` must be
set together, and both must be > 0.

**New tables**

- `order_group_value_shares`:
  - key `(order_group_id, department_id)`, with `amount > 0` (CHECK),
    `set_by_id` and `created_at`;
  - the owner's explicit split of one item's value across departments.
- `product_presets`:
  - columns: unique `name`, `is_active`, `sort_order`, `created_by_id`,
    timestamps;
  - seeded with تيشيرت، هودي، سويت شيرت، بولو، كاب، شنطة.

**Safety**

- No `UPDATE`, `DELETE`, `DROP`, `RENAME` or `ALTER TYPE`. Nobody gains any
  access.
- This migration needs **no enum ownership**.

**Enum ownership (Phase 2 review)**

- Phase 2's `ALTER TYPE "Role" ADD VALUE 'PARTNER'` must be run by the role
  that **owns** the type.
- `npm run db:check` now includes a read-only **migration privileges**
  check: it lists every public table and enum type the connecting role
  doesn't own.
- Results on 2026-11-21:

| Database | Ownership | Migrations |
|---|---|---|
| Test | owned ✓ | all 11 applied |
| Local dev (`benuuprint`) | owned ✓ | 3 pending (treasury, Phase 2, Phase 3); not migrated by this task |
| Local preview | **not owned** (44 objects belong to `benuuprint`; the app connects as `preview_runner`) | can only be migrated with the owner's credentials |

- **Before production:** run `npm run db:check` with the deploy credentials;
  "Migration privileges" must show ✓.

### 18.2 Allocation of customer payments (`src/lib/finance/allocation.ts`)

**Basis per order** (each item's value counts exactly once):
- `PER_ITEM` items go to their department.
- An item with a valid owner split goes to the split's departments, by the
  split amounts.
- Everything else goes to **UNALLOCATED**:
  - items with no department;
  - **stale** splits (they no longer add up to the line value after a price
    or quantity change);
  - the whole total of older `ORDER_TOTAL` orders.

**Each valid payment** is split by the largest-remainder method in integer
piasters (BigInt):
- `floor(P × w / W)` per bucket;
- the leftover piasters go one each to the largest remainders;
- ties are broken by department sort order, with UNALLOCATED last;
- with no positive basis, the whole payment is UNALLOCATED.

**Guarantees**
- Σ shares = the payment, exactly. This is property-tested on 2,000 random
  cases.
- Voided payments are excluded.
- Payments, treasury and accounting are untouched: allocation is **derived**,
  never stored, and creates no transactions.
- Each `PAYMENT_RECORDED` audit entry, including the order's advance, now
  carries a `departmentAllocation` snapshot.

**Per department**
- Allocated collections, outstanding (value − collected), paid / partial /
  unpaid orders, and per-payment history.
- Labelled «تحصيل موزّع»: never "paid to the partner".

**Owner reconciliation** (`/departments`):
- Σ department values + unallocated = Σ order totals (non-cancelled);
- Σ department collections + unallocated = Σ valid customer payments.

### 18.3 Mixed-department orders

- **Physical work:** each item still belongs to one department. Production and
  quantities are never duplicated.
- **Money split:** the owner can split one item's value across departments on
  the order page («الأقسام وتقسيم القيمة»):
  - exact amounts that must equal the line value;
  - owner only;
  - audited as `ORDER_VALUE_SPLIT_SET`.
- **Display:**
  - a department's share of another department's item shows as «نصيب القسم
    من بنود أقسام تانية» (money switch only);
  - an item that can't be allocated reliably is counted under
    `unreliableItems` and shown as «غير موزّع».

### 18.4 Partner settlements (`partner-settlement-service.ts`)

**Built only from the existing payables**
- Each job is an **order cost** for the partner's linked supplier, tagged with
  a department.
- The amount is either:
  - an agreed price per job; or
  - pieces × an agreed cost per piece, which must match the amount exactly.
- Payouts use the existing supplier payment flow (partial payments, voids,
  treasury attribution unchanged).

**Totals**
- payable = Σ valid costs; paid = Σ valid outgoing payments; remaining.
- History of jobs and payouts.

**Separation from customer money**
- Customer payments **never** create partner payouts.
- No commission or percentage exists anywhere.

**Who sees what**
- A partner sees only **its own** linked supplier's costs, tagged with
  departments where its settlements switch is on.
- Jobs on hidden orders appear with the order title masked.
- The owner sees per-department settlements (`/departments/[id]/settlement`)
  and per-partner totals (`/users/[id]`).
- The owner links a partner to its supplier from the account page («مورد جديد
  باسم الشريك», or an existing unlinked supplier). Audited as
  `PARTNER_SUPPLIER_LINKED`.

### 18.5 Permissions

Membership switches (independent; all default off):
- see the work;
- record production;
- work value;
- allocated collections (**effective only with the work-value switch**,
  because an outstanding balance reveals the value);
- own settlement.

Other rules:
- `Order.hiddenFromDepartments` (owner only, audited) removes the order from
  every non-owner department view: work, value, collections and production
  writes.
- All checks run in the services. Responses are explicit allowlists.
- Leak scans in the tests confirm partners never receive:
  - whole-order totals or payments;
  - other departments' shares;
  - payment ids;
  - phone numbers;
  - other partners' settlements.

### 18.6 Interfaces

- **`/departments`:** value, allocated collections and outstanding per
  department, plus both reconciliation checks.
- **`/departments/[id]`:**
  - the money panel (value, collected, outstanding, paid/partial/unpaid);
  - the latest allocated collections;
  - a link to the settlement.
- **New pages:** `/departments/[id]/collections` (full history) and
  `/departments/[id]/settlement` (partner: own; owner: per supplier).
- **Department order pages:** per-order value, collected, status chip,
  allocations, and shared-work lines.
- **`/orders/[id]` (owner):** «الأقسام وتقسيم القيمة» with the hide toggle and
  a split editor per item (live sum check, stale warning).
- **`/orders/[id]/costs/new`:** a department select and «بالقطعة» (pieces ×
  cost per piece fills the amount).
- **`/users/[id]` (partner):** the supplier link and settlement totals; the
  department rows have the two new switches.
- **`/orders/presets`** (owner, linked from «المزيد»): add, rename,
  hide/show and reorder presets. The order form reads the active list.

### 18.7 Tests

- `tests/unit/allocation.test.ts` (8): exactness, ties, randomized
  reconciliation, attribution, stale splits, basis order, status.
- `tests/unit/departments-migration.test.ts`: Phase 3 SQL is additive, needs
  no enum change, defaults are off, constraints and seeds are present.
- `tests/integration/department-finance.test.ts` (10):
  - pro-rata allocation and reconciliation with partial and full payments;
  - voids and the audit snapshot;
  - ambiguous money stays unallocated (legacy single-total orders, items with
    no department);
  - 3-way piaster rounding;
  - explicit splits: validation, owner-only, allocation follows the split, no
    duplicated physical work, stale splits flagged;
  - switch independence and the collections dependency, with leak scans;
  - hidden orders (work, money, production);
  - settlements: unlinked, per-piece and per-job, mismatches rejected, partial
    and voided payouts, separation from collections, owner views;
  - cross-partner isolation and masking;
  - presets.
- `departments.test.ts` updated to the new money shape.
- **Totals:** full suite 38 files / **346 tests** passing; `typecheck`,
  `eslint` and `next build` clean.

### 18.8 Owner decisions still open (nothing invented)

1. **Settlement rates:** the agreed job price or per-piece cost is typed per
   job by the owner. No standing rate table exists. Decide if one is wanted.
2. **Settlement timing:** whether settlements should wait for customer
   collection is a policy, not enforced. Payouts are manual.
3. **Collections rule:** pro-rata by priced work is implemented as the display
   rule. Confirm it, or ask for explicit per-payment allocation instead.
4. **Older single-total orders:** they stay «غير موزّع». Convert them to item
   pricing if they should count for departments.
5. **Partners and customer names:** partners see the customer name, never the
   phone number. Confirm.
6. **Default for new orders:** visible to the departments of their items;
   the owner can hide individual orders. Confirm the default.
7. **Partner delivery rights:** partners still can't record deliveries.
   Confirm.
8. **Ready-made sales:** they currently count under «ملابس / منتج كامل».
   Confirm, or add a department for them.
