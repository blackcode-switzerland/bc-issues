# DevOps & Release Guide

All release operations are handled by a single script:

```bash
./devops/release.sh <command>
```

---

## Commands

### Deploy web app to production

```bash
./devops/release.sh web
```

Runs preflight checks (Vercel auth, git branch, clean working tree), then deploys to Vercel production.

- **Production URL**: https://bc-issues.vercel.app
- **Dashboard**: https://vercel.com/balathanusans-projects-f76f8a7b/bc-issues

### Release CLI to GitHub + npm

```bash
./devops/release.sh cli patch    # bug fix:        v1.0.0 → v1.0.1
./devops/release.sh cli minor    # new feature:    v1.0.0 → v1.1.0
./devops/release.sh cli major    # breaking change: v1.0.0 → v2.0.0
./devops/release.sh cli v1.2.3  # explicit version (optional)
```

The version is auto-resolved from the latest git tag — you never need to type a version number manually.

Full CLI release pipeline:
1. Preflight — checks gh auth, npm auth, git branch, clean tree, no duplicate tag/version
2. Resolves the next version from the latest git tag + bump type
3. Bumps version in `cli/npm/package.json` and `cli/npm/install.js`
4. Commits + pushes the version bump to `main`
5. Creates and pushes the git tag
6. Builds binaries for all 6 platforms via `make dist`
7. Creates a GitHub Release and uploads the binaries + `SHA256SUMS`
8. Publishes `@blackcode_sa/bc-issues` to npm (prompts for OTP)

**Have your authenticator app ready** — npm requires a 2FA code during publish.

---

## Prerequisites

| Tool | Install | Auth command |
|---|---|---|
| `vercel` | `npm install -g vercel` | `vercel login` |
| `gh` | `brew install gh` | `gh auth login` |
| `npm` | bundled with Node.js | `npm login` |
| `go` | https://go.dev/dl | — |

---

## Typical bug-fix release workflow

```bash
# 1. Fix the bug, commit to main
git add .
git commit -m "fix: ..."
git push origin main

# 2. Deploy the web fix immediately
./devops/release.sh web

# 3. If the CLI was also changed, cut a new CLI release
./devops/release.sh cli patch
```

---

## Environment variables

All production env vars live in Vercel. To add or update one:

```bash
# Add
vercel env add <NAME> production

# Update (remove then re-add)
vercel env rm <NAME> production --yes
vercel env add <NAME> production

# List all
vercel env ls production
```

After changing env vars, redeploy: `./devops/release.sh web`

### Current production env vars

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `NEXTAUTH_SECRET` | NextAuth signing secret |
| `NEXTAUTH_URL` | `https://bc-issues.vercel.app` |
| `SUPER_ADMINS` | `balathanusan@blackcode.ch` |

### Optional env vars (not yet set)

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth sign-in |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Transactional email (invitations, password reset) |
| `BLOB_READ_WRITE_TOKEN` | File/image uploads in production |

---

## Database migrations

**Local dev** — one command brings the dockerised Postgres up (if needed) and
applies any pending migrations:

```bash
./devops/migrate-local.sh            # start DB + apply migrations
./devops/migrate-local.sh --status   # list migrations already applied
```

Production migrates automatically on deploy (`postbuild` runs `drizzle-kit
migrate`), so the local script is only for keeping your own machine in sync —
e.g. after pulling a branch that adds a migration. To run it manually against
production instead:

```bash
DATABASE_URL="<neon-url>" npm run db:migrate
```

The Neon connection string is in Vercel → Storage → bc-issues → Connection Details.

---

## npm package

- **Package**: `@blackcode_sa/bc-issues`
- **Install**: `npm install -g @blackcode_sa/bc-issues`
- **Binary**: `bk`
- **Registry**: https://www.npmjs.com/package/@blackcode_sa/bc-issues

The npm package is a thin wrapper — on install it downloads the correct pre-built Go binary from the matching GitHub Release for the user's platform.
