// Public changelog page. Server-rendered from docs/api-changelog.md via
// lib/changelog.ts: the dated log, newest first.
//
// It used to lead with a pinned "Platform Reference" — a complete snapshot of the
// API + CLI surface. That is gone; the current surface is `bk guide`, which ships
// inside the binary and so always matches the version the reader is running. This
// page now answers only "what changed", and points at `bk guide` for "how it works".
//
// The same content is available programmatically at GET /api/changelog and via
// `bk changelog`.

import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'
import { getChangelog } from '@/lib/changelog'

export const metadata: Metadata = {
  title: 'Changelog · Blackcode Issues',
  description:
    'Every change to blackcode issues and the bk CLI, newest first. Also available at /api/changelog and via `bk changelog`.',
}

// Re-read on a schedule so a docs edit (redeploy) shows up without a full
// rebuild of the route graph.
export const revalidate = 300

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export default function ChangelogPage() {
  const { entries, cli_latest_version, cli_min_version } = getChangelog()

  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-10">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">Changelog</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">What&apos;s changed</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Every notable change to blackcode issues and the <code>bk</code> CLI, newest first.
            Looking for how something <em>works</em> rather than what changed? Run{' '}
            <code>bk guide</code> — it is the complete usage guide, embedded in the CLI binary, so it
            always matches the version you have. This page is also available as JSON at{' '}
            <a href="/api/changelog" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              /api/changelog
            </a>{' '}
            and via <code>bk changelog</code>. New to connecting?{' '}
            <a href="/agent-updator" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
              Start here
            </a>
            .
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Current: CLI latest v{cli_latest_version} · minimum supported v{cli_min_version}
          </p>
        </header>

        {/* The retired baseline used to sit here. Replaced by a pointer: a
            snapshot of the surface is a copy, and copies drift. */}
        <div className="mb-14 rounded-lg border border-border/60 bg-muted/30 px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Looking for the Platform Reference?</strong> It has
            been replaced by <code>bk guide</code>, which ships inside the CLI binary — so it
            describes the exact version you are running, and can never tell you about a flag you do
            not have. Run <code>bk guide</code> (offline, no auth needed), or{' '}
            <code>bk meta</code> for the live vocabularies and limits.
          </p>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Dated changes
          </h2>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        <div className="space-y-12">
          {entries.map((e, i) => (
            <section key={`${e.date}-${i}`} className="scroll-mt-20">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {e.date && (
                  <time dateTime={e.date} className="font-mono text-xs text-muted-foreground">
                    {formatDate(e.date)}
                  </time>
                )}
                <h3 className="text-base font-semibold tracking-tight text-foreground">{e.title}</h3>
              </div>
              <div
                className="prose max-w-none text-sm leading-relaxed text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: e.html }}
              />
            </section>
          ))}
        </div>
      </article>
    </MarketingLayout>
  )
}
