# Backup & restore — Benuuprint ERP

A backup only counts once it has been **restored and checked**. This document
covers:
- the daily encrypted backup;
- the off-server copy;
- failure alerts;
- the restore drill;
- real recovery.

Scripts: `deploy/backup.sh`, `deploy/restore-drill.sh`,
`deploy/backup-status.sh`. Units: `deploy/benuuprint-backup.service` and
`.timer`.

## 1. What happens every night (03:15 server time)

`benuuprint-backup.timer` runs `deploy/backup.sh` as the `benuuprint` user.
The script:

1. **Dumps the data.** `pg_dump --format=custom` takes a consistent snapshot of
   the whole database, including `_prisma_migrations`. It is written to a
   private temporary file (umask 077).
2. **Verifies the archive.** `pg_restore --list` must read it, and it must
   contain data sections for `_prisma_migrations`, `users`, `orders`,
   `order_payments` and `outgoing_payments`. Otherwise the run fails.
3. **Encrypts it.** It uses `openssl cms` (AES-256) to the owner's **public**
   certificate, `BACKUP_RECIPIENT_CERT`. The server cannot decrypt its own
   backups, so a stolen server or backup copy reveals nothing. The script
   refuses to write an unencrypted backup unless explicitly told to (tests
   only).
4. **Stores it.** It writes `benuuprint-<UTC time>.dump.cms` plus a `.sha256`
   file (both mode 0600) in `/var/backups/benuuprint` (mode 0700), and updates
   `last-success`.
5. **Prunes.** It deletes local backups older than `BACKUP_KEEP_DAYS`
   (default 14). Only `benuuprint-*.dump*` files in that directory are touched.
6. **Copies off-server.** If `BACKUP_RCLONE_REMOTE` is set, it runs
   `rclone copy` of both files.
7. **Alerts.** If `BACKUP_HEALTHCHECK_URL` is set, it pings that URL on success
   and `<url>/fail` on any failure.

Any failure makes the unit fail; check it with
`systemctl status benuuprint-backup`. `deploy.sh` also takes a backup before
every deploy and aborts if that backup fails.

## 2. Create the backup key (owner's computer, once)

```bash
openssl req -x509 -newkey rsa:4096 -days 36500 -subj "/CN=benuuprint-backup" \
  -keyout benuuprint-backup-key.pem -out backup-cert.pem      # asks for a passphrase
```

- `backup-cert.pem` (public) goes to `/etc/benuuprint/backup-cert.pem` on the
  server.
- `benuuprint-backup-key.pem` and its passphrase **never** go on the server.
  Keep the key in the password manager and one offline copy (USB stick kept
  elsewhere).
- **Losing the key means losing every backup.**

## 3. Off-server copy

Configure one rclone remote, as the `benuuprint` user, pointing at storage the
owner controls (another server over SFTP, a cloud drive, an S3-compatible
bucket):

```bash
sudo -u benuuprint rclone config
```

Then set `BACKUP_RCLONE_REMOTE="name:benuuprint-backups"` in
`/etc/benuuprint/backup.env`.

- Files are already encrypted, so the storage provider cannot read them.
- Retention there is managed by the provider or by hand. Keep at least 30 days
  plus one backup per month.

## 4. Failure detection

- **Dead-man's switch** (recommended, free tier is enough):
  - create a check that expects one ping per day with a grace period of a few
    hours;
  - put its URL in `BACKUP_HEALTHCHECK_URL`.
  - You are alerted when a backup fails (`/fail`) **or** when none runs at all.
- **On the server:**
  ```bash
  sudo -u benuuprint /opt/benuuprint/current/deploy/backup-status.sh
  ```
  It exits 1 when there is no successful backup in the last 26 hours, and says
  why.
- **History:**
  ```bash
  journalctl -u benuuprint-backup --since "7 days ago"
  systemctl list-timers benuuprint-backup.timer
  ```

## 5. Restore drill (monthly, and after the first backup)

