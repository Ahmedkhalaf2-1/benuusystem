# Deployment runbook — Benuuprint ERP

How to set up the VPS once, then deploy, roll back and operate the app. Every
command runs on the VPS over SSH as a sudo user unless noted.

- Paths used throughout: `/opt/benuuprint` (code), `/etc/benuuprint` (secrets),
  `/var/backups/benuuprint` (backups).
- Background: [production-readiness.md](production-readiness.md).
- Backups: [backup-restore.md](backup-restore.md).

> The server may already host other projects. Do not edit their files, units,
> databases or Caddy blocks. Everything below creates **new**, Benuuprint-only
> resources.

## 0. Prerequisites

- Ubuntu 22.04 or 24.04, at least 1 vCPU and 2 GB RAM, about 5 GB free disk.
- A hostname whose DNS `A` record points at the VPS
  (see production-readiness.md §6). Ports 80 and 443 must be open.
- The backup certificate (`backup-cert.pem`) from the owner's computer
  (backup-restore.md §2).
- Read access to the GitHub repository from the server. For a private
  repository, use a read-only deploy key.

## 1. Look before you change anything

```bash
systemctl list-units --type=service --state=running | grep -vE 'systemd|dbus|ssh|cron'
sudo ss -ltnp                                  # ports in use; pick a free PORT for Benuuprint
ls /etc/caddy/ 2>/dev/null; sudo cat /etc/caddy/Caddyfile 2>/dev/null
which nginx apache2 2>/dev/null                # another web server already owns 80/443?
psql --version 2>/dev/null; node --version 2>/dev/null
```

What to do with the results:
- **Another web server already owns ports 80/443** (nginx, Apache):
  - do **not** install Caddy on top of it;
  - add a site to that server instead, as a reverse proxy to `127.0.0.1:$PORT`;
  - stop and decide with the owner before continuing.
- **PostgreSQL is already installed:** reuse it, but with a new role and a new
  database (step 4).

## 2. Packages (only what is missing)

**Node.js 26 LTS.** Use NodeSource, or the method the server already uses for
other Node apps. If another app needs a different Node version, install
Benuuprint's Node separately (e.g. under `/opt/benuuprint/node`) and point
`ExecStart` in the systemd unit at that binary.

```bash
curl -fsSL https://deb.nodesource.com/setup_26.x -o /tmp/nodesource.sh   # read it before running
sudo bash /tmp/nodesource.sh && sudo apt-get install -y nodejs
```

**PostgreSQL 17**, if absent. Use the PGDG repository: see postgresql.org →
Download → Ubuntu.

```bash
sudo apt-get install -y postgresql-17
```

**Caddy**, if absent and nothing else owns 80/443. Use the official apt
repository: see caddyserver.com → Install → Debian/Ubuntu.

**Tools for backups and deploys:**

```bash
sudo apt-get install -y git curl openssl rclone
```

## 3. System user and directories

```bash
sudo adduser --system --group --home /opt/benuuprint --shell /usr/sbin/nologin benuuprint
sudo install -d -o benuuprint -g benuuprint -m 0750 /opt/benuuprint/releases
sudo install -d -o root -g benuuprint -m 0750 /etc/benuuprint
sudo install -d -o benuuprint -g benuuprint -m 0700 /var/backups/benuuprint
sudo -u benuuprint git clone https://github.com/Ahmedkhalaf2-1/benuusystem.git /opt/benuuprint/source
```

## 4. Production database (new role, new password)

Run each command on its own line. When `createuser` prompts for the password,
paste a newly generated one; it is never typed on a command line.

```bash
openssl rand -hex 32                     # copy this; it is the new DB password
sudo -u postgres createuser --pwprompt --no-createdb --no-createrole --no-superuser benuuprint_app
sudo -u postgres createdb --owner=benuuprint_app benuuprint
sudo -u postgres psql -c "REVOKE ALL ON DATABASE benuuprint FROM PUBLIC;"
```

- Never reuse the development password `change-me-local-dev`. The app refuses
  to start with it.
- Keep PostgreSQL listening on localhost only. This is the Ubuntu default:
  `listen_addresses = 'localhost'`.

## 5. Secrets

```bash
sudo install -o root -g benuuprint -m 0640 /dev/null /etc/benuuprint/benuuprint.env
sudo install -o root -g benuuprint -m 0640 /dev/null /etc/benuuprint/backup.env
sudo editor /etc/benuuprint/benuuprint.env   # contents from deploy/benuuprint.env.example
sudo editor /etc/benuuprint/backup.env       # contents from deploy/backup.env.example
sudo install -o root -g benuuprint -m 0644 backup-cert.pem /etc/benuuprint/backup-cert.pem
```

`benuuprint.env` needs:
- `DATABASE_URL="postgresql://benuuprint_app:<hex>@127.0.0.1:5432/benuuprint?schema=public"`
- `PORT=<free port>`

Do not put a `.env` file anywhere under `/opt/benuuprint`.

## 6. Units and Caddy

