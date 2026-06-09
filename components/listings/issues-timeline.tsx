'use client'

import Link from 'next/link'
import { addDays, differenceInDays, format, max as maxDate, min as minDate, startOfDay } from 'date-fns'
import { issueStatusColor } from '@/lib/work-items'

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
}

const ROW_HEIGHT = 36
const DAY_WIDTH = 28
const LABEL_WIDTH = 220

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
  const earliest = startOfDay(minDate(ranges.map((r) => r.start)))
  const latest = startOfDay(maxDate(ranges.map((r) => r.end)))
  const totalDays = Math.max(differenceInDays(latest, earliest) + 1, 7)
  const timelineWidth = totalDays * DAY_WIDTH

  // Day markers — show a tick per day, label every 5 days
  const ticks: Array<{ day: number; date: Date; isFirstOfMonth: boolean }> = []
  for (let d = 0; d < totalDays; d++) {
    const date = addDays(earliest, d)
    ticks.push({ day: d, date, isFirstOfMonth: date.getDate() === 1 })
  }
  const todayOffset = differenceInDays(today, earliest)

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card/30">
      <div style={{ width: LABEL_WIDTH + timelineWidth + 16 }}>
        {/* Axis */}
        <div className="sticky top-0 z-10 flex border-b border-border bg-card/60 backdrop-blur">
          <div className="shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" style={{ width: LABEL_WIDTH }}>
            Issue
          </div>
          <div className="relative" style={{ width: timelineWidth }}>
            {ticks.map((t) => (
              <div
                key={t.day}
                className="absolute top-0 h-full border-l border-border/40 text-[9px] text-muted-foreground"
                style={{ left: t.day * DAY_WIDTH }}
              >
                {t.isFirstOfMonth ? (
                  <span className="absolute left-1 top-1.5 font-medium text-foreground">
                    {format(t.date, 'MMM')}
                  </span>
                ) : t.day % 5 === 0 ? (
                  <span className="absolute left-1 top-1.5">{format(t.date, 'd')}</span>
                ) : null}
              </div>
            ))}
            {/* today line */}
            {todayOffset >= 0 && todayOffset < totalDays ? (
              <div
                className="absolute top-0 h-full w-px bg-primary"
                style={{ left: todayOffset * DAY_WIDTH }}
              />
            ) : null}
          </div>
        </div>

        {/* Rows */}
        <div>
          {issues.map((issue, idx) => {
            const r = ranges[idx]
            const left = differenceInDays(r.start, earliest) * DAY_WIDTH
            const width = Math.max((differenceInDays(r.end, r.start) + 1) * DAY_WIDTH - 4, 4)
            const color = issueStatusColor(issue.status)
            return (
              <div
                key={issue.id}
                className="flex border-b border-border/40 hover:bg-secondary/20"
                style={{ height: ROW_HEIGHT }}
              >
                <Link
                  href={`/dashboard/issues/${issue.id}`}
                  prefetch={false}
                  className="flex shrink-0 items-center gap-2 px-3 text-xs"
                  style={{ width: LABEL_WIDTH }}
                >
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {issue.seq != null ? `${workspaceKey}-${issue.seq}` : `#${issue.id}`}
                  </span>
                  <span className="flex-1 truncate">{issue.title}</span>
                </Link>
                <div className="relative" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
                  {/* day grid */}
                  {ticks.map((t) => (
                    <div
                      key={t.day}
                      className="absolute top-0 h-full border-l border-border/20"
                      style={{ left: t.day * DAY_WIDTH }}
                    />
                  ))}
                  {/* today line */}
                  {todayOffset >= 0 && todayOffset < totalDays ? (
                    <div
                      className="absolute top-0 h-full w-px bg-primary/40"
                      style={{ left: todayOffset * DAY_WIDTH }}
                    />
                  ) : null}
                  <Link
                    href={`/dashboard/issues/${issue.id}`}
                    prefetch={false}
                    className="absolute top-1/2 -translate-y-1/2 rounded text-[10px] font-medium leading-tight shadow-sm"
                    style={{
                      left,
                      width,
                      height: 18,
                      backgroundColor: color + '30',
                      border: `1px solid ${color}80`,
                      color,
                      paddingLeft: 6,
                      paddingRight: 6,
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                    }}
                    title={`${issue.title} — ${format(r.start, 'MMM d')} → ${format(r.end, 'MMM d')}`}
                  >
                    <span className="truncate">{issue.assignee_name ?? issue.status.replace('_', ' ')}</span>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function issueRange(issue: IssueRow, today: Date): { start: Date; end: Date } {
  const start =
    issue.start_date ?? issue.created_at
      ? startOfDay(new Date(issue.start_date ?? issue.created_at))
      : today
  const end =
    issue.due_date
      ? startOfDay(new Date(issue.due_date))
      : addDays(start, 1)
  // Guarantee end >= start
  return {
    start,
    end: end.getTime() < start.getTime() ? start : end,
  }
}
