// Single source of truth for the product changelog, surfaced two aligned ways:
// `bk changelog` and GET /api/changelog. Both read docs/api-changelog.md — the
// dated, newest-first log of every change. Each entry is a
// `## YYYY-MM-DD — Title` section.
//
// The /changelog web page was removed on 2026-08-03: it had no human audience,
// and a page nobody reads is still a page somebody has to keep honest. The
// changelog is an AGENT surface now.
//
// It used to also serve docs/platform-reference.md, a pinned "complete snapshot
// of the API + CLI surface". That document is gone: a hand-maintained snapshot of
// a surface is a copy, and copies drift — its CLI version was already stale when
// we retired it. The current surface is now described by `bk guide`, which ships
// inside the binary and therefore always matches the binary being run.
//
// So the changelog has exactly one job now: the dated record of what changed.
// For how things WORK, an agent runs `bk guide`; for live values, `bk meta`.
//
// The file is the editable source; this module reads, parses, and renders it. It
// is bundled into the serverless output via next.config.js
// (outputFileTracingIncludes) so the reads work in production too.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from './cli-version'

// The changelog lives at the MONOREPO ROOT (`docs/`), not inside this app —
// architecture §7.3 makes it a platform surface that will merge one file per app
// into a single feed. This app runs with its cwd at `apps/issues`, so walk up two
// levels. `outputFileTracingRoot` + `outputFileTracingIncludes` in next.config.js
// are what carry the file into the serverless bundle; keep the two in step.
const DOCS_DIR = join(process.cwd(), '..', '..', 'docs')

export interface ChangelogEntry {
  /** ISO date `YYYY-MM-DD` parsed from the entry heading (empty if unparseable). */
  date: string
  /** The entry title (the heading text after the date). */
  title: string
  /** The entry body Markdown (without the `## heading` line). */
  markdown: string
  /** The entry body rendered to sanitized HTML. */
  html: string
}

export interface ChangelogPayload {
  /** Newest published CLI; older clients get a soft "update available" notice. */
  cli_latest_version: string
  /** Minimum CLI the API still supports; older clients are hard-blocked. */
  cli_min_version: string
  /** Every dated change, newest first (docs/api-changelog.md). */
  entries: ChangelogEntry[]
  /**
   * Where the retired Platform Reference went. Kept in the payload (rather than
   * silently dropping the field) so a client built against the old shape gets an
   * answer instead of `undefined` — the same reasoning as the 410 stubs.
   */
  reference_moved_to: string
}

// We author the changelog; this is not untrusted user input. We still sanitize
// (defense in depth) with the same tag/attribute whitelist the rich-text layer
// uses, so the rendered HTML can drop straight into a `.prose` container.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark', 'sub', 'sup',
    'code', 'pre',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['id', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
}

// gfm for tables/strikethrough; breaks:false so the hard-wrapped prose in the
// source files renders as flowing paragraphs (not a <br> per wrapped line).
function render(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true, breaks: false }) as string
  return sanitizeHtml(html, SANITIZE_OPTS)
}

// Split the dated log into entries. Everything before the first `## ` heading
// (the file title + intro) is dropped; each `## YYYY-MM-DD — Title` starts a new
// entry, and trailing `---` separators / whitespace are trimmed from each body.
function parseEntries(md: string): ChangelogEntry[] {
  const firstHeading = md.indexOf('\n## ')
  const body = firstHeading >= 0 ? md.slice(firstHeading + 1) : md
  const sections = body.split(/\n(?=## )/g)
  const entries: ChangelogEntry[] = []
  for (const section of sections) {
    const m = section.match(/^##\s+(.+?)\r?\n([\s\S]*)$/)
    if (!m) continue
    const heading = m[1].trim()
    const rest = m[2].replace(/\n+---\s*$/, '').trim()
    const dated = heading.match(/^(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.+)$/)
    entries.push({
      date: dated ? dated[1] : '',
      title: (dated ? dated[2] : heading).trim(),
      markdown: rest,
      html: render(rest),
    })
  }
  return entries
}

// Read once and memoize. In production the files never change under the running
// process; in dev, editing a doc triggers a module reload which clears this.
let cached: ChangelogPayload | null = null

export function getChangelog(): ChangelogPayload {
  if (cached) return cached
  const logMd = readFileSync(join(DOCS_DIR, 'api-changelog.md'), 'utf8')
  cached = {
    cli_latest_version: CLI_LATEST_VERSION,
    cli_min_version: CLI_MIN_VERSION,
    entries: parseEntries(logMd),
    reference_moved_to: 'Run `bk guide` — the complete usage guide, embedded in the CLI binary.',
  }
  return cached
}

// The raw dated log as Markdown — used by GET /api/changelog?format=markdown and
// `bk changelog --full` so a client can grab the whole record as one document.
export function getChangelogMarkdown(): string {
  return `${readFileSync(join(DOCS_DIR, 'api-changelog.md'), 'utf8').trim()}\n`
}
