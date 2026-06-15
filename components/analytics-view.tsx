'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO, subDays } from 'date-fns'
import {
  Activity,
  Check,
  ChevronDown,
  Download,
  Gauge,
  LayoutDashboard,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  Users,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { MemberAvatar } from './ui/member-avatar'
import { DatePicker } from './ui/date-picker'
import {
  AreaLineChart,
  ColumnChart,
  DonutChart,
  HorizontalBars,
  KpiCard,
  SERIES,
  formatNumber,
} from './analytics/charts'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issuePriorityColor,
  issuePriorityLabel,
  issueStatusColor,
  issueStatusLabel,
} from '@/lib/work-items'
import type { AnalyticsPayload } from '@/lib/db/queries/analytics'

type View = 'workspace' | 'project' | 'milestone' | 'member'
type TabKey = 'overview' | 'throughput' | 'workload' | 'activity' | 'burndown'

const SCOPES: Array<{ value: View; label: string }> = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'project', label: 'Project' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'member', label: 'Member' },
]

const RANGE_PRESETS: Array<{ key: string; label: string; days: number }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '12m', label: '12M', days: 365 },
  { key: 'all', label: 'All', days: 0 },
]

interface ListItem {
  value: number
  label: string
  sub?: string
}

// ---------- small helpers ----------

function formatHours(h: number | null | undefined): string {
  if (h == null) return '—'
  if (h < 1) return '<1h'
  if (h < 48) return `${Math.round(h)}h`
  return `${(h / 24).toFixed(1)}d`
}

function fmtXLabel(bucket: string): string {
  try {
    return format(parseISO(bucket), 'MMM d')
  } catch {
    return bucket.slice(5)
  }
}

// ---------- reusable controls ----------

