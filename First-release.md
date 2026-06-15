# First Production Release

Steps to take ownership of the project, move it to your own Git, deploy to Vercel, and distribute the CLI.

---

## ✅ Step 1 — Create your GitHub repo (DONE)

```bash
# In the project root
git remote remove origin
# Create a new repo on github.com (e.g. balathanusan-bc/blackcode-issues), then:
git remote add origin git@github.com:balathanusan-bc/blackcode-issues.git
git push -u origin main
git push origin feature/frontend-improvements   # push current branch too
```

---

## ✅ Step 2 — Update the Go module path (DONE)

Find and replace `mustneerar7/blackcode-issues` → `balathanusan-bc/blackcode-issues` across all Go files and the Makefile:

```bash
cd cli
# go.mod
sed -i '' 's|mustneerar7/blackcode-issues|balathanusan-bc/blackcode-issues|g' go.mod
# all .go files
find . -name "*.go" -exec sed -i '' 's|mustneerar7/blackcode-issues|balathanusan-bc/blackcode-issues|g' {} +
# Makefile
sed -i '' 's|mustneerar7/blackcode-issues|balathanusan-bc/blackcode-issues|g' Makefile
# verify it builds
go build ./cmd/bk
```

---

## ✅ Step 3 — Provision a Postgres database (DONE)

Use [Neon](https://neon.tech) (free tier, works great with Vercel):
1. Create account → New project → copy the `DATABASE_URL` connection string.

---

## ✅ Step 4 — Generate secrets (DONE)

```bash
openssl rand -base64 32   # → your NEXTAUTH_SECRET
```

---

## ✅ Step 5 — Deploy to Vercel via terminal (DONE)

```bash
npm i -g vercel
vercel login

# from project root:
vercel        # first run — links/creates project, deploys preview
vercel --prod # deploys to production URL
```

During the first `vercel` run it will ask you to configure the project. Accept defaults for Next.js.

---

## ✅ Step 6 — Set environment variables in Vercel (DONE)

```bash
vercel env add DATABASE_URL         # paste your Neon connection string
vercel env add NEXTAUTH_SECRET      # paste the openssl output
vercel env add NEXTAUTH_URL         # https://your-deployment.vercel.app
vercel env add SUPER_ADMINS         # balathanusan@blackcode.ch
# Optional but recommended:
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add RESEND_API_KEY
vercel env add RESEND_FROM_EMAIL
vercel env add BLOB_READ_WRITE_TOKEN
```

Then redeploy to pick them up:

```bash
vercel --prod
```

---

## ✅ Step 7 — Run database migrations (DONE)

```bash
# from project root, with your production DATABASE_URL:
DATABASE_URL="your-neon-url" npm run db:migrate
```

---

## ✅ Step 8 — Distribute the CLI via GitHub Releases (DONE)

CLI is published to npm as `@blackcode_sa/bc-issues` and installed globally:

```bash
npm install -g @blackcode_sa/bc-issues
bk login --server https://bc-issues.vercel.app
```

For future CLI releases use the release script — it handles everything automatically:

```bash
./devops/release.sh cli patch   # bug fix
./devops/release.sh cli minor   # new feature
./devops/release.sh cli major   # breaking change
```

See `docs/devops.md` for the full release workflow.

---

## ✅ Step 9 — Verify (DONE)

```bash
./bk login --server https://your-deployment.vercel.app
./bk whoami
```

---

## Order that matters

Step 3 (DB) → Step 6 (env vars) → Step 7 (migrations) → Step 5/6 redeploy. Everything else can be done in any order.

---

## Pending / Post-release TODOs

### Optional environment variables (add via `vercel env add <NAME> production`)

| Variable | Purpose | Impact if missing |
|---|---|---|
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth sign-in button | Only email/password login available |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Transactional email (invitations, password reset) | Invitations work via in-app inbox only; password reset disabled |
| `BLOB_READ_WRITE_TOKEN` | File/image uploads in production | Uploads fall back to local `public/uploads/` — broken in serverless |

After adding any env var, redeploy: `vercel --prod`

### Infrastructure

- [ ] **Custom domain** — currently live at `https://bc-issues.vercel.app`. When you have a domain, add it in Vercel dashboard → Settings → Domains, then update `NEXTAUTH_URL` env var to match.
- [ ] **Vercel ↔ GitHub org access** — Vercel couldn't auto-link to `blackcode-switzerland` org during deploy. Fix in GitHub → Settings → Applications → Vercel → grant access to `blackcode-switzerland`. This enables auto-deploy on every push to `main`.
- [ ] **Blob storage** — Add `BLOB_READ_WRITE_TOKEN` via Vercel Storage → Blob → Create, then link to `bc-issues` project. Required for file uploads to work in production.

### CLI

- [ ] **Future releases** — use `./devops/release.sh cli patch|minor|major`. See `docs/devops.md`.
- [ ] **`bk version`** shows `dev` for local builds — only shows the real version when built via `make dist` with a git tag.
