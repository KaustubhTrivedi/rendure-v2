#!/usr/bin/env sh
# Apply all SQL migrations in /migrations (sorted), recording each in
# schema_migrations so re-runs are safe. Designed to run as a one-shot
# container after the db service is healthy.
#
# Env vars (all required):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#
# Conventions:
#   - schema.sql is treated as the base schema and applied FIRST.
#   - Numbered migrations (001_*.sql, 002_*.sql, ...) are applied in
#     filename order after the base schema.
#   - Each applied file is recorded in schema_migrations(filename) so
#     subsequent runs skip files that have already been applied.

set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"

export PGPASSWORD

psql_run() {
  psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}

echo "[migrate] waiting for $PGHOST:$PGPORT/$PGDATABASE to accept connections..."
i=0
until psql_run -c "SELECT 1" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[migrate] giving up after 60 attempts" >&2
    exit 1
  fi
  sleep 1
done
echo "[migrate] connected."

# Ensure the tracking table exists.
psql_run <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
SQL

apply_if_new() {
  file="$1"
  base=$(basename "$file")
  already=$(psql_run -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$base'")
  if [ "$already" = "1" ]; then
    echo "[migrate] skip $base (already applied)"
    return
  fi
  echo "[migrate] apply $base"
  psql_run -f "$file"
  psql_run -c "INSERT INTO schema_migrations (filename) VALUES ('$base')" >/dev/null
}

# 1. Base schema first, if present.
if [ -f /migrations/schema.sql ]; then
  apply_if_new /migrations/schema.sql
fi

# 2. Numbered migrations in sorted order. `ls | sort` handles 001, 002, ...
# Iterate via a here-doc so the loop runs in the current shell (set -e applies).
SORTED=$(ls /migrations 2>/dev/null | grep -E '^[0-9]+_.*\.sql$' | sort || true)
if [ -n "$SORTED" ]; then
  for f in $SORTED; do
    apply_if_new "/migrations/$f"
  done
fi

echo "[migrate] done."
