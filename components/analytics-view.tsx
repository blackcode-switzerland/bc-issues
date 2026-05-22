'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { Download, Calendar } from 'lucide-react'
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

type View = 'workspace' | 'project' | 'milestone' | 'member'

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'project', label: 'Project' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'member', label: 'Member' },
]

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

interface Project {
  id: number
  name: string
}
interface Milestone {
  id: number
  name: string
}
interface Member {
  user_id: number
  name: string | null
  email: string
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
]

export function AnalyticsView({ print = false }: { print?: boolean }) {
  const { data: ws } = useActiveWorkspace()
  const [view, setView] = useState<View>('workspace')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [preset, setPreset] = useState(30)

  const range = useMemo(() => {
    if (preset === 0) return { from: undefined, to: undefined }
    return { from: subDays(new Date(), preset).toISOString(), to: new Date().toISOString() }
  }, [preset])

  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && view === 'project',
    queryFn: async (): Promise<Project[]> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data
    },
  })
  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws && view === 'milestone',
    queryFn: async (): Promise<Milestone[]> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data
    },
  })
  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws && view === 'member',
    queryFn: async (): Promise<Member[]> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data
    },
  })

  const analytics = useQuery({
    queryKey: ['ws-analytics', ws?.slug, view, targetId, range],
    enabled: !!ws && (view === 'workspace' || targetId !== null),
    queryFn: async (): Promise<AnalyticsPayload> => {
      const params = new URLSearchParams()
      params.set('view', view)
      if (targetId !== null) params.set('id', String(targetId))
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      const res = await fetch(`/api/workspaces/${ws!.slug}/analytics?${params}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  function openPrintView() {
    const params = new URLSearchParams()
    params.set('view', view)
    if (targetId !== null) params.set('id', String(targetId))
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    window.open(`/dashboard/analytics/print?${params.toString()}`, '_blank')
  }

  const targetOptions =
    view === 'project'
      ? (projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))
      : view === 'milestone'
        ? (milestones.data ?? []).map((m) => ({ value: m.id, label: m.name }))
        : view === 'member'
          ? (members.data ?? []).map((m) => ({ value: m.user_id, label: m.name ?? m.email }))
          : []

  const data = analytics.data

  return (
    <div className={print ? 'p-8 print:p-0' : 'p-6'}>
      {!print ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Analytics</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data?.scope.label ?? ws?.name ?? '…'}
              {data?.period.from ? (
                <>
                  {' · '}
                  {format(new Date(data.period.from), 'MMM d')} – {format(new Date(data.period.to ?? data.period.from), 'MMM d, yyyy')}
                </>
              ) : null}
            </p>
          </div>
          <button
            onClick={openPrintView}
            disabled={!data}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Download size={12} />
            Download PDF
          </button>
        </header>
      ) : (
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">{data?.scope.label ?? ''} — Analytics</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data?.scope.type ?? ''} view ·{' '}
            {data?.period.from
              ? `${format(new Date(data.period.from), 'MMM d, yyyy')} – ${format(new Date(data.period.to ?? data.period.from), 'MMM d, yyyy')}`
              : 'all-time'}
          </p>
        </header>
      )}

      {!print ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card/30 p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                onClick={() => {
                  setView(v.value)
                  setTargetId(null)
                }}
                className={`rounded px-2.5 py-1 text-xs ${
                  view === v.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view !== 'workspace' ? (
            <select
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value ? parseInt(e.target.value) : null)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            >
              <option value="">Pick {view}…</option>
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card/30 p-0.5">
            <Calendar size={11} className="ml-1 text-muted-foreground" />
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPreset(p.days)}
                className={`rounded px-2.5 py-1 text-xs ${
                  preset === p.days
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {analytics.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          {view !== 'workspace'
            ? `Select a ${view} above to see analytics.`
            : 'No analytics available.'}
        </p>
      ) : (
        <AnalyticsBody data={data} />
      )}
    </div>
  )
}

function AnalyticsBody({ data }: { data: AnalyticsPayload }) {
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total issues" value={data.summary.total_issues} />
        <SummaryCard label="Open" value={data.summary.open + data.summary.in_progress} hint={`${data.summary.in_progress} in progress`} />
        <SummaryCard
          label="Created (period)"
          value={data.summary.created_in_period}
          hint={`${data.summary.completed_in_period} completed`}
        />
        <SummaryCard
          label="Avg cycle time"
          value={data.summary.avg_cycle_time_hours != null ? `${data.summary.avg_cycle_time_hours}h` : '—'}
          hint={`${data.summary.active_members_in_period} active members`}
        />
      </section>

      <section className="rounded-lg border border-border bg-card/30 p-4">
        <h2 className="mb-3 text-sm font-medium">Velocity</h2>
        <VelocityChart data={data.velocity_series} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">By status</h2>
          <HorizontalBars
            items={data.by_status.map((s) => ({
              label: s.status.replace('_', ' '),
              value: s.count,
              color: STATUS_COLORS[s.status],
            }))}
          />
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">By priority</h2>
          <HorizontalBars
            items={data.by_priority.map((p) => ({
              label: PRIORITY_LABELS[p.priority] ?? String(p.priority),
              value: p.count,
            }))}
          />
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">By assignee</h2>
          {data.by_assignee.length === 0 ? (
            <p className="text-xs text-muted-foreground">No assignees yet.</p>
          ) : (
            <HorizontalBars
              items={data.by_assignee.map((a) => ({
                label: `${a.name ?? a.email} (${a.done} done)`,
                value: a.open,
              }))}
            />
          )}
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">By label</h2>
          {data.by_label.length === 0 ? (
            <p className="text-xs text-muted-foreground">No labels in use.</p>
          ) : (
            <HorizontalBars
              items={data.by_label.map((l) => ({
                label: l.name,
                value: l.count,
                color: l.color,
              }))}
            />
          )}
        </div>
      </section>

      {data.burndown_series && data.burndown_series.length > 0 ? (
        <section className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">Milestone burndown</h2>
          <BurndownChart data={data.burndown_series} />
        </section>
      ) : null}

      {data.top_active_members.length > 0 ? (
        <section className="rounded-lg border border-border bg-card/30 p-4">
          <h2 className="mb-3 text-sm font-medium">Top active members</h2>
          <HorizontalBars
            items={data.top_active_members.map((m) => ({
              label: m.name ?? `User #${m.user_id}`,
              value: m.events,
            }))}
          />
        </section>
      ) : null}
    </div>
  )
}
