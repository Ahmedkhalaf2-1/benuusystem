# Benuuprint ERP

Management system for **Benuuprint** (garment manufacturing, DTF, screen printing, embroidery and phone-case printing).

- **Phase 1:** foundation. Authentication, database, the Arabic RTL mobile-first app shell, PWA install.
- **Phase 2:** customers, orders (with groups and printing/embroidery work), customer payments, real dashboard numbers.
- **Phase 3:** order costs, suppliers (balances and payments), general expenses, money-out tracking.
- **Phase 4:** workers, daily wages (attendance), productivity, labour cost per order, wage payments and advances, financial privacy by role.

Official production, delivery and monthly accounts (profit) come in later phases. Until then they show a "قريبًا" (coming soon) state.

---

## Technology

| Area | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript 6 (strict) |
| UI | Tailwind CSS 4, shadcn/ui (Base UI, RTL), lucide icons, IBM Plex Sans Arabic |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Own implementation: Argon2id passwords, database sessions, HttpOnly cookies |
| Validation | Zod 4 (shared by client and server) |
| Tests | Vitest (unit + PostgreSQL integration tests) |
| Hosting | Ubuntu VPS, Node.js, PM2, Caddy (HTTPS), PostgreSQL |

There are no external paid services, no Supabase/Firebase/Vercel dependencies and no separate backend. Next.js serves the UI, server actions and API routes from one repository.

## Project structure

```text
prisma/
  schema.prisma            Database schema (users, sessions, audit_logs, login_attempts)
  migrations/              SQL migrations (committed)
prisma.config.ts           Prisma CLI config (reads DATABASE_URL)
scripts/
  create-admin.ts          `npm run admin:create`: first owner account
  generate-icons.mjs       `npm run icons`: regenerate PWA icons
src/
  proxy.ts                 Optimistic route guard (no session cookie → /login)
  app/
    (auth)/login/          Login page, form (client) and login server action
    (app)/                 Signed-in area: layout (header/sidebar/bottom nav)
      dashboard/ orders/ accounts/ more/
      actions.ts           Logout server action
    api/health/            Public health + DB check
    api/me/                Current user (example of an authenticated API route)
    manifest.ts            PWA manifest
    icon.svg apple-icon.png
  components/
    ui/                    shadcn/ui components
    layout/                App header, bottom nav, sidebar, logout button
    brand/                 Benuuprint logo
    coming-soon.tsx        Shared "قريبًا" state
  lib/
    env.ts                 Environment validation (Zod)
    db/prisma.ts           The single Prisma client + transaction types
    auth/                  Password hashing, session tokens/cookies, permissions,
                           current-user helpers (requireUser / requirePermission / requireApiUser)
    api/handler.ts         Uniform JSON responses and error handling for API routes
    validations/           Zod schemas with Arabic messages
    errors.ts              AppError (safe Arabic message + HTTP status)
    navigation.ts          Navigation + module availability (single source of truth)
  server/
    repositories/          Prisma queries only (accept a db or transaction client)
    services/              Business logic: auth, rate limiting, audit, owner bootstrap
  generated/prisma/        Generated Prisma client (git-ignored, created on npm install)
tests/
  unit/                    Pure logic, proxy, API error handling
  integration/             Real PostgreSQL: login, sessions, rate limits, owner CLI
deploy/Caddyfile.example
ecosystem.config.cjs       PM2 process file
docker-compose.yml         Local PostgreSQL for development
```

**Layering rule:** UI components → server actions / route handlers → `server/services` → `server/repositories` → Prisma. Client components never import database code. Every service and repository takes the database client as its first argument, so later phases can wrap several operations in a single `prisma.$transaction(async (tx) => …)` (orders + payments + audit, for example).

## Requirements

- Node.js **20.19+** (tested with Node 26) and npm
- PostgreSQL **15+**. Locally the easiest option is Docker (`docker compose`). Any local PostgreSQL works.

## Local installation

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then edit if needed
npm run db:up               # start local PostgreSQL in Docker (port 5432)
npm run db:migrate          # apply migrations to the dev database
npm run admin:create        # create the first owner account (interactive)
npm run dev                 # http://localhost:3000
```

> npm 11 may ask you to approve install scripts for `prisma`, `@prisma/engines` and `esbuild`. These are already listed under `allowScripts` in `package.json`.

### PostgreSQL without Docker

Create a user and a database, then set `DATABASE_URL` in `.env`:

```sql
CREATE USER benuuprint WITH PASSWORD 'choose-a-password';
CREATE DATABASE benuuprint OWNER benuuprint;
CREATE DATABASE benuuprint_test OWNER benuuprint;   -- optional, for integration tests
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes (at runtime) | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for integration tests | A **separate, disposable** database. Tests wipe it. |
| `SESSION_COOKIE_SECURE` | no | Defaults to `true` in production. Set `false` only to try a production build over plain http on your own machine. |

