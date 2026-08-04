const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Monorepo: this app lives at apps/issues, but it reads and bundles files from
  // the repo root (docs/). Next must be told where the workspace root is, or it
  // infers it from the nearest lockfile and refuses to trace files above the app.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The changelog API reads the authored Markdown in the ROOT docs/ at runtime
  // (lib/changelog.ts). Trace that file into the serverless bundle so the reads
  // work in production, not just in local dev. Paths are relative to this app
  // directory, so ../../ reaches the repo root — keep in step with DOCS_DIR in
  // lib/changelog.ts.
  outputFileTracingIncludes: {
    '/api/changelog': ['../../docs/api-changelog.md'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'blackcode-issues.vercel.app'],
    },
  },
}

module.exports = nextConfig
