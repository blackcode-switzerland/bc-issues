# Environment variables

Copy the relevant values into **`apps/issues/.env.local`** for local development,
or set them in the Vercel dashboard for production. Only three are required; the
rest unlock optional integrations and the app runs fine without them.

> The file lives in the app workspace, not the repo root — Next and
> `drizzle.config.ts` resolve it relative to `apps/issues/`.
>
> **Never set `RUN_MIGRATIONS` locally.** It gates the `postbuild` migration and
> belongs only in Vercel Production; see `docs/env.md`.

## Required

```env
# Postgres connection string. The bundled docker-compose serves this on :5434.
DATABASE_URL=postgres://blackcode:blackcode_dev@localhost:5434/blackcode_issues

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
```

## Optional integrations

```env
# Google OAuth — enables the "Continue with Google" button. If unset, only
# email/password sign-in is available. (Both vars must be set to enable it.)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Super admin — comma-separated emails granted super admin access at
# /dashboard/super-admin. When set, the whitelist feature activates: only
# whitelisted emails/domains + these super admins can register or sign in
# via Google OAuth. If unset, no whitelist enforcement and no super admin UI.
SUPER_ADMINS=admin@yourdomain.com

# Resend — transactional email (workspace invitations + password-reset codes).
# If unset, the app still works: invitations fall back to the in-app inbox +
# copyable accept links, and password reset is unavailable until configured.
# Both vars must be set; RESEND_FROM_EMAIL must be on a domain verified in Resend.
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=admin@issues.blackcode.ch

# Vercel Blob — file/image uploads in production. If unset, uploads are written
# to the local `public/uploads/` directory (fine for dev).
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

## Production (Vercel)

```env
NEXTAUTH_URL=https://your-deployment.vercel.app
NEXTAUTH_SECRET=your-production-secret
DATABASE_URL=postgres://…           # your hosted Postgres
# plus any optional integrations above

# Deliberately NOT set: PLATFORM_ENFORCE_APP_ACCESS. Unset means per-app access
# IS enforced, which is what you want. Set it to 0 only to switch enforcement
# off in an emergency — see docs/env.md.
```

After setting `DATABASE_URL`, run the migrations against that database:

```bash
npm run db:migrate
```

## Generate `NEXTAUTH_SECRET`

```bash
openssl rand -base64 32
```