Environment variables are validated on first use (`src/lib/env.ts`). `next build` does not need a database. No session secret is needed: sessions are random tokens stored (hashed) in PostgreSQL. **Never commit `.env`.** Only `.env.example` is tracked.

## Customers & orders (Phase 2)

| Screen | Route |
| --- | --- |
| All orders: search, status filter (incl. overdue), sort, pages; cards on phones, table on desktop | `/orders` |
| New order: one form with five sections, inline new customer, optional work groups | `/orders/new` |
| Order details: money, groups, dates, payment history, edit | `/orders/[id]` |
| Record a payment | `/orders/[id]/payments/new` |
| Edit order | `/orders/[id]/edit` |
| Customers: search, add, details with totals and orders, edit | `/customers` |

**Business rules (enforced on the server, most also in the database):**

- **Groups.** One order can be split into groups (e.g. 100 DTF / 50 embroidery / 50 DTF + embroidery). The group quantities must add up to the order quantity. A piece with two operations still counts once.
- **Money.** Money is stored as `NUMERIC(12,2)` and calculated as whole piasters (`bigint`), never floats. Arabic-Indic digits (`٤٠٬٠٠٠`) are accepted.
- **Outstanding balance.** It is never stored. It is always the agreed price minus the sum of non-voided payments.
- **Payments.** A payment can't exceed the remaining amount, even when two are recorded at the same moment (the order row is locked). Payments are never deleted or edited: the owner can *void* one with a reason, and it stays visible in the history.
- **Order numbers** (`#0001`) are unique and gapless. They come from a counter row incremented inside the order's transaction.
- **Double-submit protection.** Every order and payment form carries an idempotency key, so a double tap or a retried submit saves once.
- **One transaction.** Saving an order writes the inline new customer, the order, its groups, the advance payment and the audit entries together, or nothing at all.
- **Owner-only actions:** changing the agreed price (never below what was paid), cancelling or re-opening an order (only once its payments are voided), and voiding payments. Staff can create and edit everything else and record payments.
- **Statuses.** Orders use جديد / تحت التنفيذ / ملغي. «مكتمل» exists in the database but can't be set until delivery tracking exists.

## Costs, suppliers & expenses (Phase 3)

