const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Monorepo: this app lives at apps/issues, but it reads and bundles files from
  // the repo root (docs/). Next must be told where the workspace root is, or it
  // infers it from the nearest lockfile and refuses to trace files above the app.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // The platform packages ship TypeScript source, not a build step — Next
  // compiles them as part of this app. Adding a package to apps/issues/package.json
  // is not enough; it must be listed here too or the build fails on `.ts` syntax.
  transpilePackages: [
    '@blackcode/platform-db',
    '@blackcode/platform-api',
    '@blackcode/platform-auth',
    '@blackcode/platform-agent',
    '@blackcode/platform-ui',
  ],

  // The changelog API reads the authored Markdown in the ROOT docs/ at runtime
  // (lib/changelog.ts). Trace that file into the serverless bundle so the reads
  // work in production, not just in local dev. Paths are relative to this app
  // directory, so ../../ reaches the repo root — keep in step with DOCS_DIR in
  // lib/changelog.ts.
  outputFileTracingIncludes: {
    // A glob, not a list: Phase 5 split the log into one file per app plus
    // platform.md, and lib/changelog.ts discovers them by reading the directory.
    // Naming files here individually would mean a new app's changelog builds
    // locally and 500s in production, which is the failure only a real deploy
    // catches.
    '/api/changelog': ['../../docs/changelog/*.md'],
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
