'use client'

import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'

interface AdminErrorRow {
  id: number
  level: string
  code: string | null
  message: string
  route: string | null
  method: string | null
  status_code: number | null
  user_id: number | null
  resolved: boolean
  resolved_at: string | null
  occurred_at: string
}

interface ErrorEventStats {
  total: number
  resolved: number
  unresolved: number
}

interface ErrorPage {
  data: AdminErrorRow[]
  next_cursor: number | null
  stats?: ErrorEventStats
}

type StatusFilter = 'all' | 'open' | 'resolved'
type RangeFilter = 'all' | '24h' | '7d' | '30d'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Unresolved' },
  { value: 'resolved', label: 'Resolved' },
]

const RANGE_OPTIONS: { value: RangeFilter; label: string; ms: number | null }[] = [
  { value: 'all', label: 'All time', ms: null },
  { value: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
]

const LEVEL_OPTIONS = ['all', 'error', 'warn', 'info']

export function SuperAdminErrorsView() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [level, setLevel] = useState('all')
  const [range, setRange] = useState<RangeFilter>('all')

  const fromIso = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.value === range)
    if (!opt?.ms) return null
    return new Date(Date.now() - opt.ms).toISOString()
  }, [range])

  const queryKey = ['super-admin-errors', { status, level, fromIso }] as const

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey,
      initialPageParam: null as number | null,
      queryFn: async ({ pageParam }) => {
        const sp = new URLSearchParams()
        if (status !== 'all') sp.set('status', status)
        if (level !== 'all') sp.set('level', level)
        if (fromIso) sp.set('from', fromIso)
        if (pageParam) sp.set('cursor', String(pageParam))
        if (!pageParam) sp.set('stats', '1')
        const res = await fetch(`/api/super-admin/errors?${sp.toString()}`)
        if (!res.ok) throw new Error('failed')
        return (await res.json()) as ErrorPage
      },
      getNextPageParam: (last) => last.next_cursor,
    })

  const stats = data?.pages[0]?.stats
  const rows = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])

  const resolve = useMutation({
    mutationFn: async ({ id, resolved }: { id: number; resolved: boolean }) => {
      const res = await fetch(`/api/super-admin/errors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Failed to update')
      return j
    },
    onSuccess: (_r, vars) => {
      toast.success(vars.resolved ? 'Marked as resolved' : 'Reopened error')
      queryClient.invalidateQueries({ queryKey: ['super-admin-errors'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      {/* Platform-wide note */}
      <div className="flex items-center gap-2.5 border-b border-border bg-primary/5 px-6 py-2.5 text-sm text-primary/80">
        <ShieldCheck size={14} className="shrink-0" />
        Every error captured across the platform — server, client, and background jobs.
      </div>

      {/* Stat cards */}
      {stats && (
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          <Stat label="Total errors" value={stats.total} />
          <Stat label="Unresolved" value={stats.unresolved} tone="danger" />
          <Stat label="Resolved" value={stats.resolved} tone="success" />
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        {/* Status segmented control */}
        <div className="flex overflow-hidden rounded-md border border-border">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatus(o.value)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                status === o.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Level filter */}
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2.5 text-sm capitalize outline-none focus:ring-1 focus:ring-primary"
        >
          {LEVEL_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All levels' : l}
            </option>
          ))}
        </select>

        {/* Date range filter */}
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeFilter)}
          className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        {!isLoading && (
          <span className="ml-auto flex items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground/70 ring-1 ring-border/60">
            {rows.length}
            {hasNextPage ? '+' : ''}
          </span>
        )}
      </div>

      {/* Column header */}
      <div className="hidden items-center gap-3 border-b border-border px-6 py-2.5 text-[13px] font-medium text-muted-foreground md:flex">
        <span className="w-4 shrink-0" />
        <span className="w-16 shrink-0">Level</span>
        <span className="flex-1">Message</span>
        <span className="hidden w-40 shrink-0 lg:block">Route</span>
        <span className="w-16 shrink-0 text-center">Status</span>
        <span className="w-32 shrink-0">When</span>
        <span className="w-24 shrink-0 text-right">State</span>
      </div>

      {isLoading ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <CheckCircle2 size={20} className="mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No errors found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing matches the current filters. {status === 'open' && 'All clear here.'}
          </p>
        </div>
      ) : (
        <ul>
          {rows.map((row) => (
            <ErrorRow
              key={row.id}
              row={row}
              onToggleResolved={(resolved) => resolve.mutate({ id: row.id, resolved })}
              isUpdating={resolve.isPending}
            />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="border-t border-border px-6 py-3">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'danger' | 'success'
}) {
  const color =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'success'
        ? 'text-emerald-500'
        : 'text-foreground'
  return (
    <div className="px-6 py-3">
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function ErrorRow({
  row,
  onToggleResolved,
  isUpdating,
}: {
  row: AdminErrorRow
  onToggleResolved: (resolved: boolean) => void
  isUpdating: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="border-b border-border/50">
      {/* Summary row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="w-4 shrink-0 text-muted-foreground">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="w-16 shrink-0">
          <LevelBadge level={row.level} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.message}</span>
          {row.code && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.code}
            </span>
          )}
        </span>
        <span className="hidden w-40 shrink-0 truncate font-mono text-[12px] text-muted-foreground lg:block">
          {row.method ? `${row.method} ` : ''}
          {row.route ?? '—'}
        </span>
        <span className="w-16 shrink-0 text-center font-mono text-[12px] text-muted-foreground">
          {row.status_code ?? '—'}
        </span>
        <span className="w-32 shrink-0 text-sm text-muted-foreground" suppressHydrationWarning>
          {format(new Date(row.occurred_at), 'MMM d, HH:mm')}
        </span>
        <span className="flex w-24 shrink-0 justify-end">
          {row.resolved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
              <CheckCircle2 size={11} /> Resolved
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
              <Circle size={11} /> Open
            </span>
          )}
        </span>
      </button>

      {open && (
        <ErrorDetail
          row={row}
          onToggleResolved={onToggleResolved}
          isUpdating={isUpdating}
        />
      )}
    </li>
  )
}

interface FullErrorEvent extends AdminErrorRow {
  stack: string | null
  context: unknown
  workspace_id: number | null
  resolved_by: number | null
}

function ErrorDetail({
  row,
  onToggleResolved,
  isUpdating,
}: {
  row: AdminErrorRow
  onToggleResolved: (resolved: boolean) => void
  isUpdating: boolean
}) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['super-admin-error', row.id],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/errors/${row.id}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as FullErrorEvent
    },
  })

  return (
    <div className="space-y-4 border-t border-border/50 bg-secondary/20 px-6 py-4 pl-[52px]">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        {row.resolved ? (
          <button
            onClick={() => onToggleResolved(false)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            <RotateCcw size={14} /> Reopen
          </button>
        ) : (
          <button
            onClick={() => onToggleResolved(true)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50"
          >
            <CheckCircle2 size={14} /> Mark resolved
          </button>
        )}
        {row.resolved && row.resolved_at && (
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            Resolved {format(new Date(row.resolved_at), 'MMM d, yyyy HH:mm')}
            {detail?.resolved_by ? ` · by user #${detail.resolved_by}` : ''}
          </span>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Meta label="Event ID" value={`#${row.id}`} />
        <Meta label="Code" value={row.code ?? '—'} mono />
        <Meta label="User ID" value={row.user_id ? `#${row.user_id}` : '—'} />
        <Meta
          label="Workspace"
          value={detail?.workspace_id ? `#${detail.workspace_id}` : '—'}
        />
      </div>

      {/* Full message */}
      <Section title="Message">
        <p className="whitespace-pre-wrap break-words text-sm">{row.message}</p>
      </Section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading detail…</p>
      ) : (
        <>
          {detail?.stack && (
            <Section title="Stack trace">
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {detail.stack}
              </pre>
            </Section>
          )}
          {detail?.context != null && (
            <Section title="Context">
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(detail.context, null, 2)}
              </pre>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function LevelBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    error: 'bg-destructive/10 text-destructive',
    warn: 'bg-amber-500/10 text-amber-500',
    info: 'bg-blue-500/10 text-blue-500',
  }
  const cls = styles[level] ?? 'bg-secondary text-muted-foreground'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${cls}`}
    >
      {level === 'error' && <AlertTriangle size={10} />}
      {level}
    </span>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 ${mono ? 'font-mono text-[12px]' : 'text-sm'}`}>{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}