The drill proves a real backup restores and is complete. It never touches the
live database: it restores into a new scratch database
`benuuprint_restore_<time>`, checks it, then drops it.

```bash
# on the owner's computer: copy the private key up temporarily
scp benuuprint-backup-key.pem <server>:/tmp/k.pem
# on the server: a private working directory the postgres user can read
D=$(sudo -u postgres mktemp -d)
B=$(sudo -u benuuprint sh -c 'ls -1t /var/backups/benuuprint/benuuprint-*.dump.cms | head -1')   # dir is 0700
sudo cp -r /opt/benuuprint/current/deploy /opt/benuuprint/current/prisma/migrations "$B" "$B.sha256" "$D"/
sudo mv /tmp/k.pem "$D"/k.pem
sudo chown -R postgres "$D" && sudo chmod 600 "$D"/k.pem
sudo -u postgres env BACKUP_PRIVATE_KEY="$D/k.pem" MIGRATIONS_DIR="$D/migrations" \
  "$D/deploy/restore-drill.sh" "$D/$(basename "$B")"
sudo shred -u "$D"/k.pem && sudo rm -rf "$D"
```

The drill:
1. Verifies the SHA-256 checksum, so a corrupt or altered file is refused.
2. Decrypts with the private key.
3. Restores with `--exit-on-error`.
4. Checks that every migration in the repository is applied.
5. Prints row counts for 17 business tables, and the totals of valid customer
   payments and valid outgoing payments.

Add `COMPARE_DATABASE_URL` (read-only use) to compare row counts with the live
database. Live can only have grown since the backup. The last line must read
`RESTORE DRILL PASSED`.

**Validated on 2026-11-15** against an isolated QA database (never the
development database):
- an encrypted backup restored with all 17 tables' row counts equal to live;
- payments 20000.00 / outgoing 16500.00 equal to live;
- a 1-byte tampering was rejected (checksum mismatch);
- a wrong key was rejected;
- a missing database made the backup exit 1 and send the `/fail` ping;
- the unencrypted mode was refused;
- retention removed only a backup older than the limit;
- `backup-status.sh` reported both "stale" and "no backup";
- no scratch database was left behind.

## 6. Disaster recovery

| Situation | Action |
| --- | --- |
| A wrong record | Do **not** restore. Use the app's void/correction features (they keep the audit trail). |
| Database damaged or destroyed, server fine | Restore the latest backup into the production database (below). |
| Server lost | Build a new VPS with the runbook (steps 1–7, skipping `admin:create`), then restore the latest **off-server** backup (below). |

To restore into production (data since the backup is lost, so agree on it with
the owner first):

```bash
sudo systemctl stop benuuprint
sudo -u postgres pg_dump --format=custom benuuprint > /var/backups/benuuprint/before-restore-$(date -u +%Y%m%dT%H%M%SZ).dump   # safety copy, if the DB still exists
openssl cms -decrypt -binary -inform DER -in <backup>.dump.cms -inkey benuuprint-backup-key.pem -out /tmp/restore.dump
sudo -u postgres dropdb benuuprint            # only after the safety copy above
sudo -u postgres createdb --owner=benuuprint_app benuuprint
sudo -u postgres pg_restore --dbname=benuuprint --role=benuuprint_app --no-owner --exit-on-error /tmp/restore.dump
sudo shred -u /tmp/restore.dump
cd /opt/benuuprint/current && sudo -u benuuprint bash -c 'set -a; . /etc/benuuprint/benuuprint.env; set +a; npx prisma migrate status'
sudo systemctl start benuuprint && curl -fsS http://127.0.0.1:$PORT/api/health
```

Then sign in as the owner and compare the dashboard and «الحسابات» figures with
the drill output.

Users' sessions are in the restored data:
- sessions created after the backup are gone, so those users sign in again;
- to force everyone to sign in again, run `npm run users -- revoke-sessions`
  for each account.

## 7. Never

- Test a restore against the live or the development database.
- Put the private backup key on the server permanently.
- Assume a backup is good because a file exists. Run the drill.
