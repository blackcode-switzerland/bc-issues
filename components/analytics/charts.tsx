// Tiny SVG chart primitives. Designed for the analytics dashboard:
//   - HorizontalBars : ranked counts (by_status, by_priority, by_assignee, by_label)
//   - Sparkline      : created/completed over time
//   - VelocityChart  : created vs completed dual-line
//   - BurndownChart  : remaining over time for milestone view
//
// All take pre-computed data. No external chart lib.

'use client'

import { useId } from 'react'

interface BarItem {
  label: string
  value: number
  color?: string
}

export function HorizontalBars({ items, max }: { items: BarItem[]; max?: number }) {
  const ceiling = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-1.5">
      {items.map((b, i) => (
        <li key={i}>
          <div className="mb-0.5 flex items-center justify-between text-[11px]">
            <span className="truncate text-foreground">{b.label}</span>
            <span className="text-muted-foreground">{b.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(b.value / ceiling) * 100}%`,
                backgroundColor: b.color ?? 'hsl(var(--primary))',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

interface SeriesPoint {
  bucket: string
  value: number
}

export function Sparkline({ data, color = '#5e6ad2' }: { data: SeriesPoint[]; color?: string }) {
  if (data.length === 0) return null
  const max = data.reduce((m, p) => Math.max(m, p.value), 0) || 1
  const w = 240
  const h = 48
  const stepX = data.length > 1 ? w / (data.length - 1) : 0
  const points = data.map((p, i) => {
    const x = i * stepX
    const y = h - (p.value / max) * (h - 4) - 2
    return `${x},${y}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points.join(' ')}
      />
    </svg>
  )
}

interface DualSeriesPoint {
  bucket: string
  created: number
  completed: number
}

export function VelocityChart({ data }: { data: DualSeriesPoint[] }) {
  const id = useId()
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No data in the selected range.</p>
  }
  const max =
    data.reduce(
      (m, p) => Math.max(m, p.created, p.completed),
      0
    ) || 1
  const w = 600
  const h = 160
  const padding = 28
  const innerW = w - padding * 2
  const innerH = h - padding * 2

  const xFor = (i: number) =>
    padding + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const yFor = (v: number) => padding + innerH - (v / max) * innerH

  const createdPts = data.map((p, i) => `${xFor(i)},${yFor(p.created)}`).join(' ')
  const completedPts = data.map((p, i) => `${xFor(i)},${yFor(p.completed)}`).join(' ')

  const ticks = 4
  const tickLabels = Array.from({ length: ticks + 1 }, (_, i) =>
    Math.round((max / ticks) * i)
  )

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-labelledby={id}>
        <title id={id}>Velocity — created vs completed over time</title>
        {tickLabels.map((t, i) => {
          const y = padding + innerH - (i / ticks) * innerH
          return (
            <g key={i}>
              <line
                x1={padding}
                x2={padding + innerW}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
                strokeDasharray="2 2"
              />
              <text
                x={padding - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 9 }}
              >
                {t}
              </text>
            </g>
          )
        })}
        <polyline fill="none" stroke="#5e6ad2" strokeWidth="1.5" points={createdPts} />
        <polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points={completedPts} />
      </svg>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: '#5e6ad2' }} />
          Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-emerald-500" />
          Completed
        </span>
      </div>
    </div>
  )
}

export function BurndownChart({ data }: { data: Array<{ date: string; remaining: number }> }) {
  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No burndown data.</p>
  }
  const max = data.reduce((m, p) => Math.max(m, p.remaining), 0) || 1
  const w = 600
  const h = 160
  const padding = 28
  const innerW = w - padding * 2
  const innerH = h - padding * 2

  const xFor = (i: number) =>
    padding + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const yFor = (v: number) => padding + innerH - (v / max) * innerH

  const points = data.map((p, i) => `${xFor(i)},${yFor(p.remaining)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <line
        x1={padding}
        x2={padding + innerW}
        y1={padding}
        y2={padding + innerH}
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeDasharray="3 3"
      />
      <polyline fill="none" stroke="#a855f7" strokeWidth="1.5" points={points} />
    </svg>
  )
}

export function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card/30 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
