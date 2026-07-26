#!/usr/bin/env bash
# ===========================================================================
# Project ANPR — start (Linux)
#
# Run this after scripts/install-linux.sh has already set up the database and
# built the app. It does not install or configure anything — it just starts
# the server with .env loaded.
#
#   ./scripts/start-linux.sh            # production server on :3000
#   ./scripts/start-linux.sh --dev      # dev server, hot reload
#   PORT=8080 ./scripts/start-linux.sh  # a different port
#
# On a systemd-managed install (scripts/install-linux.sh without --no-build,
# on a real server) the app already runs as a service — this script is for
# everywhere else: a Linux desktop, a container, a box you're not putting
# systemd on. Running both at once just means two processes fighting over the
# same port; only one will win.
# ===========================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

MODE="start"
[[ "${1:-}" == "--dev" ]] && MODE="dev"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; YELLOW=""; GREEN=""; RESET=""
fi
die()  { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*"; }

[[ -f "$APP_DIR/.env" ]] || die "no .env found. Run ./scripts/install-linux.sh first."
[[ -d "$APP_DIR/node_modules" ]] || die "no node_modules. Run ./scripts/install-linux.sh first (or npm install)."

if systemctl is-active --quiet project-anpr 2>/dev/null; then
  warn "project-anpr.service is already running under systemd."
  warn "Starting a second copy here will just fight it for the port. Use:"
  warn "  systemctl status project-anpr"
  warn "  journalctl -u project-anpr -f"
  exit 1
fi

if [[ "$MODE" == "start" && ! -d "$APP_DIR/.next" ]]; then
  die "no production build found. Run 'npm run build' or ./scripts/install-linux.sh first, or use --dev."
fi

PORT="${PORT:-3000}"
export PORT

# `node --env-file-if-exists` (Node 22+) reads .env directly, matching
# package.json's db:seed script — next itself also reads .env on its own, so
# this is belt and suspenders for anything spawned via `env`, not next.
printf '%sStarting on http://localhost:%s%s\n' "$GREEN$BOLD" "$PORT" "$RESET"
if [[ "$MODE" == "dev" ]]; then
  exec npm run dev
else
  exec npm start -- --port "$PORT"
fi