| Screen | Route |
| --- | --- |
| Add a cost to an order (category, amount, optional supplier, paid in full / partly / on credit) | `/orders/[id]/costs/new` |
| «تكاليف الأوردر» section: totals, history, pay the rest, owner voids | on `/orders/[id]` |
| Pay (part of) a cost | `/costs/[id]/pay` |
| Suppliers: list with balances, add, details (purchases, payments, what's still owed), edit | `/suppliers` |
| General expenses: this month / last month / date range / category, summary cards | `/expenses` |
| Record an expense / pay an expense | `/expenses/new`, `/expenses/[id]/pay` |
| Money hub (the «الحسابات» tab) | `/accounts` |

**How the money stays straight:**

- **A cost is what something cost.** Order costs and general expenses count the full amount when they're recorded, whether paid or not. A credit purchase raises the order's cost immediately and pays nothing.
- **A payment out is cash that left the business.** Every row in `outgoing_payments` pays exactly one order cost or one general expense; a database CHECK enforces this. A supplier payment is just a payment on one of that supplier's purchases, so it can never count as a new cost.
- **Balances are never stored.** What's still owed, a supplier's balance and the paid / partly paid / unpaid status are always computed as amount minus valid payments.
- **General expenses are never order costs.** They're separate rows, so future overhead allocation can reference them without copying, and so without double counting.
- **Two kinds of totals.** Recorded totals use the cost or expense date. Cash totals use the payment date. For example, last month's rent paid today is this month's cash but last month's expense.
- **Overpayment protection.** The cost or expense row is locked during a payment, so two payments at once can't pay more than is owed.
- **Corrections.** Nothing is edited or deleted. The owner voids with a reason, and a cost or expense can only be voided after its payments are voided, so real cash is never hidden. Everything is audited.
- **Who can do what.** Staff can record costs and expenses, add suppliers and pay what's owed. Only the owner can void (`finance:void`).

## Workers, wages & productivity (Phase 4)

| Screen | Route |
| --- | --- |
| Workers: today's attendance, one-tap «حضر النهارده», what's owed (owner) | `/workers` |
| Add / edit a worker (job, daily wage, daily target and unit) | `/workers/new`, `/workers/[id]/edit` |
| Worker page: «تسجيل يومية», «تسجيل شغل», «دفع فلوس», «سلفة», month summary, daily history | `/workers/[id]` |
| Record attendance / output / payment | `/workers/[id]/workday`, `/workers/[id]/work`, `/workers/[id]/pay` |
| «حساب العمال»: monthly summary (owner) | `/workers/summary?month=YYYY-MM` |
| Labour cost of an order (owner) | on `/orders/[id]` |

**Rules:**

- **One wage per worked day.** A worker earns his daily wage once per worked day, whatever he produced. The wage is copied onto the day (`worker_workdays.wage`), so changing his standard wage later never changes past days. A partial unique index allows only one valid day per worker and date.
- **Output is not production.** Output logs (`worker_work_logs`) measure productivity and split the day's wage across orders. They never change an order's status, produced quantity or delivery; that's Phase 5.
- **How the wage is split** (`src/lib/workers/allocation.ts`; computed, never stored):
  - all logs in the same unit → by quantity (300 EGP: Mahmoud 200 prints → 200, Ahmed 100 → 100);
  - mixed units → by recorded hours (meters are never added to pieces);
  - otherwise → "unallocated labour", still counted and shown.
  
  Shares are whole piasters and always add up exactly to the wage.
- **Productivity** (shown, never used for pay): target achievement = output in the target unit ÷ target (250/300 → 83.33%); actual cost per unit = wage ÷ output (300/250 → 1.20).
- **Payments** are cash out, in `outgoing_payments` (`worker_id` + type):
  - «دفع يومية / مستحقات» can't be more than what's currently owed;
  - «سلفة» is money paid before it's earned.
  
  Balance = earned − paid. Positive means we owe him; negative means an advance not yet earned back. An advance is never a second labour expense.
- **Monthly summary keeps three numbers apart:**
  1. wages earned in the month (by work date);
  2. cash paid in the month (by payment date);
  3. balances at the end of the month.
- **Labour has one source.** The wages on worked days are the only labour cost. They're never re-entered as general expenses or order costs; summaries combine them only at report level.
- **Corrections.** Only the owner can void a day (which also voids its output) or a single output record, always with a reason. Payments use the existing void. Everything is audited, and the worker row is locked for every write.
- **Stable order groups.** Editing an order now updates its groups in place and keeps their IDs. A group with worker records can't be removed or shrunk below the work already logged, and a stale edit screen can't overwrite newer changes (`expectedUpdatedAt`).

**Financial privacy.** STAFF can create orders, record customer payments, add order costs and expenses, record attendance and output, and pick suppliers. Only the OWNER_ADMIN sees money: order cost totals, labour per order, the expense list, supplier balances, wages and balances, and the dashboard money cards. This is enforced in the services and pages; hidden buttons are just convenience.

## Known follow-ups (next phases)

These are deliberate gaps, recorded so they're handled before they can cause wrong numbers:

1. ~~Restrict financial visibility by role~~ — done in Phase 4.
2. ~~Keep order-group IDs stable when editing orders~~ — done in Phase 4.
3. **Never double count labour and overhead.** Labour is now done: wages on worked days are its only source. Payroll should follow the cost pattern: record what's owed, pay it through `outgoing_payments` (extending the "exactly one target" CHECK), and correct by voiding. Overhead allocation should *reference* `general_expenses` rows rather than copy them into order costs. Profit = order price − order costs − allocated overhead − labour, computed from records and never stored.

## Database & migrations

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Development: create/apply migrations (`prisma migrate dev`) |
| `npm run db:deploy` | Production: apply committed migrations (`prisma migrate deploy`) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Browse data in Prisma Studio |
| `npm run db:check` | Read-only check: which database (no password shown), connectivity, pending migrations, tables, owner |
| `npm run db:status` | `prisma migrate status` |
| `npm run db:up` / `db:down` | Start/stop the local Docker PostgreSQL |

Tables:

- **users**: name, email (unique, lowercase), Argon2id `password_hash`, `role` (`OWNER_ADMIN` / `STAFF`), `is_active`, timestamps
- **sessions**: SHA-256 hash of the session token, user, expiry (cascade-deleted with the user)
- **audit_logs**: user, action, entity type/id, JSON metadata, time
- **login_attempts**: failed logins by email and IP, used for rate limiting and pruned after 24h
- **customers**: name (not unique), optional phone and notes, created by
- **orders**: number (unique), customer, title, product, material, quantity and unit, agreed `total_price`, received and delivery dates, notes, status, idempotency key, created by
- **order_groups** / **order_group_operations**: quantity and material per group, plus its operations (DTF / screen print / embroidery; none means plain)
- **order_payments**: amount, date, method (cash / bank transfer / InstaPay / other), advance flag, recorded by, void info (who, when, why), idempotency key
- **counters**: the gapless order-number counter
- **suppliers**: name, optional phone and notes
- **order_costs**: order, category, description, amount, date, optional supplier, void info, idempotency key
- **general_expenses**: category, description, amount, date, void info, idempotency key
- **outgoing_payments**: money paid out against exactly one order cost, one general expense or one worker (wage / advance); amount, date, method, recorded by, void info
- **workers**: name, job, daily wage, daily target and unit, active flag
- **worker_workdays**: one valid row per worker and date; worked or absent, wage snapshot, void info
- **worker_work_logs**: output per workday, optional order and order group, work type, quantity, unit, hours, void info

## Administrator account

```bash
npm run admin:create
```

The command asks for the name, the email and the password twice. Password input is hidden. It **refuses to run if an owner account already exists**, and a database lock prevents two simultaneous runs from creating two owners. Passwords are never accepted as command-line arguments, so they cannot end up in shell history or Git.

For scripted provisioning you can pipe the four answers (one per line) from a temporary file and delete the file afterwards.

## Authentication & security

- Argon2id password hashing (19 MiB memory, 2 passes), with a constant-time path for unknown emails
- Session cookie: random 256-bit token, `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production. Only the token's SHA-256 hash is stored.
- Sessions last 30 days and slide while in use. Deactivating a user (`is_active = false`) ends their sessions on their next request.
- Every page, server action and API route checks the session against the database (`requireUser`, `requirePermission`, `requireApiUser`). `src/proxy.ts` is only a fast first filter.
- Rate limiting is stored in PostgreSQL: 5 failed logins per email or 20 per IP in 15 minutes.
- Audit log entries: successful/failed/blocked/rate-limited logins, logout, user creation.
- Permissions are derived from roles in `src/lib/auth/permissions.ts`. Code checks permissions (`users:manage`), not roles, so finer permissions can be added later without changing the call sites.
- Security headers: HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies.

## Development commands

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Unit tests. Integration tests also run when `TEST_DATABASE_URL` is set; otherwise they are **skipped with a warning**. |
| `npm run check` | typecheck + lint + test |
| `npm run icons` | Regenerate PWA icons from the logo |

## Production build

```bash
npm ci
npm run build
npm run db:deploy
npm start            # listens on 127.0.0.1:3000
```

## VPS deployment (preparation; not deployed yet)

Target: Ubuntu VPS with Node.js 20.19+, PostgreSQL, PM2 and Caddy. Existing apps on the server are not touched. This app uses its own directory, its own database/user, its own PM2 process name (`benuuprint-erp`) and its own Caddy site block.

1. **Database.** Create a dedicated user and database (see SQL above) with a strong password.
2. **Code.** Clone into e.g. `/srv/benuuprint-erp` as a non-root user.
3. **Environment.** Create `/srv/benuuprint-erp/.env` with the production `DATABASE_URL`, then `chmod 600 .env`.
4. **Build.**
   ```bash
   npm ci
   npm run build
   npm run db:deploy
   npm run admin:create      # once
   ```
5. **Run with PM2.**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup               # follow the printed instruction once
   ```
   Use a free port if 3000 is taken: change `-p 3000` in `ecosystem.config.cjs` and in the Caddy block.
6. **HTTPS with Caddy.** Add the block from `deploy/Caddyfile.example` with your domain to `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. The app listens only on `127.0.0.1`, so Caddy is the only public entry point. That is also what makes the client IP used for rate limiting trustworthy.
7. **Check.** `curl https://your-domain/api/health` should return `{"ok":true,"data":{"status":"ok","database":"ok"}}`.

**Updating later:** `git pull && npm ci && npm run build && npm run db:deploy && pm2 reload benuuprint-erp`.

**Backups:** schedule `pg_dump` of the database (e.g. a nightly cron) and copy the dumps off the server.

## Installing the app on phones (PWA)

The app must be served over **HTTPS** (Caddy handles this). It is online-only. There is no service worker and no offline data, so business data is always fresh from the server.

**iPhone (Safari):**
1. Open the app URL in **Safari** and sign in.
2. Tap the **Share** button (square with arrow).
3. Choose **Add to Home Screen** (إضافة إلى الشاشة الرئيسية), then **Add**.
4. Open Benuuprint from the home-screen icon. It runs full-screen without the browser bar.

**Android (Chrome):**
1. Open the app URL in **Chrome** and sign in.
2. Tap the **⋮** menu, then **Install app** (تثبيت التطبيق) or **Add to Home screen**.
3. Confirm. The Benuuprint icon appears in the app drawer and on the home screen.

If the install option is missing, make sure the address uses `https://` and reload the page once.
