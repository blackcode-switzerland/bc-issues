'use client'

// Printable analytics report. Fetches the same payload as the on-screen
// dashboard (forwarding every filter via `query`) and lays it out for paper:
// a header, KPI grid, velocity + cumulative charts, distributions, cycle-time
// and aging histograms, and an optional milestone burndown. Auto-prints once
// the data resolves.

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { format, parseISO } from 'date-fns'
import { useActiveWorkspace } from './listings/use-active-workspace'
import {
  AreaLineChart,
  ColumnChart,
  DonutChart,
  HorizontalBars,
  SERIES,
  SummaryCard,
} from './analytics/charts'
import {
  issuePriorityColor,
  issuePriorityLabel,
  issueStatusColor,
  issueStatusLabel,
} from '@/lib/work-items'
import type { AnalyticsPayload } from '@/lib/db/queries/analytics'

function formatHours(h: number | null | undefined): string {
  if (h == null) return '—'
  if (h < 1) return '<1h'
  if (h < 48) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

function fmtX(b: string): string {
  try {
    return format(parseISO(b), 'MMM d')
  } catch {
    return b.slice(5)
  }
}

export function PrintAnalyticsView({ query, theme }: { query: string; theme: string | null }) {
  const { setTheme } = useTheme()
  const { data: ws } = useActiveWorkspace()

  useEffect(() => {
    if (theme === 'dark' || theme === 'light') {
      setTheme(theme)
      document.documentElement.classList.toggle('dark', theme === 'dark')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const analytics = useQuery({
    queryKey: ['print-analytics', ws?.slug, query],
    enabled: !!ws,
    queryFn: async (): Promise<AnalyticsPayload> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/analytics?${query}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  useEffect(() => {
    if (analytics.data) {
      const t = setTimeout(() => window.print(), 900)
      return () => clearTimeout(t)
    }
  }, [analytics.data])

  if (analytics.isLoading || !analytics.data) {
    return <div className="p-8 text-sm">Loading…</div>
  }
  const data = analytics.data
  const s = data.summary

  const cumulative = (() => {
    let c = 0
    let d = 0
    return data.velocity_series.map((p) => {
      c += p.created
      d += p.completed
      return { bucket: p.bucket, cum_created: c, cum_completed: d }
    })
  })()

  return (
    <main className="mx-auto max-w-3xl px-8 py-10 text-foreground">
      <style>{`
        html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        @media print {
          .no-print { display: none !important; }
          aside { display: none !important; }
          .dashboard-mobile-header { display: none !important; }
          main { margin-left: 0 !important; }
          .print-section { break-inside: avoid; }
        }
        @page { margin: 1cm; }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between rounded-md border border-border bg-card/30 px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Print preview — your browser will open the print dialog automatically.
        </span>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Print now
        </button>
      </div>

      <header className="mb-8 border-b border-border pb-4">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {data.scope.type} analytics
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{data.scope.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.period.from
            ? `${format(new Date(data.period.from), 'MMMM d, yyyy')} — ${format(new Date(data.period.to ?? data.period.from), 'MMMM d, yyyy')}`
            : 'All time'}
        </p>
      </header>

      <section className="print-section mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total issues" value={s.total_issues} hint={`${s.open + s.in_progress} open`} />
        <SummaryCard label="Completed" value={s.completed_in_period} hint="in period" />
        <SummaryCard label="Created" value={s.created_in_period} hint="in period" />
        <SummaryCard label="Completion" value={`${s.completion_rate}%`} />
        <SummaryCard label="Avg cycle" value={formatHours(s.avg_cycle_time_hours)} hint={`median ${formatHours(s.median_cycle_time_hours)}`} />
        <SummaryCard label="In progress" value={s.in_progress} />
        <SummaryCard label="Overdue" value={s.overdue} hint={`${s.unassigned} unassigned`} />
        <SummaryCard label="Active members" value={s.active_members_in_period} hint={`of ${s.total_members}`} />
      </section>

      <section className="print-section mb-8 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-medium">Velocity</h2>
        <AreaLineChart
          data={data.velocity_series}
          series={[
            { key: 'created', label: 'Created', color: SERIES.created, fill: true },
            { key: 'completed', label: 'Completed', color: SERIES.completed, fill: true },
          ]}
          formatX={fmtX}
        />
      </section>

      <section className="print-section mb-8 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-medium">Cumulative flow</h2>
        <AreaLineChart
          data={cumulative}
          series={[
            { key: 'cum_created', label: 'Cumulative created', color: SERIES.created, fill: true },
            { key: 'cum_completed', label: 'Cumulative completed', color: SERIES.completed, fill: true },
          ]}
          formatX={fmtX}
        />
      </section>

      <section className="print-section mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Status distribution</h2>
          <DonutChart
            data={data.by_status.map((st) => ({
              label: issueStatusLabel(st.status),
              value: st.count,
              color: issueStatusColor(st.status),
            }))}
            centerLabel="Issues"
            size={148}
          />
        </div>
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">By priority</h2>
          <HorizontalBars
            showPercent
            items={data.by_priority.map((p) => ({
              label: issuePriorityLabel(p.priority),
              value: p.count,
              color: issuePriorityColor(p.priority),
            }))}
          />
        </div>
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Cycle time</h2>
          <ColumnChart data={data.cycle_time_buckets} color={SERIES.completed} height={150} />
        </div>
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Aging of open work</h2>
          <ColumnChart data={data.aging_buckets} color="#f59e0b" height={150} />
        </div>
      </section>

      {data.by_assignee.length > 0 ? (
        <section className="print-section mb-8 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Workload by assignee</h2>
          <HorizontalBars
            items={data.by_assignee.map((a) => ({
              label: a.name ?? a.email,
              value: a.open,
              sub: `${a.done} done`,
            }))}
          />
        </section>
      ) : null}

      {data.by_project.length > 0 ? (
        <section className="print-section mb-8 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">By project</h2>
          <HorizontalBars
            items={data.by_project.map((p) => ({
              label: p.name,
              value: p.total,
              color: p.color ?? 'var(--primary)',
              sub: `${p.done} done`,
            }))}
          />
        </section>
      ) : null}

      {data.burndown_series && data.burndown_series.length > 0 ? (
        <section className="print-section mb-8 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Burndown</h2>
          <AreaLineChart
            data={data.burndown_series.map((d) => ({ bucket: d.date, remaining: d.remaining, ideal: d.ideal }))}
            series={[
              { key: 'remaining', label: 'Remaining', color: 'var(--primary)', fill: true },
              { key: 'ideal', label: 'Ideal', color: SERIES.ideal },
            ]}
            formatX={fmtX}
          />
        </section>
      ) : null}

      <footer className="mt-12 border-t border-border pt-3 text-[10px] text-muted-foreground">
        Generated on {format(new Date(), 'PPpp')} · {ws?.name ?? ''}
      </footer>
    </main>
  )
}
