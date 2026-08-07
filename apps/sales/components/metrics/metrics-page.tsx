'use client'

// Metrics — where the money is, and how the last N days went.
//
// ── COMPUTED IN SQL, NEVER STORED (D-33) ────────────────────────────────────
// The mockup calls these "stored aggregates" because a static HTML file has no
// other option; that is a constraint of the artefact, not a design position.
// `SUM(value) GROUP BY stage` is arithmetic over rows this app already holds —
// the same class of thing as counting how many prospects are in a stage, which
// nobody would propose storing. Storing it would create a second number that can
// disagree with the first, and a stale pipeline total is worse than a slow one
// at a scale where nothing is slow.
//
// What stays agent-computed is JUDGEMENT: which product suits this client, which
// message to lead with. That is `sales.matches`, and it is on the prospect page.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE CHART-KIT CALL (D-12, narrowed 2026-08-06)
// ═══════════════════════════════════════════════════════════════════════════
// **`KpiCard` from `@blackcode/platform-ui/charts`: used.** It takes
// `value: number | string`, so passing an already-formatted Swiss string
// bypasses its internal formatter entirely and it renders this app's numbers
// correctly with no change to the package.
//
// **The stage funnel: built here, and the reason is specific rather than
// aesthetic.** The kit's `HorizontalBars` calls its own `formatNumber` on every
// value, and that function is `Intl.NumberFormat('en-US')` with compact notation
// above 10,000 — so `105000` renders as **`105K`**. This funnel's entire content
// is CHF amounts, and `CHF 105’000` is the exact figure the stakeholder
// validated; a compacted US-formatted number is wrong twice over. `HorizontalBars`
// exposes no formatter prop, so there is no way to use it correctly here.
//
// **And I did not add one.** Widening a shared component to fit one app's
// rendering is how a two-app package becomes a four-app liability
// (`packages/platform-*` is used by everybody), and D-31 settles it the other
// way: if the shared kit does not do what one page needs, that app builds its
// own, with no shared change and nobody's permission. The bar below is twenty
// lines and it reads `lib/pipeline.ts` for its colours, which the shared one
// would have had to be told anyway.

import { useState } from 'react'
import { KpiCard } from '@blackcode/platform-ui/charts'
import { BlockSkeleton, ErrorState } from '@/components/states'
import { useMetrics, usePipeline } from '@/lib/hooks'
import { money } from '@/lib/format'
import { STAGES, stageColor, stageLabel } from '@/lib/pipeline'

/** Spans offered. The route parses `period` by SHAPE, so these are not a vocabulary. */
const PERIODS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
]

export function MetricsPage({ ws }: { ws: string }) {
  const [period, setPeriod] = useState('30d')
  const pipeline = usePipeline(ws)
  const metrics = useMetrics(ws, period)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pipeline by stage
        </h3>
        {pipeline.isPending ? (
          <BlockSkeleton rows={3} />
        ) : pipeline.error ? (
          <ErrorState error={pipeline.error} />
        ) : (
          <div className="rounded-2xl border border-border bg-card px-5 py-5">
            <Funnel
              stages={pipeline.data.stages}
              currency={pipeline.data.currency}
            />
            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-4 text-sm">
              <Total label="Open" data={pipeline.data.open} currency={pipeline.data.currency} />
              <Total label="Won" data={pipeline.data.won} currency={pipeline.data.currency} />
              <Total label="Lost" data={pipeline.data.lost} currency={pipeline.data.currency} />
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Performance
          </h3>
          <div className="ml-auto flex items-center rounded-lg border border-border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                aria-pressed={period === p.value}
                className={
                  'rounded-md px-2.5 py-1 text-xs transition-colors ' +
                  (period === p.value
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {metrics.isPending ? (
          <BlockSkeleton rows={2} />
        ) : metrics.error ? (
          <ErrorState error={metrics.error} />
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
            <KpiCard
              label="Win rate"
              // `win_rate` is NULL rather than 0 when nothing closed, and that
              // distinction is why it is nullable: "we closed nothing" and "we
              // lost everything" are not the same month, and a 0% meaning the
              // first is a number somebody will act on. Rendered as a dash.
              value={metrics.data.closed.win_rate != null ? `${metrics.data.closed.win_rate}%` : '—'}
              hint={`${metrics.data.closed.won.count} won · ${metrics.data.closed.lost.count} lost`}
              accent="var(--chart-1)"
            />
            <KpiCard
              label="Won"
              value={money(metrics.data.closed.won.value, metrics.data.currency)}
              hint={
                metrics.data.closed.average_won
                  ? `avg ${money(metrics.data.closed.average_won, metrics.data.currency)}`
                  : 'nothing won yet'
              }
              accent="var(--chart-2)"
            />
            <KpiCard
              label="Created"
              value={money(metrics.data.created.value, metrics.data.currency)}
              hint={`${metrics.data.created.count} new prospects`}
              accent="var(--chart-3)"
            />
            <KpiCard
              label="Activity"
              value={metrics.data.activity.communications + metrics.data.activity.meetings}
              hint={`${metrics.data.activity.communications} exchanges · ${metrics.data.activity.meetings} meetings`}
              accent="var(--chart-4)"
            />
          </div>
        )}
      </section>
    </div>
  )
}

function Total({
  label,
  data,
  currency,
}: {
  label: string
  data: { count: number; value: string }
  currency: string
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 tabular-nums text-foreground">{money(data.value, currency)}</p>
      <p className="text-xs text-muted-foreground">
        {data.count} {data.count === 1 ? 'deal' : 'deals'}
      </p>
    </div>
  )
}

/**
 * The funnel.
 *
 * **Every stage appears, including the empty ones, in pipeline order.** That is
 * the rule `pipeline()` applies server-side and this renders faithfully: a
 * funnel that silently omits the stage nobody is in hides the thing worth
 * noticing — a pipeline with nothing in `negotiation` is a fact about the month.
 *
 * Bar length is by VALUE, with the count beside it. Colours come from
 * `lib/pipeline.ts` and nowhere else.
 */
function Funnel({
  stages,
  currency,
}: {
  stages: { stage: string; count: number; value: string }[]
  currency: string
}) {
  const ceiling = Math.max(1, ...stages.map((s) => Number(s.value)))
  // Ordered by `STAGES` rather than by whatever the server returned, so the
  // funnel reads top-to-bottom as the pipeline runs even if the shape changes.
  const ordered = STAGES.map((s) => stages.find((x) => x.stage === s.value)).filter(
    (s): s is { stage: string; count: number; value: string } => s != null
  )

  return (
    <ul className="space-y-3">
      {ordered.map((s) => {
        const value = Number(s.value)
        return (
          <li key={s.stage}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: stageColor(s.stage) }}
                  aria-hidden
                />
                <span className="truncate text-foreground">{stageLabel(s.stage)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {s.count} {s.count === 1 ? 'deal' : 'deals'}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {money(s.value, currency)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  // A stage with rows but no value still shows a sliver, so
                  // "three deals worth nothing yet" is visible rather than
                  // indistinguishable from an empty stage.
                  width: `${value > 0 ? Math.max(2, (value / ceiling) * 100) : s.count > 0 ? 2 : 0}%`,
                  backgroundColor: stageColor(s.stage),
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
