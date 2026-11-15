#!/usr/bin/env bash
# Benuuprint ERP — deploy one git ref to the VPS.
#
#   sudo /opt/benuuprint/current/deploy/deploy.sh <git ref, e.g. main or a tag>
#
# Layout (created once, see docs/deployment-runbook.md):
#   /opt/benuuprint/source         git clone of the repository (fetch only)
#   /opt/benuuprint/releases/<sha> one directory per deployed commit
#   /opt/benuuprint/current        symlink → the live release
#   /etc/benuuprint/benuuprint.env production secrets (root:benuuprint 0640)
#
# Sequence: fetch → unpack release → npm ci + build (old version keeps
# serving) → backup → stop → migrate deploy → switch symlink → start →
# health check. If the new version is not healthy within 60 s, the symlink is
# switched back and the previous release started again. Database migrations
# are NOT rolled back automatically (see the runbook).
set -euo pipefail
umask 027

main() {
  local ref="${1:?usage: deploy.sh <git ref>}"
  local base=/opt/benuuprint app_user=benuuprint env_file=/etc/benuuprint/benuuprint.env
  local src="$base/source" rel_dir="$base/releases" current="$base/current"

  [ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
  [ -r "$env_file" ] || { echo "missing $env_file" >&2; exit 1; }
  as_app() { runuser -u "$app_user" -- "$@"; }
  port="$(as_app bash -c "set -a; . '$env_file'; echo \"\${PORT:-3000}\"")"

  echo "→ fetching $ref"
  as_app git -C "$src" fetch --tags --prune origin
  local sha
  sha="$(as_app git -C "$src" rev-parse --verify "origin/$ref^{commit}" 2>/dev/null || as_app git -C "$src" rev-parse --verify "$ref^{commit}")"
  local short="${sha:0:12}" target="$rel_dir/${sha:0:12}"
  local previous=""
  [ -L "$current" ] && previous="$(readlink -f "$current")"
  [ "$previous" != "$target" ] || { echo "already live: $short"; exit 0; }

  echo "→ unpacking $short into $target"
  # Built in place (moving a built .next breaks absolute paths); a marker file
  # says the build finished, so an interrupted build is redone from scratch.
  if [ ! -f "$target/.release-complete" ]; then
    case "$target" in "$rel_dir"/????????????) rm -rf -- "$target" ;; *) exit 1 ;; esac
    as_app mkdir -p "$target"
    as_app bash -c "git -C '$src' archive '$sha' | tar -x -C '$target'"
    [ ! -e "$target/.env" ] || { echo "refusing: release contains a .env file" >&2; exit 1; }
    echo "→ installing dependencies and building (the live version keeps serving)"
    as_app bash -c "cd '$target' && npm ci --no-audit --no-fund && npm run build"
    as_app bash -c "printf '%s\\n' '$sha' > '$target/.release-complete'"
  fi

  if [ -n "$previous" ]; then
    echo "→ backup before migrating (aborts the deploy if it fails)"
    systemctl start benuuprint-backup.service
  fi

  echo "→ stopping the app"
  systemctl stop benuuprint.service

  echo "→ applying database migrations (prisma migrate deploy — never resets data)"
  if ! as_app bash -c "set -a; . '$env_file'; set +a; cd '$target' && npx prisma migrate deploy"; then
    echo "MIGRATION FAILED — starting the previous release again" >&2
    systemctl start benuuprint.service
    exit 1
  fi

  ln -sfn "$target" "$current.next" && mv -T "$current.next" "$current"
  systemctl start benuuprint.service

  echo "→ health check on 127.0.0.1:$port"
  for _ in $(seq 1 30); do
    if curl -fsS -m 3 "http://127.0.0.1:$port/api/health" | grep -q '"database":"ok"'; then
      echo "✓ live: $short (previous: ${previous##*/})"
      # Keep the live release plus the two most recent others.
      ls -1dt "$rel_dir"/*/ | grep -v "^$target/$" | tail -n +3 | while read -r old; do
        [ "${old%/}" = "$previous" ] || rm -rf -- "${old%/}"
      done
      return 0
    fi
    sleep 2
  done

  echo "NEW RELEASE UNHEALTHY — rolling back to ${previous##*/}" >&2
  journalctl -u benuuprint.service -n 30 --no-pager >&2 || true
  if [ -n "$previous" ]; then
    ln -sfn "$previous" "$current.next" && mv -T "$current.next" "$current"
    systemctl restart benuuprint.service
  fi
  exit 1
}

# Everything is inside main() so bash has read the whole script before the
# release directory (which contains this file) changes.
main "$@"
