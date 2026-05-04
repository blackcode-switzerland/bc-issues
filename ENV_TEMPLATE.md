# Environment Variables for Blackcode Issues

Copy these to your `.env.local` file for local development,
or set them in Vercel Dashboard for production.

## Required Variables

```env
# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=262959577842-vubdf9h4gvuepqsvk6ehpk9clsmnep5n.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-from-downloaded-json

# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32

# Database (Local Development)
POSTGRES_URL=postgres://postgres:postgres@localhost:5433/postgres
```

## Production (Vercel)

```env
NEXTAUTH_URL=https://blackcode-issues.vercel.app
NEXTAUTH_SECRET=your-production-secret
# Vercel Postgres auto-injects the DB vars
```

## Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

