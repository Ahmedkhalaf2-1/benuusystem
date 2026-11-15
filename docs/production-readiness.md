# Production readiness — Benuuprint ERP (Phase 7A)

Status on 2026-11-15, branch `feature/premium-ui-order-sizes`. The application
has **not** been deployed. This document records the security audit, the
production architecture and what must happen before go-live (Phase 7B).

Related: [deployment-runbook.md](deployment-runbook.md) ·
[backup-restore.md](backup-restore.md) · [financial-model.md](financial-model.md)

## 1. Verdict

No Critical or High issue remains open in the code. Go-live still depends on
the operational prerequisites in §9: a stable HTTPS hostname, a fresh
production database password, the backup key pair, and an off-server copy.

## 2. Security audit

Reviewed in the code (not assumed):
- authentication, sessions and the cookie path;
- the proxy;
- every route handler (6) and every server action (21);
- every service's permission checks;
- raw SQL;
- HTML rendering;
- error handling and logging;
- headers;
- the PWA files;
- dependencies.

The results were then verified against a running production build (§8).

### Findings and what was done

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| H1 | High | No way to manage accounts in production. Staff accounts could not be created, a forgotten or leaked password could not be reset, and a lost phone's session could not be revoked. The only tool was the one-time owner bootstrap. | **Fixed.** `npm run users -- …` (`scripts/manage-users.ts`, `src/server/services/user-admin-service.ts`): create staff, reset password, deactivate/activate, revoke sessions. Every weakening change deletes that user's sessions in the same transaction and is audited. The last active owner cannot be deactivated. Shell-only: there is no web endpoint for it. 7 integration tests. |
| H2 | High | No real backup procedure (a one-line "schedule pg_dump" note). Backups were not encrypted, verified, kept off-server or restore-tested, and failures raised no alert. | **Fixed.** `deploy/backup.sh` with the systemd timer, `deploy/restore-drill.sh` and `deploy/backup-status.sh`. See [backup-restore.md](backup-restore.md). |
| M1 | Medium | A production server started with a missing or invalid `DATABASE_URL`, the local development password, or a test database. It then served 500s while looking "running" to the supervisor. | **Fixed.** `src/instrumentation.ts` checks the configuration at boot and exits with code 1, naming the variable but never its value. 8 unit tests; verified against `next start`. |
| M2 | Medium | Per-email login limit (5 failures in 15 minutes): anyone who knows the owner's email can lock that login for 15 minutes. | **Accepted.** This is the cost of brute-force protection. The per-IP limit (20 per 15 minutes) still applies. `npm run users -- reset-password` clears the lock at once. |
| M3 | Medium | Sessions last 30 days and slide forward with use; there is no idle timeout. A stolen, unlocked phone stays signed in. | **Accepted for a small team.** Response: `npm run users -- revoke-sessions <email>` (or `deactivate`) on the server. |
| L1 | Low | No `script-src` in the Content-Security-Policy, because Next.js and the theme script use inline scripts. | **Partly fixed.** Added `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` and `Cross-Origin-Opener-Policy: same-origin`. XSS surface is small: React escapes all output, and the only `dangerouslySetInnerHTML` is a static constant (the theme script). A nonce-based `script-src` is possible later. |
| L2 | Low | `npm audit`: 6 advisories (2 low, 4 moderate), all in the `shadcn` package's own CLI dependencies (`ts-morph` → `minimatch`, `deepmerge`). | **Accepted.** The app only imports `shadcn/tailwind.css` at build time; the vulnerable code is never run by the server. The suggested fix is a breaking downgrade. Re-check on each dependency update. |
| L3 | Low | After a deploy, an already-open tab calling a server action from the old build shows the error screen. | **Accepted.** Reloading fixes it. There is no service worker and asset names are content-hashed, so nobody is stuck on an old UI. Deploy outside working hours. |
| L4 | Low | Unexpected errors are logged with their full error object to the system journal. For a programming error that can include record values. | **Accepted.** journald is readable only by root/adm. No request bodies, cookies, passwords or report data are logged intentionally. |
| L5 | Low | The client IP used for rate limiting is the right-most `X-Forwarded-For` entry. It is only trustworthy behind Caddy. | **By design.** The app binds to 127.0.0.1 only and Caddy replaces client-supplied forwarding headers. Do not add another proxy without revisiting `src/lib/auth/request-context.ts`. |

