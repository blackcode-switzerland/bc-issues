#!/usr/bin/env bash
# devops/release.sh — unified release script for bc-issues
#
# Usage:
#   ./devops/release.sh web              Deploy web app to Vercel production
#   ./devops/release.sh cli v1.2.3       Release CLI to GitHub + npm
#   ./devops/release.sh --help

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

# ── helpers ────────────────────────────────────────────────────────────────
require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    die "'$1' is not installed. $2"
  fi
}

check_git_clean() {
  if [[ -n "$(git status --porcelain)" ]]; then
    warn "Working tree has uncommitted changes:"
    git status --short
    echo
    read -r -p "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."
  fi
}

check_git_branch() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$branch" != "main" ]]; then
    warn "You are on branch '${branch}', not 'main'."
    read -r -p "Continue anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."
  fi
}

check_vercel_auth() {
  require_cmd vercel "Install with: npm install -g vercel"
  local whoami
  whoami=$(vercel whoami 2>&1) || die "Not logged in to Vercel. Run: vercel login"
  success "Vercel: logged in as ${whoami}"
}

check_gh_auth() {
  require_cmd gh "Install with: brew install gh"
  if ! gh auth status &>/dev/null; then
    die "Not logged in to GitHub CLI. Run: gh auth login"
  fi
  local user
  user=$(gh api user --jq '.login' 2>&1) || die "GitHub CLI auth check failed: ${user}"
  success "GitHub: logged in as ${user}"
}

check_npm_auth() {
  require_cmd npm "Install Node.js from https://nodejs.org"
  local user
  user=$(npm whoami 2>&1) || die "Not logged in to npm. Run: npm login"
  success "npm: logged in as ${user}"
}

# ── usage ──────────────────────────────────────────────────────────────────
usage() {
  echo -e "
${BOLD}bc-issues release script${RESET}

${BOLD}USAGE${RESET}
  $(basename "$0") web                Deploy web app to Vercel production
  $(basename "$0") cli <bump>         Release CLI to GitHub Releases + npm
  $(basename "$0") --help             Show this help

${BOLD}BUMP OPTIONS${RESET}
  patch      Bug fix          v1.0.0 → v1.0.1
  minor      New feature      v1.0.0 → v1.1.0
  major      Breaking change  v1.0.0 → v2.0.0
  vX.Y.Z     Explicit version (e.g. v1.2.3)

${BOLD}EXAMPLES${RESET}
  $(basename "$0") web
  $(basename "$0") cli patch
  $(basename "$0") cli minor
  $(basename "$0") cli major

${BOLD}PREREQUISITES${RESET}
  web   vercel CLI logged in (vercel login)
  cli   gh CLI logged in (gh auth login), npm logged in (npm login),
        OTP authenticator app ready for npm publish
"
}

# ── web release ────────────────────────────────────────────────────────────
release_web() {
  header "🌐  Web release → Vercel production"

  # preflight
  info "Running preflight checks..."
  check_vercel_auth
  check_git_branch
  check_git_clean

  # deploy
  header "Deploying to Vercel..."
  vercel --prod 2>&1 | while IFS= read -r line; do
    echo "  ${line}"
  done

  # extract and print the production URL from vercel output
  echo
  success "Deployment complete."
  info  "Production URL: https://bc-issues.vercel.app"
  info  "Vercel dashboard: https://vercel.com/balathanusans-projects-f76f8a7b/bc-issues"
}

