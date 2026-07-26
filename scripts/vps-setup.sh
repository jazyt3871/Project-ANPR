#!/usr/bin/env bash
# ===========================================================================
# Project ANPR — Ubuntu VPS setup
#
# Takes a bare Ubuntu 22.04/24.04 box to a running Project ANPR: everything on
# this one server — Postgres with PostGIS, photos on local disk, the site
# itself served on port 3000.
#
#   sudo ./scripts/vps-setup.sh                  # site on http://<server-ip>:3000
#   sudo ./scripts/vps-setup.sh --port 8080      # a different port
#   sudo ./scripts/vps-setup.sh --nginx --domain anpr.example.com --email you@example.com
#   ./scripts/vps-setup.sh --check               # dependency report, changes nothing
#
# Idempotent: safe to re-run after a `git pull` to rebuild and restart.
# ===========================================================================
set -euo pipefail

# --------------------------------------------------------------------------
# Defaults, all overridable by flag or environment
# --------------------------------------------------------------------------
APP_NAME="${APP_NAME:-project-anpr}"
APP_PORT="${APP_PORT:-3000}"
APP_USER="${APP_USER:-anpr}"
DB_NAME="${DB_NAME:-anpr}"
DB_USER="${DB_USER:-anpr}"
DB_PASSWORD="${DB_PASSWORD:-}"          # generated on first run if empty
DOMAIN="${DOMAIN:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
NODE_MAJOR="${NODE_MAJOR:-22}"          # Next.js 15 needs 20.9+; 22 is LTS
UPLOAD_DIR="${UPLOAD_DIR:-}"            # defaults to <app>/storage/uploads
MAX_UPLOAD_BYTES="${MAX_UPLOAD_BYTES:-8388608}"

CHECK_ONLY=0
# The site is served straight from the Node process on APP_PORT. nginx is
# opt-in, for when you want a hostname and a TLS certificate in front of it.
WITH_NGINX=0
WITH_FIREWALL=1
WITH_BUILD=1
WITH_SEED=0

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
step() { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
info() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options
  --nginx               Put nginx in front of the app instead of serving the
                        Node process directly. Implied by --domain.
  --domain <host>       Serve this hostname through nginx and request a
                        Let's Encrypt certificate for it.
  --email <address>     Contact address for Let's Encrypt. Without it nginx
                        serves plain HTTP.
  --port <n>            Port the site is served on (default 3000). Opened in
                        the firewall unless nginx is fronting it.
  --db-name <name>      Database name (default anpr).
  --db-user <name>      Database role (default anpr).
  --db-password <pw>    Role password. Generated and written to .env if omitted.
  --upload-dir <path>   Where photos are written (default <app>/storage/uploads).
  --node-major <n>      Node major version to install if missing (default 22).
  --seed                Run `npm run db:seed` after the schema is applied.
  --no-firewall         Do not touch ufw.
  --no-build            Skip npm install / prisma generate / next build.
  --check               Report on dependencies and ports, change nothing.
  -h, --help            This message.
EOF
}

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)       DOMAIN="${2:?--domain needs a value}"; WITH_NGINX=1; shift 2 ;;
    --email)        LETSENCRYPT_EMAIL="${2:?--email needs a value}"; shift 2 ;;
    --port)         APP_PORT="${2:?--port needs a value}"; shift 2 ;;
    --db-name)      DB_NAME="${2:?--db-name needs a value}"; shift 2 ;;
    --db-user)      DB_USER="${2:?--db-user needs a value}"; shift 2 ;;
    --db-password)  DB_PASSWORD="${2:?--db-password needs a value}"; shift 2 ;;
    --upload-dir)   UPLOAD_DIR="${2:?--upload-dir needs a value}"; shift 2 ;;
    --node-major)   NODE_MAJOR="${2:?--node-major needs a value}"; shift 2 ;;
    --seed)         WITH_SEED=1; shift ;;
    --nginx)        WITH_NGINX=1; shift ;;
    --no-firewall)  WITH_FIREWALL=0; shift ;;
    --no-build)     WITH_BUILD=0; shift ;;
    --check)        CHECK_ONLY=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage; die "unknown option: $1" ;;
  esac
done

UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/storage/uploads}"
ENV_FILE="$APP_DIR/.env"

# --------------------------------------------------------------------------
# 0. Dependency report — the whole of `--check`, and the preamble of a real run
# --------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

version_of() {
  case "$1" in
    node) node -v 2>/dev/null | sed 's/^v//' ;;
    npm)  npm -v 2>/dev/null ;;
    psql) psql --version 2>/dev/null | awk '{print $3}' ;;
    nginx) nginx -v 2>&1 | sed 's#.*/##' ;;
    *)    "$1" --version 2>/dev/null | head -1 ;;
  esac
}