### Verified secure (no change needed)

- **Passwords:**
  - Argon2id (19 MiB, t=2).
  - A dummy hash for unknown emails, so timing reveals nothing.
  - The password is never accepted as a CLI argument.
- **Sessions:**
  - 256-bit random token; only its SHA-256 is stored.
  - A new token on every login, so session fixation is impossible.
  - Logout deletes the database session.
  - Expired or deactivated sessions are deleted on sight.
  - The user and role are re-read from the database on every request, so role changes apply immediately.
  - Concurrent sessions are allowed (phone + desktop), each revocable.
- **Cookies:**
  - `HttpOnly`, `SameSite=Lax`, `Path=/`.
  - In production `Secure` with the `__Host-` prefix (`SESSION_COOKIE_SECURE` defaults to true).
  - Over plain http, login cannot work by design.
- **CSRF:**
  - Server actions only accept same-origin requests (Next.js Origin/Host check); a cross-origin action POST was rejected in the smoke test.
  - Plus SameSite=Lax and `form-action 'self'`.
  - API routes are GET-only, read-only lookups.
- **Authorization:**
  - Every route handler calls `requireApiUser(permission)`.
  - Every server action calls `requireUser()`, and every service asserts the specific permission again.
  - The proxy is only a fast first filter.
- **Financial privacy:**
  - All 8 report APIs and the 7 report pages require `finance:view-summary` (plus `workers:view-pay`, `costs:view` and `labor:view` where relevant) in both route and service.
  - Staff got 403 with no figures on every report API, and a redirect to `/no-access` on every report page.
  - Staff keep orders, payments, costs, expenses, attendance and production.
- **Object references:** IDs are UUIDs. Every record lookup goes through a permission-checked service. Data is company-wide (no tenants), so permissions, not ownership, are the boundary.
- **Input and SQL:**
  - Zod validation at every boundary.
  - Prisma queries are parameterized; all 15 raw queries are tagged templates (parameterized); none use `$queryRawUnsafe`.
  - Search input is bounded.
  - No file uploads exist.
- **Errors:**
  - Clients get generic Arabic messages and a code, never stacks or SQL.
  - `poweredByHeader` is off.
- **Headers:**
  - HSTS (1 year), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP (above), COOP.
  - APIs send `Cache-Control: no-store`.
  - Authenticated pages are `private, no-store`.

## 3. Authentication behind Caddy

- Caddy terminates TLS and forwards to `127.0.0.1:$PORT`. The app is never reachable directly from the internet.
- Next.js sees the original `Host`, so the server-action origin check works unchanged.
- Cookies are `Secure`/`__Host-`; the browser sends them only over HTTPS to the exact host.
- The rate limit uses the client address Caddy sets (§2, L5).

## 4. Database readiness

- **Migrations:** 6 migrations, in order. The schema has no drift from them: `prisma migrate diff` is clean and `migrate status` reports up to date.
  - `prisma migrate deploy` was tested on a fresh database owned by a non-superuser role: all 6 applied.
  - Production uses only `npm run db:deploy` (`prisma migrate deploy`), which never resets data or generates migrations.
  - Never run `migrate dev`, `migrate reset` or `db push` against production.
- **Precision:** all money is `numeric(12,2)`, handled in code as integer piasters (`src/lib/money.ts`). There is no floating point.
- **Constraints:** unique and index declarations (64), foreign keys, and 38 CHECK constraints in the migrations.
  - Idempotency keys stop double-submitted payments.