function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: React.ReactNode }>
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-1.5 text-[13px]'
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md ${pad} font-medium transition-colors ${
            value === o.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface FilterOption {
  value: string
  label: string
  color?: string
}

function FilterMenu({
  label,
  icon,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string
  icon?: React.ReactNode
  options: FilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors ${
          selected.length
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        {icon}
        {label}
        {selected.length ? (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
            {selected.length}
          </span>
        ) : (
          <ChevronDown size={12} className="opacity-60" />
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-xl duration-100 animate-in fade-in zoom-in-95">
          {searchable ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search size={13} className="text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${label.toLowerCase()}…`}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No options</li>
            ) : (
              filtered.map((o) => {
                const on = selected.includes(o.value)
                return (
                  <li key={o.value}>
                    <button
                      onClick={() => toggle(o.value)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-secondary"
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                          on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        }`}
                      >
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      {o.color ? (
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
                      ) : null}
                      <span className="flex-1 truncate">{o.label}</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {selected.length ? (
            <button
              onClick={() => onChange([])}
              className="w-full border-t border-border px-3 py-2 text-left text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear {selected.length} selected
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ScopeTargetSelect({
  view,
  items,
  value,
  onChange,
  loading,
}: {
  view: View
  items: ListItem[]
  value: number | null
  onChange: (v: number | null) => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  const current = items.find((i) => i.value === value)
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items
  }, [items, query])
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-w-[150px] items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] hover:bg-secondary/60"
      >
        <span className={`flex-1 truncate text-left ${current ? '' : 'text-muted-foreground'}`}>
          {current ? current.label : loading ? 'Loading…' : `Select ${view}…`}
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl duration-100 animate-in fade-in zoom-in-95">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${view}…`}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No {view}s found</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-secondary"
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.value === value ? <Check size={13} className="text-muted-foreground" /> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title?: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-xl border border-border bg-card/40 p-4 sm:p-5 ${className ?? ''}`}>
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-secondary/60 ${className ?? ''}`} />
}

// ---------- main view ----------

export function AnalyticsView() {
  const { resolvedTheme } = useTheme()
  const { data: ws } = useActiveWorkspace()

  const [view, setView] = useState<View>('workspace')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [rangeKey, setRangeKey] = useState('30d')
  const [customFrom, setCustomFrom] = useState<string | null>(null)
  const [customTo, setCustomTo] = useState<string | null>(null)
  const [granularity, setGranularity] = useState<'day' | 'week'>('day')
  const [tab, setTab] = useState<TabKey>('overview')

  // faceted filters (string values; numerics serialized when querying)
  const [statusF, setStatusF] = useState<string[]>([])
  const [priorityF, setPriorityF] = useState<string[]>([])
  const [labelF, setLabelF] = useState<string[]>([])
  const [assigneeF, setAssigneeF] = useState<string[]>([])

  const range = useMemo(() => {
    if (rangeKey === 'custom') {
      return {
        from: customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : undefined,
        to: customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined,
      }
    }
    const preset = RANGE_PRESETS.find((p) => p.key === rangeKey)
    if (!preset || preset.days === 0) return { from: undefined, to: undefined }
    return { from: subDays(new Date(), preset.days).toISOString(), to: new Date().toISOString() }
  }, [rangeKey, customFrom, customTo])

  // list queries (scope targets + filter options)
  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && view === 'project',
    queryFn: async (): Promise<ListItem[]> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!r.ok) return []
      const j = await r.json()
      return (j.data ?? []).map((p: { id: number; name: string }) => ({ value: p.id, label: p.name }))
    },
  })
  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws && view === 'milestone',
    queryFn: async (): Promise<ListItem[]> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!r.ok) return []
      const j = await r.json()
      return (j.data ?? []).map((m: { id: number; name: string }) => ({ value: m.id, label: m.name }))
    },
  })
  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Array<{ user_id: number; name: string | null; email: string; avatar_url: string | null }>> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
  })
  const labels = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<Array<{ id: number; name: string; color: string }>> => {
      const r = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!r.ok) return []
      const j = await r.json()
      return j.data ?? []
    },
  })

  const targetItems: ListItem[] =
    view === 'project'
      ? projects.data ?? []
      : view === 'milestone'
        ? milestones.data ?? []
        : view === 'member'
          ? (members.data ?? []).map((m) => ({ value: m.user_id, label: m.name ?? m.email, sub: m.email }))
          : []

  // build query params (shared by fetch + export)
  const buildParams = useMemo(() => {
    return () => {
      const params = new URLSearchParams()
      params.set('view', view)
      if (targetId !== null) params.set('id', String(targetId))
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      params.set('interval', granularity)
      statusF.forEach((s) => params.append('status', s))
      priorityF.forEach((p) => params.append('priority', p))
      labelF.forEach((l) => params.append('label', l))
      assigneeF.forEach((a) => params.append('assignee', a))
      return params
    }
  }, [view, targetId, range, granularity, statusF, priorityF, labelF, assigneeF])

  const analytics = useQuery({
    queryKey: [
      'ws-analytics',
      ws?.slug,
      view,
      targetId,
      range.from,
      range.to,
      granularity,
      statusF.join(','),
      priorityF.join(','),
      labelF.join(','),
      assigneeF.join(','),
    ],
    enabled: !!ws && (view === 'workspace' || targetId !== null),
    queryFn: async (): Promise<AnalyticsPayload> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/analytics?${buildParams()}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const data = analytics.data
  const activeFilters = statusF.length + priorityF.length + labelF.length + assigneeF.length

  function clearFilters() {
    setStatusF([])
    setPriorityF([])
    setLabelF([])
    setAssigneeF([])
  }

  function openPrintView() {
    const params = buildParams()
    if (resolvedTheme) params.set('theme', resolvedTheme)
    window.open(`/dashboard/analytics/print?${params.toString()}`, '_blank')
  }

  function exportCsv() {
    if (!data) return
    const rows: string[][] = [['Metric', 'Value']]
    const s = data.summary
    rows.push(
      ['Scope', `${data.scope.type}: ${data.scope.label}`],
      ['Total issues', String(s.total_issues)],
      ['Open', String(s.open + s.in_progress)],
      ['Done', String(s.done)],
      ['Created (period)', String(s.created_in_period)],
      ['Completed (period)', String(s.completed_in_period)],
      ['Completion rate %', String(s.completion_rate)],
      ['Avg cycle time (h)', String(s.avg_cycle_time_hours ?? '')],
      ['Median cycle time (h)', String(s.median_cycle_time_hours ?? '')],
      ['Overdue', String(s.overdue)],
      ['Unassigned', String(s.unassigned)],
      ['Active members', String(s.active_members_in_period)]
    )
    rows.push([], ['Date', 'Created', 'Completed'])
    data.velocity_series.forEach((p) => rows.push([p.bucket, String(p.created), String(p.completed)]))
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${data.scope.type}-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const periodText = data?.period.from
    ? `${format(new Date(data.period.from), 'MMM d')} – ${format(new Date(data.period.to ?? data.period.from), 'MMM d, yyyy')}`
    : 'All time'

  const needsTarget = view !== 'workspace' && targetId === null

  const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
    { key: 'throughput', label: 'Throughput', icon: <Gauge size={14} /> },
    { key: 'workload', label: 'Workload', icon: <Users size={14} /> },
    { key: 'activity', label: 'Activity', icon: <Activity size={14} /> },
    ...(view === 'milestone'
      ? [{ key: 'burndown' as TabKey, label: 'Burndown', icon: <TrendingDown size={14} /> }]
      : []),
  ]

  return (
    <div className="min-h-full">
      {/* sticky control cluster */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <header className="flex h-12 items-center gap-2.5 px-4">
          <h1 className="text-[15px] font-semibold">Analytics</h1>
          <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">
            {data?.scope.label ?? ws?.name ?? '…'} · {periodText}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => analytics.refetch()}
              disabled={analytics.isFetching}
              title="Refresh"
              className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw size={14} className={analytics.isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={exportCsv}
              disabled={!data}
              className="hidden items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 sm:flex"
            >
              <Download size={14} />
              CSV
            </button>
            <button
              onClick={openPrintView}
              disabled={!data}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Download size={14} />
              PDF
            </button>
          </div>
        </header>

        {/* row: scope + range */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <Segmented
            options={SCOPES}
            value={view}
            onChange={(v) => {
              setView(v)
              setTargetId(null)
              if (v !== 'milestone' && tab === 'burndown') setTab('overview')
            }}
          />
          {view !== 'workspace' ? (
            <ScopeTargetSelect
              view={view}
              items={targetItems}
              value={targetId}
              onChange={setTargetId}
              loading={
                (view === 'project' && projects.isLoading) ||
                (view === 'milestone' && milestones.isLoading) ||
                (view === 'member' && members.isLoading)
              }
            />
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              options={[
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setRangeKey(p.key)}
                  className={`rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                    rangeKey === p.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setRangeKey('custom')}
                className={`rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                  rangeKey === 'custom'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Custom
              </button>
            </div>
            {rangeKey === 'custom' ? (
              <div className="flex items-center gap-1.5">
                <DatePicker
                  variant="chip"
                  value={customFrom}
                  onChange={setCustomFrom}
                  placeholder="From"
                  align="right"
                />
                <span className="text-muted-foreground">–</span>
                <DatePicker
                  variant="chip"
                  value={customTo}
                  onChange={setCustomTo}
                  placeholder="To"
                  align="right"
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* row: filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <SlidersHorizontal size={13} />
            Filters
          </span>
          <FilterMenu
            label="Status"
            options={ISSUE_STATUSES.map((s) => ({ value: s.value, label: s.label, color: s.color }))}
            selected={statusF}
            onChange={setStatusF}
          />
          <FilterMenu
            label="Priority"
            options={ISSUE_PRIORITIES.map((p) => ({
              value: String(p.value),
              label: p.label,
              color: p.color,
            }))}
            selected={priorityF}
            onChange={setPriorityF}
          />
          <FilterMenu
            label="Assignee"
            searchable
            options={(members.data ?? []).map((m) => ({
              value: String(m.user_id),
              label: m.name ?? m.email,
            }))}
            selected={assigneeF}
            onChange={setAssigneeF}
          />
          <FilterMenu
            label="Label"
            searchable
            options={(labels.data ?? []).map((l) => ({
              value: String(l.id),
              label: l.name,
              color: l.color,
            }))}
            selected={labelF}
            onChange={setLabelF}
          />
          {activeFilters > 0 ? (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
              Clear all
            </button>
          ) : null}

          {/* tabs pushed to the right on wide screens */}
          <div className="ml-auto inline-flex items-center gap-0.5 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* body */}
      <div className="p-4 sm:p-6">
        {needsTarget ? (
          <EmptyState
            title={`Select a ${view}`}
            body={`Choose a ${view} above to see its analytics.`}
          />
        ) : analytics.isLoading ? (
          <LoadingState />
        ) : analytics.isError ? (
          <EmptyState title="Couldn't load analytics" body="Something went wrong. Try refreshing." />
        ) : !data ? (
          <EmptyState title="No analytics available" body="There's no data to show yet." />
        ) : (
          <div className="mx-auto max-w-[1200px]">
            {tab === 'overview' && <OverviewTab data={data} />}
            {tab === 'throughput' && <ThroughputTab data={data} />}
            {tab === 'workload' && <WorkloadTab data={data} members={members.data ?? []} />}
            {tab === 'activity' && <ActivityTab data={data} members={members.data ?? []} />}
            {tab === 'burndown' && <BurndownTab data={data} />}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- states ----------

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center justify-center py-24 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Gauge size={20} />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-24" />
        ))}
      </div>
      <SkeletonBlock className="h-72" />
      <div className="grid gap-5 lg:grid-cols-2">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-64" />
      </div>
    </div>
  )
}

// ---------- tabs ----------

function statusDonut(data: AnalyticsPayload) {
  return data.by_status.map((s) => ({
    label: issueStatusLabel(s.status),
    value: s.count,
    color: issueStatusColor(s.status),
  }))
}

function OverviewTab({ data }: { data: AnalyticsPayload }) {
  const s = data.summary
  const t = data.trends
  const createdSpark = data.velocity_series.map((p) => p.created)
  const completedSpark = data.velocity_series.map((p) => p.completed)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <KpiCard label="Total issues" value={s.total_issues} hint={`${s.open + s.in_progress} open · ${s.done} done`} accent="var(--primary)" />
        <KpiCard label="Completed" value={s.completed_in_period} pct={t.completed.pct} spark={completedSpark} accent={SERIES.completed} hint="in period" />
        <KpiCard label="Created" value={s.created_in_period} pct={t.created.pct} spark={createdSpark} accent="var(--primary)" hint="in period" />
        <KpiCard label="Completion rate" value={`${s.completion_rate}%`} hint={`${s.done} of ${s.total_issues - s.cancelled}`} />
        <KpiCard label="Avg cycle time" value={formatHours(s.avg_cycle_time_hours)} pct={t.cycle_time.pct} invert hint={`median ${formatHours(s.median_cycle_time_hours)}`} />
        <KpiCard label="In progress" value={s.in_progress} hint={`${s.backlog} in backlog`} accent="#f2c94c" />
        <KpiCard label="Overdue" value={s.overdue} hint={`${s.unassigned} unassigned`} accent={s.overdue > 0 ? '#ef4444' : undefined} />
        <KpiCard label="Active members" value={s.active_members_in_period} pct={t.active_members.pct} hint={`of ${s.total_members}`} accent={SERIES.activity} />
      </div>

      <Panel title="Velocity" subtitle="Issues created vs. completed over time">
        <AreaLineChart
          data={data.velocity_series}
          series={[
            { key: 'created', label: 'Created', color: SERIES.created, fill: true },
            { key: 'completed', label: 'Completed', color: SERIES.completed, fill: true },
          ]}
          formatX={fmtXLabel}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Status distribution" subtitle="Current breakdown of all issues">
          <DonutChart data={statusDonut(data)} centerLabel="Issues" />
        </Panel>
        <Panel title="By priority" subtitle="Issue count per priority level">
          <HorizontalBars
            showPercent
            items={data.by_priority.map((p) => ({
              label: issuePriorityLabel(p.priority),
              value: p.count,
              color: issuePriorityColor(p.priority),
            }))}
          />
        </Panel>
      </div>

      {data.by_project.length > 0 ? (
        <Panel title="By project" subtitle="Issue volume and completion across projects">
          <HorizontalBars
            items={data.by_project.map((p) => ({
              label: p.name,
              value: p.total,
              color: p.color ?? 'var(--primary)',
              sub: `${p.done} done · ${p.open} open`,
            }))}
          />
        </Panel>
      ) : null}
    </div>
  )
}

function ThroughputTab({ data }: { data: AnalyticsPayload }) {
  const s = data.summary
  const t = data.trends
  const days = data.period.from
    ? Math.max(1, Math.round((new Date(data.period.to ?? Date.now()).getTime() - new Date(data.period.from).getTime()) / 86400000))
    : data.velocity_series.length || 1
  const perDay = Math.round((s.completed_in_period / days) * 10) / 10
  const net = s.created_in_period - s.completed_in_period

  const cumulative = useMemo(() => {
    let c = 0
    let d = 0
    return data.velocity_series.map((p) => {
      c += p.created
      d += p.completed
      return { bucket: p.bucket, cum_created: c, cum_completed: d }
    })
  }, [data.velocity_series])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Completed" value={s.completed_in_period} pct={t.completed.pct} accent={SERIES.completed} />
        <KpiCard label="Created" value={s.created_in_period} pct={t.created.pct} accent="var(--primary)" />
        <KpiCard label="Throughput / day" value={perDay} hint={`over ${days}d`} />
        <KpiCard label="Net flow" value={net > 0 ? `+${net}` : String(net)} hint={net > 0 ? 'backlog growing' : 'backlog shrinking'} accent={net > 0 ? '#ef4444' : SERIES.completed} />
        <KpiCard label="Avg cycle" value={formatHours(s.avg_cycle_time_hours)} pct={t.cycle_time.pct} invert />
        <KpiCard label="Median cycle" value={formatHours(s.median_cycle_time_hours)} />
      </div>

      <Panel title="Velocity" subtitle="Created vs. completed per bucket">
        <AreaLineChart
          data={data.velocity_series}
          series={[
            { key: 'created', label: 'Created', color: SERIES.created, fill: true },
            { key: 'completed', label: 'Completed', color: SERIES.completed, fill: true },
          ]}
          formatX={fmtXLabel}
        />
      </Panel>

      <Panel title="Cumulative flow" subtitle="Running totals — the gap is open work in the period">
        <AreaLineChart
          data={cumulative}
          series={[
            { key: 'cum_created', label: 'Cumulative created', color: SERIES.created, fill: true },
            { key: 'cum_completed', label: 'Cumulative completed', color: SERIES.completed, fill: true },
          ]}
          formatX={fmtXLabel}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Cycle time distribution" subtitle="Time from creation to completion (in period)">
          <ColumnChart data={data.cycle_time_buckets} color={SERIES.completed} />
        </Panel>
        <Panel title="Aging of open work" subtitle="How long currently-open issues have been open">
          <ColumnChart data={data.aging_buckets} color="#f59e0b" />
        </Panel>
      </div>
    </div>
  )
}

function WorkloadTab({
  data,
  members,
}: {
  data: AnalyticsPayload
  members: Array<{ user_id: number; name: string | null; email: string; avatar_url: string | null }>
}) {
  const s = data.summary
  const avatarOf = (id: number) => members.find((m) => m.user_id === id)
  const totalOpen = data.by_assignee.reduce((a, x) => a + x.open, 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <KpiCard label="Open issues" value={s.open + s.in_progress} hint={`${s.in_progress} in progress`} accent="var(--primary)" />
        <KpiCard label="Unassigned" value={s.unassigned} hint="need an owner" accent={s.unassigned > 0 ? '#f59e0b' : undefined} />
        <KpiCard label="Overdue" value={s.overdue} hint="past due date" accent={s.overdue > 0 ? '#ef4444' : undefined} />
        <KpiCard label="Open estimate" value={s.open_estimate_hours != null ? `${s.open_estimate_hours}h` : '—'} hint="remaining effort" />
      </div>

      <Panel title="Workload by assignee" subtitle="Open vs. completed issues per member">
        {data.by_assignee.length === 0 ? (
          <p className="text-xs text-muted-foreground">No assigned issues in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 text-right font-medium">Open</th>
                  <th className="pb-2 text-right font-medium">Done</th>
                  <th className="pb-2 pl-4 font-medium">Load</th>
                  <th className="pb-2 text-right font-medium">Avg cycle</th>
                </tr>
              </thead>
              <tbody>
                {data.by_assignee.map((a) => {
                  const m = avatarOf(a.user_id)
                  const loadPct = totalOpen > 0 ? (a.open / Math.max(1, ...data.by_assignee.map((x) => x.open))) * 100 : 0
                  return (
                    <tr key={a.user_id} className="border-b border-border/60 last:border-0">
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <MemberAvatar name={a.name} email={a.email} avatarUrl={m?.avatar_url} size={20} />
                          <span className="truncate">{a.name ?? a.email}</span>
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{a.open}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{a.done}</td>
                      <td className="py-2 pl-4">
                        <div className="h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, loadPct)}%` }} />
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{formatHours(a.avg_cycle_time_hours)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By label" subtitle="Most-used labels in scope">
          <HorizontalBars
            showPercent
            emptyLabel="No labels in use."
            items={data.by_label.map((l) => ({ label: l.name, value: l.count, color: l.color }))}
          />
        </Panel>
        <Panel title="Status distribution" subtitle="Where work currently sits">
          <DonutChart data={statusDonut(data)} centerLabel="Issues" />
        </Panel>
      </div>
    </div>
  )
}

function ActivityTab({
  data,
  members,
}: {
  data: AnalyticsPayload
  members: Array<{ user_id: number; name: string | null; email: string; avatar_url: string | null }>
}) {
  const totalEvents = data.activity_series.reduce((a, p) => a + p.count, 0)
  const busiest = data.activity_by_action[0]
  const avatarOf = (id: number) => members.find((m) => m.user_id === id)
  const maxMember = Math.max(1, ...data.top_active_members.map((m) => m.events))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <KpiCard label="Total events" value={totalEvents} hint="in period" accent={SERIES.activity} />
        <KpiCard label="Active members" value={data.summary.active_members_in_period} pct={data.trends.active_members.pct} hint={`of ${data.summary.total_members}`} />
        <KpiCard label="Top action" value={busiest ? humanizeAction(busiest.action) : '—'} hint={busiest ? `${formatNumber(busiest.count)} times` : undefined} />
        <KpiCard label="Avg / day" value={data.activity_series.length ? Math.round(totalEvents / data.activity_series.length) : 0} />
      </div>

      <Panel title="Activity over time" subtitle="Workspace events per bucket">
        <AreaLineChart
          data={data.activity_series}
          series={[{ key: 'count', label: 'Events', color: SERIES.activity, fill: true }]}
          formatX={fmtXLabel}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Activity by type" subtitle="Breakdown of event actions">
          <HorizontalBars
            showPercent
            emptyLabel="No activity in range."
            items={data.activity_by_action.map((a) => ({ label: humanizeAction(a.action), value: a.count, color: SERIES.activity }))}
          />
        </Panel>
        <Panel title="Most active members" subtitle="By number of recorded events">
          {data.top_active_members.length === 0 ? (
            <p className="text-xs text-muted-foreground">No member activity in range.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.top_active_members.map((m) => {
                const u = avatarOf(m.user_id)
                return (
                  <li key={m.user_id} className="flex items-center gap-3">
                    <MemberAvatar name={m.name} email={u?.email} avatarUrl={u?.avatar_url} size={22} />
                    <span className="w-28 shrink-0 truncate text-[13px]">{m.name ?? `User #${m.user_id}`}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full" style={{ width: `${(m.events / maxMember) * 100}%`, backgroundColor: SERIES.activity }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatNumber(m.events)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function BurndownTab({ data }: { data: AnalyticsPayload }) {
  const series = data.burndown_series
  if (!series || series.length === 0) {
    return <EmptyState title="No burndown available" body="This milestone has no due date set, so a burndown can't be charted." />
  }
  const remaining = series[series.length - 1]?.remaining ?? 0
  const peak = Math.max(...series.map((p) => p.remaining))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <KpiCard label="Remaining" value={remaining} accent="var(--primary)" />
        <KpiCard label="Scope (peak)" value={peak} />
        <KpiCard label="Completed" value={peak - remaining} accent={SERIES.completed} />
        <KpiCard label="Progress" value={peak > 0 ? `${Math.round(((peak - remaining) / peak) * 100)}%` : '—'} />
      </div>
      <Panel title="Burndown" subtitle="Remaining issues vs. the ideal trajectory to the due date">
        <AreaLineChart
          data={series.map((d) => ({ bucket: d.date, remaining: d.remaining, ideal: d.ideal }))}
          series={[
            { key: 'remaining', label: 'Remaining', color: 'var(--primary)', fill: true },
            { key: 'ideal', label: 'Ideal', color: SERIES.ideal },
          ]}
          formatX={fmtXLabel}
        />
      </Panel>
    </div>
  )
}

// ---------- action label humanizer ----------

function humanizeAction(action: string): string {
  const map: Record<string, string> = {
    created: 'Created',
    updated: 'Updated',
    deleted: 'Deleted',
    restored: 'Restored',
    purged: 'Purged',
    assigned: 'Assigned',
    unassigned: 'Unassigned',
    status_changed: 'Status changed',
    priority_changed: 'Priority changed',
    due_date_changed: 'Due date changed',
    milestone_changed: 'Milestone changed',
    project_changed: 'Project changed',
    labeled: 'Labeled',
    unlabeled: 'Unlabeled',
    commented: 'Commented',
    mentioned: 'Mentioned',
    member_added: 'Member added',
    ownership_transferred: 'Ownership transferred',
    invitation_created: 'Invite sent',
    invitation_accepted: 'Invite accepted',
    invitation_declined: 'Invite declined',
    invitation_revoked: 'Invite revoked',
  }
  return map[action] ?? action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}
