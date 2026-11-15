# Shared helpers for the Benuuprint backup scripts. Source it; do not run it.
# Works with bash 3.2+ (macOS) and bash 5 (Ubuntu).

# Runs a PostgreSQL client tool. PG_CMD_PREFIX is a TEST HOOK only (e.g. run
# the tools inside a local Docker container); leave it unset on the VPS.
pgx() {
  # shellcheck disable=SC2086
  ${PG_CMD_PREFIX:-} "$@"
}

# Exports PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from a Prisma-style
# DATABASE_URL, so the password never appears in a process argument list.
# Supports ?host=/var/run/postgresql (Unix socket) and ignores ?schema=.
pg_env_from_url() {
  local url="$1" re='^postgres(ql)?://([^:@/]*)(:([^@]*))?@([^:/?]*)(:([0-9]+))?/([^?]+)(\?(.*))?$'
  if [[ ! "$url" =~ $re ]]; then
    echo "DATABASE_URL is not a postgresql:// URL with a database name" >&2
    return 1
  fi
  local user="${BASH_REMATCH[2]}" pass="${BASH_REMATCH[4]}" host="${BASH_REMATCH[5]}"
  local port="${BASH_REMATCH[7]}" db="${BASH_REMATCH[8]}" query="${BASH_REMATCH[10]}"
  local pair key value
  local IFS='&'
  for pair in $query; do
    key="${pair%%=*}"
    value="${pair#*=}"
    [ "$key" = "host" ] && host="$(pct_decode "$value")"
  done
  unset IFS
  export PGHOST="${host:-localhost}" PGPORT="${port:-5432}" PGUSER="$(pct_decode "$user")" PGDATABASE="$(pct_decode "$db")"
  if [ -n "$pass" ]; then export PGPASSWORD; PGPASSWORD="$(pct_decode "$pass")"; fi
}

pct_decode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