- **Concurrency:** these writes take a row lock (`SELECT … FOR UPDATE`) inside a transaction:
  - payments against an order;
  - paying a cost or expense;
  - worker pay.
  - Owner bootstrap uses an advisory lock.
- **Connections:** one Prisma client per process with the `pg` pool (default 10 connections). One app process means at most about 10 connections.
- **Production database:** a separate PostgreSQL 17 role and database (`benuuprint_app` / `benuuprint`) with a newly generated password.
  - The app refuses the development password.
  - Set-up commands are in the runbook.

## 5. Deployment architecture

```
Internet ──443──▶ Caddy (TLS, HTTP→HTTPS, gzip/zstd, 2 MB body limit)
                    │ reverse_proxy 127.0.0.1:$PORT
                    ▼
           systemd: benuuprint.service  (user benuuprint, hardened sandbox)
           node next start -H 127.0.0.1 -p $PORT   (/opt/benuuprint/current)
                    │ DATABASE_URL (127.0.0.1:5432, scram-sha-256)
                    ▼
           PostgreSQL 17: role benuuprint_app, database benuuprint
                    ▲
           systemd timer 03:15 → benuuprint-backup.service → /var/backups/benuuprint (encrypted) → rclone off-server
```

- **Supervisor: systemd.** Not PM2, which this repository previously planned, and not Docker.
  - systemd is already on every Ubuntu server and starts on boot without extra tools.
  - It restarts on failure with backoff, sends logs to `journalctl`, and reads secrets from a root-owned file.
  - It sandboxes the process (`ProtectSystem=strict`, `NoNewPrivileges`, private /tmp) so it is isolated from other projects.
  - Docker would add a second network and port layer for a single Node process. The PM2 file (`ecosystem.config.cjs`) was removed so there is one supervisor.
- **Node.js 26 LTS:** every test and build ran on Node 26.10. `package.json` engines `>=20.19`; Node 24 LTS also qualifies.
- **Releases:**
  - `/opt/benuuprint/releases/<commit>` is built while the old version keeps serving.
  - `current` is a symlink to the live release.
  - Rollback switches the symlink back (`deploy/deploy.sh` does this automatically if the new release fails its health check).
- **Health:**
  - `GET /api/health` returns 200 `{"status":"ok","database":"ok"}`, or 503 if PostgreSQL is unreachable.
  - It is public, no-store, and reveals nothing else.
- **Startup:** an invalid configuration exits with code 1. systemd retries 5 times in 2 minutes, then marks the unit failed (visible in `systemctl status`).
- **Shutdown:** SIGTERM, Next.js finishes in-flight requests, 30 s limit.
- **Resources:** about 150–300 MB RAM in normal use; the unit caps memory at 900 MB. A 1 vCPU / 2 GB VPS is enough (the build needs about 1.5 GB).
- **Logs:** `journalctl -u benuuprint`; Caddy access log at `/var/log/caddy/benuuprint.access.log`, rotated.
- **Error monitoring:** journald plus the health endpoint.
  - Recommended free option: an external uptime monitor polling `https://<host>/api/health`, plus the backup dead-man's switch.
  - No paid service is required.

## 6. Domain and HTTPS options

The app needs a stable HTTPS hostname for normal use. Secure cookies, the
installable PWA and the browser's service features all require a secure
origin. Plain `http://<IP>` will not let anyone sign in, by design. Do not
weaken cookies to make it work.

