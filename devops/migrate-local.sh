#!/usr/bin/env bash
# devops/migrate-local.sh — apply DB migrations to your LOCAL Postgres.
#
# Production migrates automatically on build (package.json `postbuild`), so this
# is for local dev only. It makes sure the dockerised Postgres is up, waits for
# it to be healthy, then runs the Drizzle migrations and shows the result.
#
# Usage:
#   ./devops/migrate-local.sh            Start DB (if needed) + apply migrations
#   ./devops/migrate-local.sh --status   Just show which migrations are applied
#   ./devops/migrate-local.sh --help

set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}▶${RESET}  $*"; }
success() { echo -e "${GREEN}✓${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✗${RESET}  $*" >&2; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }
die()     { error "$*"; exit 1; }

# ── locate repo root (script lives in devops/) ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

CONTAINER="blackcode-postgres"
DB_USER="blackcode"
DB_NAME="blackcode_issues"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

# ── 0. sanity checks ─────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker not found — install Docker Desktop first."
docker info >/dev/null 2>&1 || die "Docker daemon not running — start Docker Desktop, then retry."
[[ -f .env.local ]] || warn ".env.local not found — drizzle reads DATABASE_URL from it (see ENV_TEMPLATE.md)."

# ── 1. ensure Postgres is running ────────────────────────────────────────────
header "1/3  Postgres container"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  success "${CONTAINER} already running"
else
  info "Starting Postgres via docker compose…"
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d postgres
  else
    docker-compose up -d postgres
  fi
  success "container started"
fi

# ── 2. wait until it accepts connections ─────────────────────────────────────
header "2/3  Waiting for Postgres to be ready"
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    success "Postgres is ready"
    break
  fi
  [[ $i -eq 30 ]] && die "Postgres did not become ready in time."
  sleep 1
done

# ── 3. status-only mode ──────────────────────────────────────────────────────
if [[ "${1:-}" == "--status" ]]; then
  header "Applied migrations"
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT hash, to_timestamp(created_at/1000) AS applied_at FROM drizzle.__drizzle_migrations ORDER BY created_at;" \
    2>/dev/null || warn "No migrations table yet — run without --status to apply."
  exit 0
fi

# ── 4. apply migrations ──────────────────────────────────────────────────────
header "3/3  Applying migrations"
npm run db:migrate
success "Migrations applied"

# ── 5. show current tasks columns as a quick smoke check ─────────────────────
header "Done"
success "Local database is up to date."
echo -e "   Tip: ${BOLD}./devops/migrate-local.sh --status${RESET} lists applied migrations."