report_dependencies() {
  step "Dependency check"

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if [[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]]; then
      ok "OS: ${PRETTY_NAME:-$ID}"
    else
      warn "OS: ${PRETTY_NAME:-unknown} — this script assumes Ubuntu/Debian apt"
    fi
  else
    warn "cannot read /etc/os-release"
  fi

  local name
  local wanted=(node npm psql ufw git openssl)
  [[ $WITH_NGINX == 1 ]] && wanted+=(nginx certbot)
  for name in "${wanted[@]}"; do
    if have "$name"; then
      ok "$name $(version_of "$name")"
    else
      warn "$name missing$([[ $CHECK_ONLY == 1 ]] && echo " — would be installed" || true)"
    fi
  done

  if have node; then
    local major; major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    (( major >= 20 )) || warn "Node $major is too old — Next.js 15 needs 20.9+"
  fi

  if have psql && systemctl is-active --quiet postgresql 2>/dev/null; then
    ok "postgresql service is running"
    if sudo -u postgres psql -tAc "select 1 from pg_available_extensions where name='postgis'" 2>/dev/null | grep -q 1; then
      ok "postgis extension is available"
    else
      warn "postgis not available to this server — would install postgresql-<ver>-postgis-3"
    fi
  else
    warn "postgresql service not running"
  fi

  if have ufw; then
    info "ufw: $(ufw status 2>/dev/null | head -1)"
  fi
}

report_dependencies
if [[ $CHECK_ONLY == 1 ]]; then
  printf '\n%s--check only: nothing was changed.%s\n' "$DIM" "$RESET"
  exit 0
fi

[[ $EUID -eq 0 ]] || die "run as root (sudo $0 ...) — installing packages and units needs it"

# --------------------------------------------------------------------------
# 1. Packages
# --------------------------------------------------------------------------
step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

APT_WANTED=(ca-certificates curl gnupg git openssl ufw postgresql postgresql-contrib)
[[ $WITH_NGINX == 1 ]] && APT_WANTED+=(nginx)

APT_MISSING=()
for pkg in "${APT_WANTED[@]}"; do
  dpkg -s "$pkg" >/dev/null 2>&1 || APT_MISSING+=("$pkg")
done