# ── bump version ───────────────────────────────────────────────────────────
resolve_version() {
  local bump="${1:-}"

  if [[ -z "$bump" ]]; then
    die "Version bump required. Usage: $(basename "$0") cli <patch|minor|major|vX.Y.Z>"
  fi

  # explicit version tag passed (e.g. v1.2.3)
  if [[ "$bump" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "$bump"
    return
  fi

  if [[ "$bump" != "patch" && "$bump" != "minor" && "$bump" != "major" ]]; then
    die "Invalid argument '${bump}'. Use: patch, minor, major, or vX.Y.Z"
  fi

  # find latest semver tag
  local latest
  latest=$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)

  if [[ -z "$latest" ]]; then
    die "No existing version tags found. Create the first release manually: $(basename "$0") cli v1.0.0"
  fi

  local major minor patch
  major=$(echo "$latest" | cut -d. -f1 | tr -d 'v')
  minor=$(echo "$latest" | cut -d. -f2)
  patch=$(echo "$latest" | cut -d. -f3)

  case "$bump" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
  esac

  echo "v${major}.${minor}.${patch}"
}

# ── cli release ────────────────────────────────────────────────────────────
release_cli() {
  local bump="${1:-}"
  local version
  version=$(resolve_version "$bump")
  local version_number="${version#v}"   # strip leading 'v' for package.json
  local repo="blackcode-switzerland/bc-issues"
  local npm_package="@blackcode_sa/bc-issues"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local root_dir
  root_dir="$(cd "${script_dir}/.." && pwd)"
  local cli_dir="${root_dir}/cli"
  local npm_dir="${cli_dir}/npm"

  header "📦  CLI release ${version} (${bump}) → GitHub + npm"

  # preflight
  info "Running preflight checks..."
  check_gh_auth
  check_npm_auth
  check_git_branch
  check_git_clean

  # check tag doesn't already exist
  if git tag --list | grep -q "^${version}$"; then
    die "Git tag '${version}' already exists. Bump the version number."
  fi

  # check npm version doesn't already exist
  if npm view "${npm_package}@${version_number}" version &>/dev/null 2>&1; then
    die "npm version ${version_number} already published. Bump the version number."
  fi

  success "All preflight checks passed."

  # bump versions in npm package files
  header "Bumping version to ${version_number}..."
  local pkg_json="${npm_dir}/package.json"
  local install_js="${npm_dir}/install.js"

  # update package.json version
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${version_number}\"/" "$pkg_json"
  # update install.js VERSION constant
  sed -i '' "s/^const VERSION = '.*'/const VERSION = '${version_number}'/" "$install_js"
  success "Updated ${pkg_json}"
  success "Updated ${install_js}"

  # commit version bump
  info "Committing version bump..."
  git add "$pkg_json" "$install_js"
  git commit -m "chore: bump CLI npm package to ${version}"
  git push origin main
  success "Pushed version bump commit."

  # tag
  info "Creating git tag ${version}..."
  git tag "$version"
  git push origin "$version"
  success "Pushed tag ${version}."

  # build binaries
  header "Building binaries..."
  cd "$cli_dir"
  make dist 2>&1 | while IFS= read -r line; do echo "  ${line}"; done
  cd "$root_dir"
  success "Binaries built in cli/dist/"

  # create github release
  header "Creating GitHub Release ${version}..."
  local dist_dir="${cli_dir}/dist"
  local bin_name="bk-${version}"

  gh release create "$version" \
    "${dist_dir}/${bin_name}-darwin-amd64" \
    "${dist_dir}/${bin_name}-darwin-arm64" \
    "${dist_dir}/${bin_name}-linux-amd64" \
    "${dist_dir}/${bin_name}-linux-arm64" \
    "${dist_dir}/${bin_name}-windows-amd64.exe" \
    "${dist_dir}/${bin_name}-windows-arm64.exe" \
    "${dist_dir}/SHA256SUMS" \
    --repo "$repo" \
    --title "${version}" \
    --notes "## Install

\`\`\`bash
npm install -g ${npm_package}
\`\`\`

## Usage

\`\`\`bash
bk login --server https://bc-issues.vercel.app
bk whoami
\`\`\`

## Platforms
- macOS (Intel + Apple Silicon)
- Linux (x64 + arm64)
- Windows (x64 + arm64)" 2>&1 | while IFS= read -r line; do echo "  ${line}"; done

  success "GitHub Release created: https://github.com/${repo}/releases/tag/${version}"

  # publish npm
  header "Publishing to npm..."
  warn "npm will ask for your OTP (2FA code). Have your authenticator app ready."
  echo
  cd "$npm_dir"
  npm publish --access public
  cd "$root_dir"

  echo
  success "npm package published: ${npm_package}@${version_number}"

  # summary
  echo
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  CLI ${version} released successfully!${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  GitHub:  https://github.com/${repo}/releases/tag/${version}"
  echo -e "  npm:     https://www.npmjs.com/package/${npm_package}"
  echo -e "  Install: npm install -g ${npm_package}"
  echo
}

# ── entrypoint ─────────────────────────────────────────────────────────────
COMMAND="${1:-}"

case "$COMMAND" in
  web)
    release_web
    ;;
  cli)
    release_cli "${2:-}"
    ;;
  --help|-h|help)
    usage
    ;;
  "")
    usage
    die "No command specified."
    ;;
  *)
    usage
    die "Unknown command '${COMMAND}'. Use 'web' or 'cli'."
    ;;
esac
