// Single source of truth for the product changelog, surfaced through three
// aligned surfaces: the /changelog web page, GET /api/changelog, and `bk
// changelog`. All three read from the two authored Markdown files in docs/:
//
//   docs/platform-reference.md — the pinned "Platform Reference (baseline)":
//     a complete snapshot of the API + CLI surface, data types, rules, and
//     warnings at the current release. This is what an agent reads to bring an
//     outdated skill fully up to date in one pass.
//   docs/api-changelog.md      — the dated, newest-first log of every change
//     since the baseline. Each entry is a `## YYYY-MM-DD — Title` section.
//
// The files are the editable source; this module reads, parses, and renders
// them. They are bundled into the serverless output via next.config.js
// (outputFileTracingIncludes) so the reads work in production too.
//
// Part of the API multi-surface sync contract (see CLAUDE.md): every change to
// a route or user-facing feature must add a dated entry to docs/api-changelog.md
// (and update docs/platform-reference.md if the surface itself changed).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { CLI_LATEST_VERSION, CLI_MIN_VERSION } from './cli-version'

const DOCS_DIR = join(process.cwd(), 'docs')

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
  /** The pinned baseline reference (docs/platform-reference.md). */
  reference: { markdown: string; html: string }
  /** Dated changes since the baseline, newest first (docs/api-changelog.md). */
  entries: ChangelogEntry[]
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
  const referenceMd = readFileSync(join(DOCS_DIR, 'platform-reference.md'), 'utf8')
  const logMd = readFileSync(join(DOCS_DIR, 'api-changelog.md'), 'utf8')
  cached = {
    cli_latest_version: CLI_LATEST_VERSION,
    cli_min_version: CLI_MIN_VERSION,
    reference: { markdown: referenceMd, html: render(referenceMd) },
    entries: parseEntries(logMd),
  }
  return cached
}

// The raw concatenated Markdown (reference first, then the dated log) — used by
// GET /api/changelog?format=markdown and `bk changelog --full` so a client can
// grab the whole thing as one document.
export function getChangelogMarkdown(): string {
  const referenceMd = readFileSync(join(DOCS_DIR, 'platform-reference.md'), 'utf8')
  const logMd = readFileSync(join(DOCS_DIR, 'api-changelog.md'), 'utf8')
  return `${referenceMd.trim()}\n\n${logMd.trim()}\n`
}
