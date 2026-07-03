/** @type {import('next').NextConfig} */
const nextConfig = {
  // The changelog page + API read the authored Markdown in docs/ at runtime
  // (lib/changelog.ts). Trace those files into the serverless bundle so the
  // reads work in production, not just in local dev.
  outputFileTracingIncludes: {
    '/changelog': ['./docs/platform-reference.md', './docs/api-changelog.md'],
    '/api/changelog': ['./docs/platform-reference.md', './docs/api-changelog.md'],
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

