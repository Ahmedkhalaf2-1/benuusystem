#!/usr/bin/env bash
# Benuuprint ERP — one PostgreSQL backup.
#
# Run by benuuprint-backup.timer as the `benuuprint` user, with the app's
# environment file loaded (DATABASE_URL). Steps:
#   1. pg_dump (custom format, consistent snapshot) to a private temp file;
#   2. prove the archive is readable and contains the business tables;
#   3. encrypt it to the owner's PUBLIC certificate (the private key never
#      lives on the server), record its SHA-256;
#   4. delete local backups older than BACKUP_KEEP_DAYS;
#   5. copy off-server (optional rclone remote) and ping a dead-man's switch.
# Any failure exits non-zero, so systemd marks the run failed and the
# health-check URL (if set) receives /fail.
set -Eeuo pipefail   # -E: the ERR trap also fires for failures inside functions
umask 077
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib-pg.sh
. "$HERE/lib-pg.sh"

: "${DATABASE_URL:?DATABASE_URL is not set (load the app environment file)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/benuuprint}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
BACKUP_RECIPIENT_CERT="${BACKUP_RECIPIENT_CERT:-}"
BACKUP_ALLOW_UNENCRYPTED="${BACKUP_ALLOW_UNENCRYPTED:-false}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"
BACKUP_HEALTHCHECK_URL="${BACKUP_HEALTHCHECK_URL:-}"

ping_check() {
  [ -n "$BACKUP_HEALTHCHECK_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}$1" || log "warning: health-check ping failed"
}
TMP=""
cleanup() { [ -n "$TMP" ] && rm -f -- "$TMP"; }
FAILED=false
on_error() { $FAILED && return; FAILED=true; log "BACKUP FAILED (line $1)"; ping_check /fail; }
trap 'on_error $LINENO' ERR
trap cleanup EXIT

if [ -z "$BACKUP_RECIPIENT_CERT" ] && [ "$BACKUP_ALLOW_UNENCRYPTED" != "true" ]; then
  echo "BACKUP_RECIPIENT_CERT is not set. Refusing to write an unencrypted backup (set BACKUP_ALLOW_UNENCRYPTED=true only for local tests)." >&2
  false
fi
if [ -n "$BACKUP_RECIPIENT_CERT" ] && [ ! -r "$BACKUP_RECIPIENT_CERT" ]; then
  echo "Cannot read BACKUP_RECIPIENT_CERT ($BACKUP_RECIPIENT_CERT)" >&2
  false
fi

pg_env_from_url "$DATABASE_URL"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="benuuprint-${STAMP}.dump"
TMP="$(mktemp "$BACKUP_DIR/.inprogress.XXXXXX")"

log "dumping database ${PGDATABASE} on ${PGHOST}"
pgx pg_dump --format=custom --compress=6 --no-owner --no-acl > "$TMP"

# 2. The archive must be readable and include the core tables' data.
LIST="$(pgx pg_restore --list < "$TMP")"
for table in _prisma_migrations users orders order_payments outgoing_payments; do
  if ! grep -Eq "TABLE DATA [^ ]+ ${table} " <<<"$LIST"; then
    echo "archive check failed: no data section for table ${table}" >&2
    false
  fi
done
log "archive verified ($(grep -c 'TABLE DATA' <<<"$LIST") tables, $(wc -c < "$TMP" | tr -d ' ') bytes)"

# 3. Encrypt to the owner's certificate (public key only on this server).
if [ -n "$BACKUP_RECIPIENT_CERT" ]; then
  FINAL="$BACKUP_DIR/${NAME}.cms"
  openssl cms -encrypt -binary -aes256 -stream -outform DER -in "$TMP" -out "$FINAL.part" "$BACKUP_RECIPIENT_CERT"
else
  FINAL="$BACKUP_DIR/${NAME}"
  cp "$TMP" "$FINAL.part"
fi
mv "$FINAL.part" "$FINAL"
chmod 600 "$FINAL"
printf '%s  %s\n' "$(sha256_of "$FINAL")" "$(basename "$FINAL")" > "$FINAL.sha256"
chmod 600 "$FINAL.sha256"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success"
log "wrote $(basename "$FINAL")"

# 4. Retention (only our own files, only in BACKUP_DIR).
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'benuuprint-*.dump*' -mtime +"$BACKUP_KEEP_DAYS" -print -delete | sed 's/^/removed old backup: /'

# 5. Off-server copy.
if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  rclone copy --no-traverse "$FINAL" "$BACKUP_RCLONE_REMOTE"
  rclone copy --no-traverse "$FINAL.sha256" "$BACKUP_RCLONE_REMOTE"
  log "copied off-server to ${BACKUP_RCLONE_REMOTE%%:*}:"
fi

ping_check ""
log "backup complete"
