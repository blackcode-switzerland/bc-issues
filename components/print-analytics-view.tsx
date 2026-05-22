'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useActiveWorkspace } from './listings/use-active-workspace'
import {
  BurndownChart,
  HorizontalBars,
  SummaryCard,
  VelocityChart,
} from './analytics/charts'

interface AnalyticsPayload {
  scope: { type: string; id: number | null; label: string }
  period: { from: string | null; to: string | null }
  summary: {
    total_issues: number
    open: number
    in_progress: number
    done: number
    cancelled: number
    created_in_period: number
    completed_in_period: number
    avg_cycle_time_hours: number | null
    total_members: number
    active_members_in_period: number
  }
  by_status: Array<{ status: string; count: number }>
  by_priority: Array<{ priority: number; count: number }>
  by_assignee: Array<{ user_id: number; name: string | null; email: string; open: number; done: number }>
  by_label: Array<{ label_id: number; name: string; color: string; count: number }>
  velocity_series: Array<{ bucket: string; created: number; completed: number }>
  burndown_series?: Array<{ date: string; remaining: number }>
  top_active_members: Array<{ user_id: number; name: string | null; events: number }>
}

const STATUS_COLORS: Record<string, string> = {
  backlog: '#71717a',
  todo: '#a1a1aa',
  in_progress: '#3b82f6',
  blocked: '#ef4444',
  in_review: '#a855f7',
  done: '#22c55e',
  cancelled: '#71717a',
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
  5: 'None',
}

export function PrintAnalyticsView({
  view,
  id,
  from,
  to,
}: {
  view: 'workspace' | 'project' | 'milestone' | 'member'
  id: number | null
  from: string | null
  to: string | null
}) {
  const { data: ws } = useActiveWorkspace()

  const analytics = useQuery({
    queryKey: ['print-analytics', ws?.slug, view, id, from, to],
    enabled: !!ws,
    queryFn: async (): Promise<AnalyticsPayload> => {
      const params = new URLSearchParams()
      params.set('view', view)
      if (id !== null) params.set('id', String(id))
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/workspaces/${ws!.slug}/analytics?${params}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  useEffect(() => {
    if (analytics.data) {
      const t = setTimeout(() => window.print(), 600)
      return () => clearTimeout(t)
    }
  }, [analytics.data])

  if (analytics.isLoading || !analytics.data) {
    return <div className="p-8 text-sm">Loading…</div>
  }
  const data = analytics.data

  return (
    <main className="mx-auto max-w-3xl px-8 py-10 text-foreground">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          aside, nav, header.app-header { display: none !important; }
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

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total" value={data.summary.total_issues} />
        <SummaryCard label="Open" value={data.summary.open + data.summary.in_progress} />
        <SummaryCard label="Created" value={data.summary.created_in_period} />
        <SummaryCard
          label="Avg cycle"
          value={data.summary.avg_cycle_time_hours != null ? `${data.summary.avg_cycle_time_hours}h` : '—'}
        />
      </section>

      <section className="mb-8 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-medium">Velocity</h2>
        <VelocityChart data={data.velocity_series} />
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">By status</h2>
          <HorizontalBars
            items={data.by_status.map((s) => ({
              label: s.status.replace('_', ' '),
              value: s.count,
              color: STATUS_COLORS[s.status],
            }))}
          />
        </div>
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">By priority</h2>
          <HorizontalBars
            items={data.by_priority.map((p) => ({
              label: PRIORITY_LABELS[p.priority] ?? String(p.priority),
              value: p.count,
            }))}
          />
        </div>
        {data.by_assignee.length > 0 ? (
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium">By assignee</h2>
            <HorizontalBars
              items={data.by_assignee.map((a) => ({
                label: `${a.name ?? a.email} (${a.done} done)`,
                value: a.open,
              }))}
            />
          </div>
        ) : null}
        {data.by_label.length > 0 ? (
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium">By label</h2>
            <HorizontalBars
              items={data.by_label.map((l) => ({
                label: l.name,
                value: l.count,
                color: l.color,
              }))}
            />
          </div>
        ) : null}
      </section>

      {data.burndown_series && data.burndown_series.length > 0 ? (
        <section className="mb-8 rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-medium">Burndown</h2>
          <BurndownChart data={data.burndown_series} />
        </section>
      ) : null}

      <footer className="mt-12 border-t border-border pt-3 text-[10px] text-muted-foreground">
        Generated on {format(new Date(), 'PPpp')} · {ws?.name ?? ''}
      </footer>
    </main>
  )
}
