'use client'

import Link from 'next/link'
import { addDays, differenceInDays, format, max as maxDate, min as minDate, startOfDay } from 'date-fns'
import { projectStatusColor } from '@/lib/work-items'

interface ProjectRow {
  id: number
  name: string
  status: string
  color: string | null
  icon: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

const ROW_HEIGHT = 40
const DAY_WIDTH = 24
const LABEL_WIDTH = 220

export function ProjectsTimeline({ projects }: { projects: ProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
        <p className="text-sm text-muted-foreground">No projects to chart.</p>
      </div>
    )
  }

  const today = startOfDay(new Date())
  const ranges = projects.map((p) => range(p, today))
  const earliest = startOfDay(minDate(ranges.map((r) => r.start)))
  const latest = startOfDay(maxDate(ranges.map((r) => r.end)))
  const totalDays = Math.max(differenceInDays(latest, earliest) + 1, 14)
  const timelineWidth = totalDays * DAY_WIDTH

  const ticks: Array<{ day: number; date: Date; firstOfMonth: boolean }> = []
  for (let d = 0; d < totalDays; d++) {
    const date = addDays(earliest, d)
    ticks.push({ day: d, date, firstOfMonth: date.getDate() === 1 })
  }
  const todayOffset = differenceInDays(today, earliest)

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card/30">
      <div style={{ width: LABEL_WIDTH + timelineWidth + 16 }}>
        <div className="sticky top-0 z-10 flex border-b border-border bg-card/60 backdrop-blur">
          <div className="shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground" style={{ width: LABEL_WIDTH }}>
            Project
          </div>
          <div className="relative" style={{ width: timelineWidth }}>
            {ticks.map((t) => (
              <div
                key={t.day}
                className="absolute top-0 h-full border-l border-border/40 text-[9px] text-muted-foreground"
                style={{ left: t.day * DAY_WIDTH }}
              >
                {t.firstOfMonth ? (
                  <span className="absolute left-1 top-1.5 font-medium text-foreground">{format(t.date, 'MMM')}</span>
                ) : t.day % 7 === 0 ? (
                  <span className="absolute left-1 top-1.5">{format(t.date, 'd')}</span>
                ) : null}
              </div>
            ))}
            {todayOffset >= 0 && todayOffset < totalDays ? (
              <div className="absolute top-0 h-full w-px bg-primary" style={{ left: todayOffset * DAY_WIDTH }} />
            ) : null}
          </div>
        </div>

        <div>
          {projects.map((p, idx) => {
            const r = ranges[idx]
            const left = differenceInDays(r.start, earliest) * DAY_WIDTH
            const width = Math.max((differenceInDays(r.end, r.start) + 1) * DAY_WIDTH - 4, 6)
            const color = p.color ?? projectStatusColor(p.status)
            return (
              <div key={p.id} className="flex border-b border-border/40 hover:bg-secondary/20" style={{ height: ROW_HEIGHT }}>
                <Link
                  href={`/dashboard/${p.id}`}
                  prefetch={false}
                  className="flex shrink-0 items-center gap-2 px-3 text-xs"
                  style={{ width: LABEL_WIDTH }}
                >
                  <span className="flex-1 truncate">{p.name}</span>
                </Link>
                <div className="relative" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
                  {ticks.map((t) => (
                    <div key={t.day} className="absolute top-0 h-full border-l border-border/20" style={{ left: t.day * DAY_WIDTH }} />
                  ))}
                  {todayOffset >= 0 && todayOffset < totalDays ? (
                    <div className="absolute top-0 h-full w-px bg-primary/40" style={{ left: todayOffset * DAY_WIDTH }} />
                  ) : null}
                  <Link
                    href={`/dashboard/${p.id}`}
                    prefetch={false}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center rounded text-[10px] font-medium shadow-sm"
                    style={{
                      left,
                      width,
                      height: 20,
                      backgroundColor: color + '30',
                      border: `1px solid ${color}80`,
                      color,
                      paddingLeft: 6,
                      paddingRight: 6,
                      overflow: 'hidden',
                    }}
                    title={`${p.name} — ${format(r.start, 'MMM d')} → ${format(r.end, 'MMM d')}`}
                  >
                    <span className="truncate">{p.status.replace('_', ' ')}</span>
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

function range(p: ProjectRow, today: Date): { start: Date; end: Date } {
  const start = p.start_date
    ? startOfDay(new Date(p.start_date))
    : startOfDay(new Date(p.created_at))
  const end = p.end_date ? startOfDay(new Date(p.end_date)) : addDays(start, 7)
  return { start, end: end.getTime() < start.getTime() ? start : end }
}