```bash
cd /opt/benuuprint/source
sudo cp deploy/benuuprint.service deploy/benuuprint-backup.service deploy/benuuprint-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Caddy: append the block from `deploy/Caddyfile.example` to
`/etc/caddy/Caddyfile`. Replace the hostname and the port (same as `PORT`).
Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

`reload`, not `restart`, keeps other sites up.

## 7. First deploy

```bash
sudo /opt/benuuprint/source/deploy/deploy.sh main      # or a tag, e.g. v1.0.0
sudo systemctl enable benuuprint.service               # start on boot
```

The script:
1. fetches the ref;
2. unpacks it into `/opt/benuuprint/releases/<commit>`;
3. runs `npm ci` and `npm run build`;
4. runs `prisma migrate deploy`;
5. points `/opt/benuuprint/current` at the release;
6. starts the service and waits for `/api/health`.

Then create the accounts. Each command prompts, and passwords are hidden:

```bash
cd /opt/benuuprint/current
sudo -u benuuprint bash -c 'set -a; . /etc/benuuprint/benuuprint.env; set +a; npm run admin:create'
sudo -u benuuprint bash -c 'set -a; . /etc/benuuprint/benuuprint.env; set +a; npm run users -- create-staff'
```

Turn on backups and prove one restores:

```bash
sudo systemctl enable --now benuuprint-backup.timer
sudo systemctl start benuuprint-backup.service && journalctl -u benuuprint-backup -n 20 --no-pager
```

Then run the restore drill (backup-restore.md §5). **Do not give users the URL
before a restore drill has passed.**

## 8. Checks after every deploy

```bash
systemctl status benuuprint --no-pager
curl -fsS http://127.0.0.1:$PORT/api/health                 # {"ok":true,"data":{"status":"ok","database":"ok"}}
curl -fsSI https://<host>/login | grep -iE 'strict-transport|content-security|x-frame'
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/reports/overview   # 401 (signed out)
journalctl -u benuuprint -n 50 --no-pager                   # "[startup] configuration ok", no errors
```

In a browser:
- sign in as the owner;
- sign in as staff and check that «الحسابات» shows no figures;
- review every staff account in «المستخدمين والصلاحيات» and share the orders staff should see (Phase 10 makes all existing orders private);
- on a phone, check «إضافة إلى الشاشة الرئيسية» (add to home screen).

## 9. Later deploys

```bash
sudo /opt/benuuprint/current/deploy/deploy.sh main
```

The old version serves while the new one builds. Downtime is only the stop,
migrate and start steps (seconds). The script takes a backup first and aborts
if the backup fails.

Deploy outside working hours: open tabs from the old build may show the error
screen once and need a reload.

## 10. Rollback

**The app is unhealthy after a deploy.** `deploy.sh` switches back to the
previous release by itself.

**Roll back manually** (e.g. a bug found later):

```bash
ls -1t /opt/benuuprint/releases/            # newest first
sudo ln -sfn /opt/benuuprint/releases/<previous> /opt/benuuprint/current.next \
  && sudo mv -T /opt/benuuprint/current.next /opt/benuuprint/current \
  && sudo systemctl restart benuuprint
```

**Migrations are not rolled back automatically.**
- All migrations so far only add tables and columns, so the previous release
  runs fine on the newer schema.
- If a future migration changes or removes data, restore the pre-deploy backup
  (taken by `deploy.sh`) into the production database, following
  backup-restore.md §6.
- That loses any changes made since the deploy, so decide with the owner first.

## 11. Common failures

| Symptom | Cause / fix |
| --- | --- |
| `systemctl status` shows `failed`; journal says `Refusing to start: invalid production configuration` | Fix the named variable in `/etc/benuuprint/benuuprint.env`, then `sudo systemctl reset-failed benuuprint && sudo systemctl start benuuprint`. |
| Unit fails immediately, `Invalid port` | `PORT` is missing from the environment file. |
| `/api/health` returns 503 | PostgreSQL is down or the password is wrong: `systemctl status postgresql`, `journalctl -u benuuprint`. |
| Browser shows a Caddy/TLS error | The DNS `A` record does not point at the VPS, or port 80/443 is blocked (needed for the certificate): `journalctl -u caddy`. |
| Sign-in "works" but you land back on /login | The site is being opened over http, or through a hostname other than the Caddy one. Secure cookies need the HTTPS hostname. |
| "محاولات دخول كثيرة" (too many sign-in attempts) for a real user | 5 wrong passwords in 15 minutes. Wait, or `npm run users -- reset-password <email>` (clears the lock). |
| Migration failed during deploy | The previous release was restarted on the unchanged database. Read the error in the deploy output; never use `migrate reset`/`db push`. |
| Lost phone / suspected leaked password | `npm run users -- revoke-sessions <email>`, then `reset-password <email>` (same `sudo -u benuuprint …` wrapper as §7). |
| Disk full | `df -h`; old releases (the script keeps 3) and `/var/backups/benuuprint` (14 days) are the main users. |

## 12. Security precautions

- **Exposure:** only Caddy listens publicly. The app listens on `127.0.0.1`;
  PostgreSQL listens on localhost.
- **Secrets:** they live only in `/etc/benuuprint` (root:benuuprint, 0640).
  Never in git, a release directory, shell history or a chat.
- **Accounts:** account changes happen only on the server shell
  (`npm run users`). There is no web admin endpoint.
- **Backups:** encrypted to a certificate whose private key is not on the
  server.
- **Updates:** keep Ubuntu, Node 26 LTS, PostgreSQL 17 and Caddy patched. Run
  `npm audit` before each deploy and read new advisories.
- **Never:**
  - set `SESSION_COOKIE_SECURE=false` on the server;
  - expose port `$PORT` or 5432 in the firewall;
  - run `prisma migrate reset`, `migrate dev` or `db push` against production.