if (( ${#APT_MISSING[@]} )); then
  info "installing: ${APT_MISSING[*]}"
  apt-get install -y -qq "${APT_MISSING[@]}"
else
  ok "all base packages already present"
fi

# PostGIS is versioned against the server that just got installed.
PG_VERSION="$(psql --version | awk '{print $3}' | cut -d. -f1)"
if dpkg -s "postgresql-${PG_VERSION}-postgis-3" >/dev/null 2>&1; then
  ok "postgis for Postgres ${PG_VERSION} already installed"
else
  info "installing postgresql-${PG_VERSION}-postgis-3"
  apt-get install -y -qq "postgresql-${PG_VERSION}-postgis-3" \
    || die "no PostGIS package for Postgres ${PG_VERSION} in this release's archive"
fi

# --------------------------------------------------------------------------
# 2. Node
# --------------------------------------------------------------------------
step "Node.js"
NODE_MAJOR_FOUND=0
have node && NODE_MAJOR_FOUND="$(node -v | sed 's/^v//' | cut -d. -f1)"
if (( NODE_MAJOR_FOUND >= 20 )); then
  ok "node $(node -v) is new enough"
else
  info "installing Node ${NODE_MAJOR}.x from NodeSource"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  chmod a+r /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  ok "node $(node -v)"
fi

# --------------------------------------------------------------------------
# 3. Postgres: role, database, extensions, schema
# --------------------------------------------------------------------------
step "Database"
systemctl enable --now postgresql >/dev/null 2>&1 || true
systemctl is-active --quiet postgresql || die "postgresql failed to start — check journalctl -u postgresql"

psql_su() { sudo -u postgres psql -v ON_ERROR_STOP=1 -tAq "$@"; }

# Reuse the password already in .env so re-runs don't lock the app out of its
# own database.
if [[ -z "$DB_PASSWORD" && -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(sed -n 's#^DATABASE_URL="postgresql://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
  [[ -n "$DB_PASSWORD" ]] && info "reusing the database password already in .env"
fi
[[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 24)"

if [[ "$(psql_su -c "select 1 from pg_roles where rolname = '${DB_USER}'")" == "1" ]]; then
  psql_su -c "alter role \"${DB_USER}\" with login password '${DB_PASSWORD}'"
  ok "role ${DB_USER} exists (password synced with .env)"
else
  psql_su -c "create role \"${DB_USER}\" with login password '${DB_PASSWORD}'"
  ok "created role ${DB_USER}"
fi

if [[ "$(psql_su -c "select 1 from pg_database where datname = '${DB_NAME}'")" == "1" ]]; then
  ok "database ${DB_NAME} exists"
else
  psql_su -c "create database \"${DB_NAME}\" owner \"${DB_USER}\""
  ok "created database ${DB_NAME}"
fi

# CREATE EXTENSION needs superuser, so it happens here rather than inside the
# schema file's own connection. The schema file re-declares them idempotently.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" \
  -c "create extension if not exists postgis" \
  -c "create extension if not exists pgcrypto" \
  -c "grant all on schema public to \"${DB_USER}\""
ok "postgis + pgcrypto enabled in ${DB_NAME}"

# The connection string is loopback-only: Postgres keeps its default
# listen_addresses='localhost', so the database is never exposed to the network
# and port 5432 stays closed in the firewall below.
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=10"

step "Applying db/schema.local.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" -f "$APP_DIR/db/schema.local.sql"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" \
  -c "grant all privileges on all tables in schema public to \"${DB_USER}\"" \
  -c "grant all privileges on all sequences in schema public to \"${DB_USER}\""
ok "schema applied and granted to ${DB_USER}"

# --------------------------------------------------------------------------
# 4. Service account, upload directory, .env
# --------------------------------------------------------------------------
step "Service account and environment"
if id -u "$APP_USER" >/dev/null 2>&1; then
  ok "user ${APP_USER} exists"
else
  useradd --system --create-home --home-dir "/var/lib/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
  ok "created system user ${APP_USER}"
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$UPLOAD_DIR"
ok "uploads: ${UPLOAD_DIR}"

if [[ -f "$ENV_FILE" ]]; then
  # Rewrite only the lines this script owns; anything else the operator added
  # (rate limits, salts) is left alone.
  set_env() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
      # awk rather than sed: the values are connection strings full of the
      # characters sed treats as delimiters and backreferences.
      KEY="$key" VALUE="$value" awk '
        index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=\"" ENVIRON["VALUE"] "\""; next }
        { print }
      ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    else
      printf '%s="%s"\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }
  set_env DATABASE_URL "$DATABASE_URL"
  set_env DIRECT_URL "$DATABASE_URL"
  set_env STORAGE_DRIVER "local"
  set_env UPLOAD_DIR "$UPLOAD_DIR"
  ok "updated existing .env"
else
  cat > "$ENV_FILE" <<EOF
# Written by scripts/vps-setup.sh — self-hosted Sightline.

# Local Postgres over the loopback interface. No pooler: a long-lived Node
# process holds its own pool, so DATABASE_URL and DIRECT_URL are the same
# connection.
DATABASE_URL="${DATABASE_URL}"
DIRECT_URL="${DATABASE_URL}"

# Photos on this server's disk, served through /api/photos.
STORAGE_DRIVER="local"
UPLOAD_DIR="${UPLOAD_DIR}"

# Submission limits
MAX_UPLOAD_BYTES="${MAX_UPLOAD_BYTES}"
RATE_LIMIT_PER_HOUR="20"

# Salts the coarse submitter tag stored with each row.
SUBMITTER_SALT="$(openssl rand -hex 32)"
EOF
  ok "wrote ${ENV_FILE}"
fi
chown "$APP_USER":"$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# --------------------------------------------------------------------------
# 5. Build
# --------------------------------------------------------------------------
if [[ $WITH_BUILD == 1 ]]; then
  step "Installing dependencies and building"
  chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
  # The tree now belongs to the service account, so root's later `git pull`
  # would trip git's ownership check.
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  run_as_app() { sudo -u "$APP_USER" env "HOME=/var/lib/${APP_USER}" "PATH=$PATH" "$@"; }

  # npm ci is the reproducible path, but it refuses to run when the lockfile
  # has drifted from package.json; fall back rather than fail the deploy.
  if [[ -f "$APP_DIR/package-lock.json" ]] \
     && (cd "$APP_DIR" && run_as_app npm ci --no-audit --fund=false); then
    :
  else
    warn "npm ci unavailable or out of sync — falling back to npm install"
    (cd "$APP_DIR" && run_as_app npm install --no-audit --fund=false)
  fi
  (cd "$APP_DIR" && run_as_app npx prisma generate)
  (cd "$APP_DIR" && run_as_app npm run build)
  ok "built"

  if [[ $WITH_SEED == 1 ]]; then
    (cd "$APP_DIR" && run_as_app npm run db:seed)
    ok "seeded"
  fi
else
  warn "skipping build (--no-build) — .next must already exist"
fi

# --------------------------------------------------------------------------
# 6. systemd unit
# --------------------------------------------------------------------------
step "systemd unit"
# Bound to loopback when nginx fronts it; without nginx it has to listen on all
# interfaces to be reachable at all.
LISTEN_HOST="127.0.0.1"
[[ $WITH_NGINX == 1 ]] || LISTEN_HOST="0.0.0.0"

cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Project ANPR (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
ExecStart=/usr/bin/npm run start -- --hostname ${LISTEN_HOST} --port ${APP_PORT}
Restart=always
RestartSec=5

# Hardening: the app needs to read its tree and write uploads, nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
ReadWritePaths=${UPLOAD_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null
systemctl restart "$APP_NAME"
sleep 2
if systemctl is-active --quiet "$APP_NAME"; then
  ok "${APP_NAME}.service running on ${LISTEN_HOST}:${APP_PORT}"
else
  systemctl status "$APP_NAME" --no-pager -l || true
  die "${APP_NAME}.service failed to start — see the status above"
fi

# --------------------------------------------------------------------------
# 7. nginx
# --------------------------------------------------------------------------
if [[ $WITH_NGINX == 1 ]]; then
  step "nginx reverse proxy"
  SERVER_NAME="${DOMAIN:-_}"
  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    # Photo uploads are multipart bodies capped at MAX_UPLOAD_BYTES in the
    # route handler; nginx has to be told to let them through first.
    client_max_body_size $(( MAX_UPLOAD_BYTES / 1048576 + 1 ))m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        # The submitter hash and rate limiter key off the client IP, which is
        # nginx's own address unless it is forwarded.
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    # Immutable, hashed build output.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
EOF
  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  [[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx || systemctl restart nginx
  ok "nginx serving ${SERVER_NAME} -> 127.0.0.1:${APP_PORT}"
fi

# --------------------------------------------------------------------------
# 8. Firewall
#
# Postgres (5432) is deliberately absent: it listens on loopback only, so
# opening it would widen the surface for nothing. The app's own port is opened
# only when nginx is not fronting it.
# --------------------------------------------------------------------------
if [[ $WITH_FIREWALL == 1 ]]; then
  step "Firewall (ufw)"
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
  ok "22/tcp (SSH)"
  if [[ $WITH_NGINX == 1 ]]; then
    ufw allow 80/tcp >/dev/null;  ok "80/tcp (HTTP)"
    ufw allow 443/tcp >/dev/null; ok "443/tcp (HTTPS)"
  else
    ufw allow "${APP_PORT}/tcp" >/dev/null; ok "${APP_PORT}/tcp (the site)"
  fi
  ufw --force enable >/dev/null
  ufw status verbose | sed 's/^/  /'
fi

# --------------------------------------------------------------------------
# 9. TLS
# --------------------------------------------------------------------------
if [[ $WITH_NGINX == 1 && -n "$DOMAIN" && -n "$LETSENCRYPT_EMAIL" ]]; then
  step "TLS certificate"
  dpkg -s certbot >/dev/null 2>&1 || apt-get install -y -qq certbot python3-certbot-nginx
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
       -m "$LETSENCRYPT_EMAIL" --redirect; then
    ok "https://${DOMAIN} — renewal is handled by certbot.timer"
  else
    warn "certbot failed. The site still works over HTTP; re-run:"
    info "certbot --nginx -d ${DOMAIN} -m ${LETSENCRYPT_EMAIL} --agree-tos"
  fi
elif [[ -n "$DOMAIN" && -z "$LETSENCRYPT_EMAIL" ]]; then
  warn "no --email, so no certificate was requested. For HTTPS:"
  info "apt install certbot python3-certbot-nginx && certbot --nginx -d ${DOMAIN}"
fi

# --------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------
if [[ -n "$DOMAIN" ]]; then
  URL="http${LETSENCRYPT_EMAIL:+s}://${DOMAIN}"
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  URL="http://${IP:-<server-ip>}$([[ $WITH_NGINX == 1 ]] && echo "" || echo ":${APP_PORT}")"
fi

cat <<EOF

${GREEN}${BOLD}Project ANPR is up.${RESET}  ${BOLD}${URL}${RESET}

  logs        journalctl -u ${APP_NAME} -f
  restart     systemctl restart ${APP_NAME}
  database    sudo -u postgres psql ${DB_NAME}
  photos      ${UPLOAD_DIR}
  env         ${ENV_FILE}  (mode 600, owned by ${APP_USER})

  Redeploy after a git pull:
    cd ${APP_DIR} && git pull && sudo ./scripts/vps-setup.sh

  Note: the GPS and compass steps need a secure context in the browser. Over
  plain HTTP on an IP address they will not work — for phone capture, run with
  --nginx --domain <host> --email <you> to get a real certificate.
EOF
