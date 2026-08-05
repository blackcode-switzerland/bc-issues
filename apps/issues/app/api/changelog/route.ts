// GET /api/changelog — the product changelog, public and unauthenticated so any
// client (or an outdated agent skill) can read how the platform has changed.
//
// Default (JSON):
//   { cli_latest_version, cli_min_version,
//     apps: ['platform', 'issues', …],             // sections with a file
//     entries: [{ date, app, title, markdown, html }],  // merged, newest first
//     reference_moved_to                           // see below
//   }
// ?format=markdown (or Accept: text/markdown) returns the log as one raw
// Markdown document.
// ?app=issues filters to one section; an unknown one is a 404 that names the
// valid ones, because "no entries" and "no such app" must not look the same.
//
// The `reference` field is gone: the pinned Platform Reference has been replaced
// by `bk guide`, which ships inside the CLI binary and so always matches the
// version the caller is running. `reference_moved_to` says so explicitly rather
// than letting an old client read `undefined`.
//
// Source of truth is docs/changelog/*.md — one file per app plus platform.md,
// merged by date in @blackcode/platform-agent (packages/platform-agent/src/changelog.ts).

import { NextRequest, NextResponse } from 'next/server'
import { getChangelog, getChangelogFor, getChangelogMarkdown } from '@blackcode/platform-agent'

export function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format')
  const app = request.nextUrl.searchParams.get('app')
  const wantsMarkdown =
    format === 'markdown' ||
    format === 'md' ||
    (request.headers.get('accept') ?? '').includes('text/markdown')

  // This route is public and unauthenticated, so it does not go through
  // apiHandler/Errors — but an agent that mistypes --app still gets the shape it
  // knows how to read, suggestion included.
  const known = getChangelog().apps
  if (app && !known.includes(app.trim().toLowerCase())) {
    return NextResponse.json(
      {
        error: `Unknown app '${app}'`,
        code: 'unknown_app',
        suggestion: `Valid values: ${known.join(', ')}. Omit ?app= for the merged feed.`,
      },
      { status: 404 }
    )
  }

  if (wantsMarkdown) {
    return new NextResponse(getChangelogMarkdown(app) ?? '', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
  }

  return NextResponse.json(getChangelogFor(app), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
