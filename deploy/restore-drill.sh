#!/usr/bin/env bash
# Benuuprint ERP — prove a backup restores.
#
#   deploy/restore-drill.sh <backup file (.dump or .dump.cms)>
#
# Restores the backup into a NEW scratch database (benuuprint_restore_<ts>),
# checks it, prints row counts, then drops ONLY that scratch database.
# It never writes to the live database.
#
# Admin connection (needs CREATEDB): standard libpq variables, e.g. on the VPS
#   sudo -u postgres env BACKUP_PRIVATE_KEY=… deploy/restore-drill.sh FILE
# (peer authentication over the Unix socket; no password needed).
#
# Encrypted backups need BACKUP_PRIVATE_KEY (path to the owner's private key,
# copied temporarily — delete it afterwards). Optional:
#   COMPARE_DATABASE_URL  live database to compare row counts with (read-only)
#   KEEP_RESTORED=true    keep the scratch database for inspection
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib-pg.sh
. "$HERE/lib-pg.sh"

FILE="${1:?usage: restore-drill.sh <backup file>}"
[ -r "$FILE" ] || { echo "cannot read $FILE" >&2; exit 1; }
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$HERE/../prisma/migrations}"

WORK="$(mktemp -d)"
SCRATCH="benuuprint_restore_$(date -u +%Y%m%d%H%M%S)"
CREATED=false
cleanup() {
  rm -rf -- "$WORK"
  if $CREATED && [ "${KEEP_RESTORED:-false}" != "true" ]; then
    case "$SCRATCH" in
      benuuprint_restore_[0-9]*) pgx dropdb --if-exists "$SCRATCH" && log "dropped scratch database $SCRATCH" ;;
    esac
  fi
}
trap cleanup EXIT

# 1. Checksum (when the .sha256 file is next to the backup).
if [ -r "$FILE.sha256" ]; then
  [ "$(sha256_of "$FILE")" = "$(cut -d' ' -f1 "$FILE.sha256")" ] || { echo "CHECKSUM MISMATCH: $FILE is corrupt or altered" >&2; exit 1; }
  log "checksum ok"
else
  log "warning: no $FILE.sha256 next to the backup; skipping checksum"
fi

# 2. Decrypt if needed.
DUMP="$FILE"
case "$FILE" in
  *.cms)
    : "${BACKUP_PRIVATE_KEY:?BACKUP_PRIVATE_KEY (owner private key path) is required for .cms backups}"
    DUMP="$WORK/backup.dump"
    openssl cms -decrypt -binary -inform DER -in "$FILE" -inkey "$BACKUP_PRIVATE_KEY" -out "$DUMP"
    log "decrypted"
    ;;
esac

# 3. Restore into a brand-new database.
pgx createdb "$SCRATCH"
CREATED=true
log "restoring into $SCRATCH"
pgx pg_restore --dbname="$SCRATCH" --no-owner --no-acl --exit-on-error < "$DUMP"

q() { pgx psql -X -q -t -A -v ON_ERROR_STOP=1 --dbname="$1" -c "$2"; }

# 4. Checks: every migration applied, core tables present, money columns exact.
EXPECTED_MIGRATIONS="$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
APPLIED="$(q "$SCRATCH" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
[ "$APPLIED" = "$EXPECTED_MIGRATIONS" ] || { echo "migrations: restored $APPLIED, repository has $EXPECTED_MIGRATIONS" >&2; exit 1; }
log "migrations ok ($APPLIED)"

TABLES="users customers orders order_groups order_group_sizes order_payments suppliers order_costs general_expenses outgoing_payments workers worker_workdays worker_work_logs production_stage_progress production_ready deliveries audit_logs"
printf '%-28s %10s %10s\n' table restored live
STATUS=0
for t in $TABLES; do
  restored="$(q "$SCRATCH" "SELECT count(*) FROM \"$t\"")"
  live="-"
  if [ -n "${COMPARE_DATABASE_URL:-}" ]; then
    live="$( (pg_env_from_url "$COMPARE_DATABASE_URL" && q "$PGDATABASE" "SELECT count(*) FROM \"$t\"") )"
    # The live database can only have grown since the backup.
    [ "$live" -ge "$restored" ] || STATUS=1
  fi
  printf '%-28s %10s %10s\n' "$t" "$restored" "$live"
done

SUMS="$(q "$SCRATCH" "SELECT (SELECT coalesce(sum(amount),0) FROM order_payments WHERE voided_at IS NULL)::text || ' / ' || (SELECT coalesce(sum(amount),0) FROM outgoing_payments WHERE voided_at IS NULL)::text")"
log "money check (valid customer payments / valid outgoing payments): $SUMS"

[ "$STATUS" = 0 ] || { echo "row counts: restored backup has MORE rows than live — wrong database compared?" >&2; exit 1; }
log "RESTORE DRILL PASSED for $(basename "$FILE")"
