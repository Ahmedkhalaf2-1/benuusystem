#!/usr/bin/env bash
# Local design preview of the real app on fictional data.
#   scripts/preview-local.sh [--build]      → http://localhost:3010
# Reads .env.preview.local (gitignored) and refuses anything that is not a
# local *_preview database. Never touches production.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.preview.local ] || { echo "Missing .env.preview.local (local preview database credentials)." >&2; exit 1; }
set -a; . ./.env.preview.local; set +a
case "$DATABASE_URL" in
  postgresql://*@localhost:*/*_preview\?*|postgresql://*@127.0.0.1:*/*_preview\?*) ;;
  *) echo "Refusing: DATABASE_URL is not a local *_preview database." >&2; exit 1 ;;
esac
[ "${1:-}" = "--build" ] && npm run build
exec npx next start -H 127.0.0.1 -p "${PORT:-3010}"
