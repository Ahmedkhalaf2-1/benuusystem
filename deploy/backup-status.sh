#!/usr/bin/env bash
# Exit 0 when the newest successful backup is recent enough, 1 otherwise.
#   deploy/backup-status.sh            (default: at most 26 hours old)
#   MAX_AGE_HOURS=50 deploy/backup-status.sh
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/benuuprint}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
MARK="$BACKUP_DIR/last-success"

if [ ! -r "$MARK" ]; then
  echo "NO SUCCESSFUL BACKUP recorded in $BACKUP_DIR"
  exit 1
fi
newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'benuuprint-*.dump*' ! -name '*.sha256' -mmin -"$((MAX_AGE_HOURS * 60))" | sort | tail -n 1)"
if [ -z "$newest" ]; then
  echo "STALE: last success $(cat "$MARK"); nothing newer than ${MAX_AGE_HOURS}h in $BACKUP_DIR"
  exit 1
fi
echo "OK: last success $(cat "$MARK"); newest $(basename "$newest") ($(wc -c < "$newest" | tr -d ' ') bytes); $(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'benuuprint-*.dump*' ! -name '*.sha256' | wc -l | tr -d ' ') kept"
