// GET /api/changelog — the product changelog, public and unauthenticated so any
// client (or an outdated agent skill) can read how the platform has changed.
//
// Default (JSON):
//   { cli_latest_version, cli_min_version,
//     reference: { markdown, html },              // the pinned baseline
//     entries: [{ date, title, markdown, html }]  // dated log, newest first
//   }
// ?format=markdown (or Accept: text/markdown) returns the whole thing as one
// raw Markdown document.
//
// Source of truth is docs/platform-reference.md + docs/api-changelog.md, read
// via lib/changelog.ts. Part of the API multi-surface sync contract.

import { NextRequest, NextResponse } from 'next/server'
import { getChangelog, getChangelogMarkdown } from '@/lib/changelog'

export function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format')
  const wantsMarkdown =
    format === 'markdown' ||
    format === 'md' ||
    (request.headers.get('accept') ?? '').includes('text/markdown')

  if (wantsMarkdown) {
    return new NextResponse(getChangelogMarkdown(), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  return NextResponse.json(getChangelog(), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
