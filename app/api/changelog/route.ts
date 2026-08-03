// GET /api/changelog — the product changelog, public and unauthenticated so any
// client (or an outdated agent skill) can read how the platform has changed.
//
// Default (JSON):
//   { cli_latest_version, cli_min_version,
//     entries: [{ date, title, markdown, html }],  // dated log, newest first
//     reference_moved_to                           // see below
//   }
// ?format=markdown (or Accept: text/markdown) returns the log as one raw
// Markdown document.
//
// The `reference` field is gone: the pinned Platform Reference has been replaced
// by `bk guide`, which ships inside the CLI binary and so always matches the
// version the caller is running. `reference_moved_to` says so explicitly rather
// than letting an old client read `undefined`.
//
// Source of truth is docs/api-changelog.md, read via lib/changelog.ts.

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
