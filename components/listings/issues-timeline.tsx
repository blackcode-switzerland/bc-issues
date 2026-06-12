'use client'

import Link from 'next/link'
import { addDays, differenceInDays, format, max as maxDate, min as minDate, startOfDay } from 'date-fns'
import { issueStatusColor } from '@/lib/work-items'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  priority: number
  start_date: string | null
  due_date: string | null
  created_at: string
  updated_at: string
  assignee_name: string | null
  assignee_email: string | null
  assignee_avatar?: string | null
}

const ROW_HEIGHT = 48
const HEADER_HEIGHT = 44
const DAY_WIDTH = 26
const LABEL_WIDTH = 260

export function IssuesTimeline({
  issues,
  workspaceKey,
}: {
  issues: IssueRow[]
  workspaceKey: string
}) {
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
        <p className="text-sm text-muted-foreground">No issues to chart.</p>
      </div>
    )
  }

  const today = startOfDay(new Date())
  const ranges = issues.map((i) => issueRange(i, today))

  const earliest = addDays(startOfDay(minDate(ranges.map((r) => r.start))), -14)
  const latest = addDays(startOfDay(maxDate(ranges.map((r) => r.end))), 28)
  const totalDays = Math.max(differenceInDays(latest, earliest) + 1, 60)
  const timelineWidth = totalDays * DAY_WIDTH

  // Week ticks every 7 days
  const weekTicks: number[] = []
  for (let d = 0; d < totalDays; d += 7) weekTicks.push(d)

  // Month markers
  const monthMarkers: Array<{ day: number; label: string }> = []
  for (let d = 0; d < totalDays; d++) {
    const date = addDays(earliest, d)
    if (date.getDate() === 1) {
      monthMarkers.push({ day: d, label: format(date, date.getMonth() === 0 ? 'MMM yyyy' : 'MMM') })
    }
  }
  if (monthMarkers.length === 0 || monthMarkers[0].day > 14) {
    monthMarkers.unshift({ day: 0, label: format(earliest, 'MMM yyyy') })
  }

  const todayOffset = differenceInDays(today, earliest)

  return (
    <div className="rounded-lg border border-border bg-card/30">
      <div className="flex overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <div className="z-20 shrink-0" style={{ width: LABEL_WIDTH }}>
          {/* Header */}
          <div
            className="sticky top-0 z-20 flex items-center border-b border-r border-border bg-card/80 px-3 backdrop-blur"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Issue
            </span>
          </div>

          {/* Issue rows */}
          {issues.map((issue) => (
            <Link
              key={issue.id}
              href={`/dashboard/issues/${issue.id}`}
              prefetch={false}
              className="flex items-center gap-2 border-b border-r border-border/60 px-3 transition-colors hover:bg-secondary/30"
              style={{ height: ROW_HEIGHT }}
            >
              <StatusIcon status={issue.status} size={13} className="shrink-0" />
              <PriorityIcon priority={issuePriorityKey(issue.priority)} size={12} className="shrink-0 text-muted-foreground" />
              <span className="font-mono text-[10px] shrink-0 tabular-nums text-muted-foreground">
                {issue.seq != null ? `${workspaceKey}-${issue.seq}` : `#${issue.id}`}
              </span>
              <span className="flex-1 truncate text-[13px] font-medium">{issue.title}</span>
              {issue.assignee_email ? (
                <MemberAvatar
                  name={issue.assignee_name}
                  email={issue.assignee_email}
                  avatarUrl={issue.assignee_avatar ?? null}
                  size={16}
                />
              ) : (
                <span className="size-4 shrink-0 rounded-full border border-dashed border-muted-foreground/30" />
              )}
            </Link>
          ))}
        </div>

        {/* ── RIGHT PANEL (scrolls horizontally) ── */}
        <div className="flex-1 overflow-x-auto">
          <div style={{ width: timelineWidth }}>

            {/* Two-row date header */}
            <div
              className="sticky top-0 z-10 relative overflow-hidden border-b border-border bg-card/90 backdrop-blur"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Month row */}
              <div className="relative border-b border-border/40" style={{ height: HEADER_HEIGHT / 2 }}>
                {monthMarkers.map((m) => (
                  <span
                    key={m.day}
                    className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/80"
                    style={{ left: m.day * DAY_WIDTH }}
                  >
                    {m.label}
                  </span>
                ))}
                {monthMarkers.map((m) => (
                  <div
                    key={`ml-${m.day}`}
                    className="absolute top-0 h-full w-px bg-border/60"
                    style={{ left: m.day * DAY_WIDTH }}
                  />
                ))}
              </div>

              {/* Date row */}
              <div className="relative" style={{ height: HEADER_HEIGHT / 2 }}>
                {weekTicks.map((d) => (
                  <span
                    key={d}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] text-muted-foreground"
                    style={{ left: d * DAY_WIDTH }}
                  >
                    {format(addDays(earliest, d), 'd')}
                  </span>
                ))}
                {weekTicks.map((d) => (
                  <div
                    key={`wl-${d}`}
                    className="absolute top-0 h-full w-px bg-border/20"
                    style={{ left: d * DAY_WIDTH }}
                  />
                ))}
                {todayOffset >= 0 && todayOffset < totalDays ? (
                  <div
                    className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm bg-primary px-1 py-px text-[9px] font-bold text-primary-foreground"
                    style={{ left: todayOffset * DAY_WIDTH }}
                  >
                    {format(today, 'd')}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Timeline rows */}
            {issues.map((issue, idx) => {
              const r = ranges[idx]
              const left = differenceInDays(r.start, earliest) * DAY_WIDTH
              const width = Math.max((differenceInDays(r.end, r.start) + 1) * DAY_WIDTH - 4, 16)
              const barColor = issueStatusColor(issue.status)
              return (
                <div
                  key={issue.id}
                  className="relative border-b border-border/40 hover:bg-secondary/10"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Grid lines */}
                  {weekTicks.map((d) => (
                    <div
                      key={d}
                      className="absolute top-0 h-full border-l border-border/10"
                      style={{ left: d * DAY_WIDTH }}
                    />
                  ))}
                  {monthMarkers.map((m) => (
                    <div
                      key={`mg-${m.day}`}
                      className="absolute top-0 h-full border-l border-border/30"
                      style={{ left: m.day * DAY_WIDTH }}
                    />
                  ))}
                  {/* Today line */}
                  {todayOffset >= 0 && todayOffset < totalDays ? (
                    <div
                      className="absolute top-0 h-full w-px bg-primary/30"
                      style={{ left: todayOffset * DAY_WIDTH }}
                    />
                  ) : null}
                  {/* Bar */}
                  <Link
                    href={`/dashboard/issues/${issue.id}`}
                    prefetch={false}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium shadow-sm transition-opacity hover:opacity-90"
                    style={{
                      left,
                      width,
                      height: 26,
                      backgroundColor: barColor + '28',
                      border: `1px solid ${barColor}70`,
                      color: barColor,
                      overflow: 'hidden',
                    }}
                    title={`${issue.title} — ${format(r.start, 'MMM d')} → ${format(r.end, 'MMM d')}`}
                  >
                    <span className="truncate">{issue.title}</span>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

function issueRange(issue: IssueRow, today: Date): { start: Date; end: Date } {
  const start = issue.start_date
    ? startOfDay(new Date(issue.start_date))
    : startOfDay(new Date(issue.created_at))
  const end = issue.due_date
    ? startOfDay(new Date(issue.due_date))
    : addDays(start, 7)
  return { start, end: end.getTime() < start.getTime() ? start : end }
}
