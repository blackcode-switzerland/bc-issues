# Environment variables

Copy the relevant values into `.env.local` for local development, or set them in
the Vercel dashboard for production. Only three are required; the rest unlock
optional integrations and the app runs fine without them.

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

# Resend — transactional email (workspace invitations + password-reset codes).
# If unset, the app still works: invitations fall back to the in-app inbox +
# copyable accept links, and password reset is unavailable until configured.
# Both vars must be set; RESEND_FROM_EMAIL must be on a domain verified in Resend.
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=invites@yourdomain.com

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
```

After setting `DATABASE_URL`, run the migrations against that database:

```bash
npm run db:migrate
```

## Generate `NEXTAUTH_SECRET`

```bash
openssl rand -base64 32
```