| Option | How | Notes |
| --- | --- | --- |
| **Custom domain** (recommended for go-live) | Buy a domain, add an `A` record (e.g. `erp.<domain>`) to the VPS IP, put the hostname in the Caddy block. | Stable and professional; Caddy obtains and renews Let's Encrypt certificates automatically. |
| **Free dynamic-DNS subdomain** | A free subdomain from a dynamic-DNS provider (e.g. DuckDNS, deSEC), pointed at the VPS IP. | Valid certificates through Caddy. Fine for go-live if the owner accepts the provider's name in the URL. Moving to a custom domain later means users re-install the PWA and sign in again (new origin). |
| **Temporary IP-based testing** | Use a wildcard IP DNS service hostname (e.g. `<ip-with-dashes>.sslip.io`) in the Caddy block. | For a short test only. These shared domains can hit certificate rate limits, and the hostname changes if the IP does. |
| Plain `http://IP` | — | Not supported: Secure cookies are never sent over http. |

The hostname is not chosen or purchased yet; it is a Phase 7B prerequisite.

## 7. Environment variables

These are the only variables the code reads. Templates (no secrets):
`deploy/benuuprint.env.example` and `deploy/backup.env.example`.

| Variable | Where | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `/etc/benuuprint/benuuprint.env` | yes | Dedicated role/database, new password (`openssl rand -hex 32`). Refused at startup if missing, malformed, the dev password or a `*_test` database. |
| `PORT` | same | yes | Local port; must match the Caddy block. |
| `NODE_ENV` | systemd unit | yes | `production` (set by the unit). |
| `SESSION_COOKIE_SECURE` | — | no | Leave unset (true in production). `false` only for a local http test of a production build; a warning is logged at startup. |
| `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_RECIPIENT_CERT`, `BACKUP_RCLONE_REMOTE`, `BACKUP_HEALTHCHECK_URL` | `/etc/benuuprint/backup.env` | cert required | Read only by `deploy/backup.sh`. |
| `TEST_DATABASE_URL` | developer `.env` only | — | Never on the server. |

No session or signing secret is needed: sessions are random tokens stored
hashed in PostgreSQL. `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is not needed with
a single process. Development (`.env`, Docker password) and production
(`/etc/benuuprint/*.env`, generated password) never share a file or a password.
The deploy script refuses a release that contains a `.env`.

## 8. PWA readiness

- **Manifest** (`src/app/manifest.ts`):
  - name, short name, `display: standalone`, `start_url`, RTL Arabic.
  - `theme_color` #171A20, `background_color` #F6F8FB.
  - Icons: 192, 512 and maskable 512 from the approved logo.
  - Verified reachable without signing in.
- **Apple:** `apple-icon.png` (180 px); the favicon is `icon.png`.
- **Themes:**
  - Light/Dark/System is applied before first paint.
  - The browser `theme-color` follows the theme.
- **Installation:** needs the HTTPS hostname (§6). Phone steps are in the README.
- **Caching:**
  - Online-only, with no service worker, so nothing is stored offline and there are no offline operations.
  - Authenticated pages and all APIs are `no-store`/`private`, so shared caches and proxies never keep business or financial data.
  - Static assets are content-hashed, so a new deploy is picked up on the next page load.

## 9. Before Phase 7B (exact prerequisites)

1. **Hostname:**
   - choose a custom domain or a free subdomain;
   - create the DNS `A` record to the VPS IP;
   - confirm ports 80 and 443 reach the VPS.
2. **VPS access:**
   - SSH as a sudo user;
   - list what already runs there (`systemctl list-units --type=service`, `sudo ss -ltnp`, the Caddy/nginx config) so Benuuprint uses a free port and its own site block.
3. **Backup key:** generate the backup key pair on the owner's computer, store the private key in the password manager plus one offline copy, and bring only the certificate to the server.
4. **Off-server storage:**
   - choose the off-server backup target (e.g. an rclone remote the owner controls);
   - optionally create a free dead-man's-switch check.
5. **Code:** approve and push the Phase 7A commits; decide which ref to deploy (merge to `main` or a tag).
6. **Owner account:**
   - have the owner's name and email ready for `npm run admin:create`;
   - have the staff list ready for `npm run users -- create-staff`.
7. **Restore drill:** run one restore drill on the server after the first backup (see backup-restore.md).
