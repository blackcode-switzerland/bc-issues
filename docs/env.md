# Environment Variables Guide

All production env vars live in Vercel. This guide covers where each one comes from, how to set or update it, and what breaks if it's missing.

**Quick commands:**
```bash
vercel env ls production                          # list all
vercel env add <NAME> production --value "..." --yes   # add
vercel env rm <NAME> production --yes             # remove
# then redeploy:
./devops/release.sh web
```

---

## DATABASE_URL

| | |
|---|---|
| **Purpose** | PostgreSQL connection string — the app's primary database |
| **Status** | Set ✓ |
| **Source** | Neon (via Vercel Storage integration) |
| **Impact if missing** | App crashes on startup — nothing works |

**Where to find it:**
Vercel dashboard → Storage → `bc-issues` (Neon) → Connection Details → copy `DATABASE_URL` (pooled connection).

**How to update:**
Only needed if you migrate to a different database. Remove old value, add new:
```bash
vercel env rm DATABASE_URL production --yes
vercel env add DATABASE_URL production --value "<new-url>" --yes
./devops/release.sh web
```

After changing, always run migrations against the new DB:
```bash
DATABASE_URL="<new-url>" npm run db:migrate
```

---

## NEXTAUTH_SECRET

| | |
|---|---|
| **Purpose** | Signs and encrypts NextAuth session tokens |
| **Status** | Set ✓ |
| **Source** | Generated with `openssl rand -base64 32` |
| **Impact if missing** | All authentication breaks — no one can log in |

**How to regenerate** (e.g. if compromised — invalidates all active sessions):
```bash
openssl rand -base64 32   # copy the output
vercel env rm NEXTAUTH_SECRET production --yes
vercel env add NEXTAUTH_SECRET production --value "<new-secret>" --yes
./devops/release.sh web
```

---

## NEXTAUTH_URL

| | |
|---|---|
| **Purpose** | The app's public URL — used by NextAuth for OAuth callbacks and redirects |
| **Status** | Set ✓ — `https://bc-issues.vercel.app` |
| **Source** | Your deployment URL |
| **Impact if missing** | OAuth sign-in (Google) breaks; redirect loops |

**How to update when you get a custom domain:**
```bash
vercel env rm NEXTAUTH_URL production --yes
vercel env add NEXTAUTH_URL production --value "https://yourdomain.com" --yes
./devops/release.sh web
```

Also update Google OAuth (see `GOOGLE_CLIENT_ID` section below).

---

## SUPER_ADMINS

| | |
|---|---|
| **Purpose** | Comma-separated emails with super admin access at `/dashboard/super-admin` |
| **Status** | Set ✓ — `balathanusan@blackcode.ch,andrea@blackcode.ch` |
| **Source** | Manual — your admin email(s) |
| **Impact if missing** | No super admin UI; whitelist enforcement disabled |

**How to add more admins:**
```bash
vercel env rm SUPER_ADMINS production --yes
vercel env add SUPER_ADMINS production --value "admin1@example.com,admin2@example.com" --yes
./devops/release.sh web
```

---

## GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET

| | |
|---|---|
| **Purpose** | Enables "Continue with Google" OAuth sign-in button |
| **Status** | Set ✓ |
| **Source** | Google Cloud Console → Project `Blackcode-issues` → APIs & Services → Credentials → OAuth 2.0 Client `bc-issues` |
| **Impact if missing** | Google sign-in button hidden; only email/password login available |

**Where to find credentials:**
[console.cloud.google.com](https://console.cloud.google.com) → select project `Blackcode-issues` → APIs & Services → Credentials → click `bc-issues` client → copy Client ID and Client Secret.

**How to update if credentials are rotated:**
```bash
vercel env rm GOOGLE_CLIENT_ID production --yes
vercel env rm GOOGLE_CLIENT_SECRET production --yes
vercel env add GOOGLE_CLIENT_ID production --value "<id>" --yes
vercel env add GOOGLE_CLIENT_SECRET production --value "<secret>" --yes
./devops/release.sh web
```

**When you switch to a custom domain** — no new OAuth client needed, just update the existing one:
1. Go to Google Cloud Console → Credentials → click `bc-issues` client
2. Under **Authorized JavaScript origins** → add `https://yourdomain.com`
3. Under **Authorized redirect URIs** → add `https://yourdomain.com/api/auth/callback/google`
4. Save (takes up to a few hours to propagate)
5. Update `NEXTAUTH_URL` (see above) and redeploy

---

## BLOB_READ_WRITE_TOKEN

| | |
|---|---|
| **Purpose** | Enables file/image uploads via Vercel Blob storage |
| **Status** | Set ✓ — auto-injected via Vercel Storage integration |
| **Source** | Vercel dashboard → Storage → `bc-issues-blob` (Blob) |
| **Impact if missing** | All file uploads return 500 error in production |

**Where to find it:**
Vercel dashboard → Storage → `bc-issues-blob` → Settings → Tokens → `BLOB_READ_WRITE_TOKEN`.

**How to regenerate** (e.g. if compromised):
1. Vercel dashboard → Storage → `bc-issues-blob` → Settings → Tokens → Create new token
2. Update the env var:
```bash
vercel env rm BLOB_READ_WRITE_TOKEN production --yes
vercel env add BLOB_READ_WRITE_TOKEN production --value "<new-token>" --yes
./devops/release.sh web
```

---

## RESEND_API_KEY + RESEND_FROM_EMAIL *(not yet set)*

| | |
|---|---|
| **Purpose** | Transactional email — workspace invitations and password reset codes |
| **Status** | Not set — invitations fall back to in-app inbox; password reset unavailable |
| **Source** | [resend.com](https://resend.com) |
| **Impact if missing** | No email delivery; password reset disabled |

**How to set up:**
1. Create account at [resend.com](https://resend.com)
2. Add and verify your sending domain
3. API Keys → Create API Key → copy it
4. Set both vars:
```bash
vercel env add RESEND_API_KEY production --value "re_..." --yes
vercel env add RESEND_FROM_EMAIL production --value "noreply@yourdomain.com" --yes
./devops/release.sh web
```

`RESEND_FROM_EMAIL` must be on a domain verified in Resend — `onboarding@resend.dev` works for testing only.

---

## Local development

Copy the following into `.env.local` in the project root (never commit this file):

```env
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=any-random-string-for-local-dev
SUPER_ADMINS=balathanusan@blackcode.ch

# Optional — omit to use local file fallback for uploads
# BLOB_READ_WRITE_TOKEN=

# Optional — omit to disable Google sign-in locally
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
```

Start the local Postgres with `docker compose up -d`, then `npm run dev`.
