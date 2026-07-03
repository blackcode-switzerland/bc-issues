// Public changelog page. Server-rendered from docs/platform-reference.md +
// docs/api-changelog.md via lib/changelog.ts. Layout: a pinned "Platform
// Reference (baseline)" the reader can collapse, then the dated log newest-first.
//
// The same content is available programmatically at GET /api/changelog and via
// `bk changelog` — this page just renders it for humans.

import type { Metadata } from 'next'
import { MarketingLayout } from '@/components/marketing/layout'
import { getChangelog } from '@/lib/changelog'

export const metadata: Metadata = {
  title: 'Changelog · Blackcode Issues',
  description:
    'Every change to the Blackcode Issues API and bk CLI, newest first — plus a complete platform reference. Also available at /api/changelog and via `bk changelog`.',
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
  const { reference, entries, cli_latest_version, cli_min_version } = getChangelog()

  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <header className="mb-10">
          <div className="text-xs font-medium uppercase tracking-wider text-primary">Changelog</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">What&apos;s changed</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Every notable change to the REST API and the <code>bk</code> CLI, newest first. Building
            an integration or an agent skill? Read the platform reference below to get current, then
            check back here for anything new. This page is also available as JSON at{' '}
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
            Current: API v1.1.0 · CLI latest v{cli_latest_version} · minimum supported v{cli_min_version}
          </p>
        </header>

        {/* Pinned baseline reference — open by default, collapsible to keep the
            dated log reachable. */}
        <details open className="mb-14 rounded-lg border border-border/60 bg-muted/30">
          <summary className="cursor-pointer select-none list-none px-5 py-4 text-sm font-medium">
            <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Baseline
            </span>
            Platform Reference — the complete API + CLI surface
            <span className="ml-2 text-xs font-normal text-muted-foreground">(click to collapse)</span>
          </summary>
          <div
            className="prose max-w-none border-t border-border/60 px-5 py-6 text-sm leading-relaxed text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: reference.html }}
          />
        </details>

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
