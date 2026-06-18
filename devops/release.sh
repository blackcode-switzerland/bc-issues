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
  $(basename "$0") cli [bump]         Release CLI to GitHub Releases + npm.
                                      Omit [bump] to be prompted; also asks
                                      force-vs-normal upgrade and whether to
                                      deploy web, then updates lib/cli-version.ts.
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

  # Interactive bump selection if not passed as an argument.
  if [[ -z "$bump" ]]; then
    echo
    header "Version bump"
    echo "  1) patch     bug fix          (v1.0.0 → v1.0.1)"
    echo "  2) minor     new feature      (v1.0.0 → v1.1.0)"
    echo "  3) major     breaking change  (v1.0.0 → v2.0.0)"
    echo "  4) explicit  type an exact vX.Y.Z"
    local choice
    read -r -p "Select [1-4]: " choice
    case "$choice" in
      1) bump="patch" ;;
      2) bump="minor" ;;
      3) bump="major" ;;
      4) read -r -p "Version (vX.Y.Z): " bump ;;
      *) die "Invalid selection '${choice}'." ;;
    esac
  fi

  local version
  version=$(resolve_version "$bump")
  local version_number="${version#v}"   # strip leading 'v' for package.json

  # Upgrade policy — drives the server version gate (lib/cli-version.ts):
  #   normal → CLI_LATEST advertises the new version (soft "update available").
  #   forced → also raise CLI_MIN so older CLIs are hard-blocked (exit code 8).
  echo
  header "Upgrade policy"
  echo "  normal — advertise ${version} as latest; older CLIs get a soft update notice."
  echo "  forced — also raise CLI_MIN to ${version}; older CLIs are blocked until they upgrade."
  local force_ans forced=false
  read -r -p "Force upgrade? [y/N] " force_ans
  if [[ "$force_ans" =~ ^[Yy]$ ]]; then forced=true; fi

  # The version gate lives in the web app, so it only takes effect once web is
  # redeployed — offer to do that at the end.
  echo
  local web_ans deploy_web=false
  read -r -p "Deploy web to production after the release? [y/N] " web_ans
  if [[ "$web_ans" =~ ^[Yy]$ ]]; then deploy_web=true; fi

  # Confirm before anything irreversible (commit / tag / publish).
  echo
  header "Release plan"
  echo -e "  CLI version:  ${BOLD}${version}${RESET}"
  if [[ "$forced" == true ]]; then
    echo -e "  Policy:       ${BOLD}FORCED${RESET} — sets CLI_LATEST and CLI_MIN to ${version}"
  else
    echo -e "  Policy:       normal — sets CLI_LATEST to ${version} (CLI_MIN unchanged)"
  fi
  echo -e "  Deploy web:   $([[ "$deploy_web" == true ]] && echo yes || echo no)"
  local go
  read -r -p "Proceed? [y/N] " go
  [[ "$go" =~ ^[Yy]$ ]] || die "Aborted."
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
  # Fail fast on Vercel auth now if we'll deploy web at the end.
  if [[ "$deploy_web" == true ]]; then check_vercel_auth; fi

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

  # Update the server-side version gate now so it lands in the SAME commit as the
  # bump (one commit, then the tag/build/publish come from it). CLI_LATEST always;
  # CLI_MIN only when forced.
  local cli_version_ts="${root_dir}/lib/cli-version.ts"
  sed -i '' -E "s/(CLI_LATEST_VERSION = process\.env\.BK_CLI_LATEST \?\? ')[^']*'/\1${version_number}'/" "$cli_version_ts"
  success "CLI_LATEST_VERSION → ${version_number}"
  if [[ "$forced" == true ]]; then
    sed -i '' -E "s/(CLI_MIN_VERSION = process\.env\.BK_CLI_MIN \?\? ')[^']*'/\1${version_number}'/" "$cli_version_ts"
    success "CLI_MIN_VERSION → ${version_number} (forced)"
  fi

  # Single release commit: package bump + install.js + version gate.
  info "Committing release ${version}..."
  git add "$pkg_json" "$install_js" "$cli_version_ts"
  git commit -m "chore: release CLI ${version}$([[ "$forced" == true ]] && echo ' (forced min)')"
  git push origin main
  success "Pushed release commit."

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

  # deploy web if requested, so the version gate (already committed above) goes live
  if [[ "$deploy_web" == true ]]; then
    release_web
  else
    warn "Web NOT deployed — the version gate takes effect only after: $(basename "$0") web"
  fi

  # summary
  echo
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${GREEN}${BOLD}  CLI ${version} released successfully!${RESET}"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  GitHub:  https://github.com/${repo}/releases/tag/${version}"
  echo -e "  npm:     https://www.npmjs.com/package/${npm_package}"
  echo -e "  Install: npm install -g ${npm_package}"
  echo
  if [[ "$forced" == true ]]; then
    echo -e "  Version gate: CLI_LATEST=${version_number} · CLI_MIN=${version_number} (committed)"
  else
    echo -e "  Version gate: CLI_LATEST=${version_number} (committed)"
  fi
  if [[ "$deploy_web" != true ]]; then
    warn "Run '$(basename "$0") web' to make the version gate live."
  fi
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
