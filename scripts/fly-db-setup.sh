#!/usr/bin/env bash
# ===========================================================================
# Project ANPR — Postgres on Fly.io
#
# Fly's own managed Postgres product does not ship PostGIS, so this deploys
# the official `postgis/postgis` image as a plain Fly Machine instead: a
# second, separate Fly app that only the project-anpr app can reach, over
# Fly's private network (<app>.internal), never on the public internet.
#
#   ./scripts/fly-db-setup.sh --region iad
#
# Idempotent-ish: re-running with the same --name skips app/volume creation
# if they already exist, but does not touch a machine that's already running.
# ===========================================================================
set -euo pipefail

NAME="${NAME:-project-anpr-db}"
REGION="${REGION:-iad}"
DB_NAME="${DB_NAME:-anpr}"
DB_USER="${DB_USER:-anpr}"
DB_PASSWORD="${DB_PASSWORD:-}"
VOLUME_SIZE_GB="${VOLUME_SIZE_GB:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)     NAME="${2:?}"; shift 2 ;;
    --region)   REGION="${2:?}"; shift 2 ;;
    --db-name)  DB_NAME="${2:?}"; shift 2 ;;
    --db-user)  DB_USER="${2:?}"; shift 2 ;;
    --db-password) DB_PASSWORD="${2:?}"; shift 2 ;;
    -h|--help)
      grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

command -v fly >/dev/null || { echo "flyctl not found — https://fly.io/docs/flyctl/install/" >&2; exit 1; }
[[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 24)"

echo "==> Creating app ${NAME}"
fly apps create "$NAME" 2>&1 | grep -v "already exists" || true

echo "==> Creating volume (${VOLUME_SIZE_GB}GB, region ${REGION})"
if ! fly volumes list --app "$NAME" 2>/dev/null | grep -q pgdata; then
  fly volumes create pgdata --app "$NAME" --region "$REGION" --size "$VOLUME_SIZE_GB" --yes
else
  echo "    pgdata already exists, skipping"
fi

echo "==> Starting postgis/postgis"
# PGDATA points at a *subdirectory* of the mount, not the mount itself. A fresh
# Fly volume (like any ext4 filesystem) contains lost+found, and the postgres
# image's initdb refuses to initialize into a directory that isn't empty:
#   initdb: error: directory "/var/lib/postgresql/data" exists but is not empty
# The container then exits, and nothing is listening on 5432.
fly machine run postgis/postgis:16-3.4 \
  --app "$NAME" \
  --region "$REGION" \
  --name "${NAME}-1" \
  --volume "pgdata:/var/lib/postgresql/data" \
  --env "PGDATA=/var/lib/postgresql/data/pgdata" \
  --env "POSTGRES_USER=${DB_USER}" \
  --env "POSTGRES_PASSWORD=${DB_PASSWORD}" \
  --env "POSTGRES_DB=${DB_NAME}" \
  --port 5432 \
  --vm-memory 256

cat <<EOF

==> Done.

This machine is reachable only from other apps in the same Fly org, at
${NAME}.internal:5432 — it was not given a public IP.

Next: apply the schema, then deploy the app with this connection string.

  fly proxy 5432 --app ${NAME} &
  psql "postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}" -f db/schema.sql
  kill %1

  fly secrets set --app project-anpr \\
    DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${NAME}.internal:5432/${DB_NAME}" \\
    SUBMITTER_SALT="\$(openssl rand -hex 32)"

Password (save it, it is not stored anywhere else): ${DB_PASSWORD}
EOF
