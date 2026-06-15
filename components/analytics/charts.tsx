// SVG chart kit for the analytics dashboard. No external chart library — these
// are small, themed, accessible primitives that all take pre-computed data:
//
//   KpiCard       — headline metric with trend badge + optional sparkline
//   TrendBadge    — ▲/▼ percent-change pill (invert for "lower is better")
//   Sparkline     — tiny inline line/area
//   AreaLineChart — multi-series line/area with grid, axes, hover tooltip
//   DonutChart    — ring distribution with center total + legend
//   HorizontalBars— ranked counts with value + optional percent
//   ColumnChart   — vertical histogram (cycle time, aging) with hover
//   BurndownChart — actual vs ideal remaining over time
//
// Colors use the live theme via CSS vars where possible (var(--primary)).

'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

const fmt = new Intl.NumberFormat('en-US')
const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function formatNumber(n: number): string {
  return Math.abs(n) >= 10000 ? fmtCompact.format(n) : fmt.format(n)
}

// Shared series palette (used by line/area + activity charts).
export const SERIES = {
  created: 'var(--primary)',
  completed: '#22c55e',
  activity: '#8b5cf6',
  ideal: '#a1a1aa',
}

// ---------- Trend badge ----------

export function TrendBadge({
  pct,
  invert = false,
  className,
}: {
  pct: number | null
  invert?: boolean
  className?: string
}) {
  if (pct == null) return null
  const flat = Math.abs(pct) < 0.05
  // "good" = green. For most metrics up is good; for cycle time (invert) down is good.
  const good = flat ? null : invert ? pct < 0 : pct > 0
  const color =
    good == null
      ? 'text-muted-foreground'
      : good
        ? 'text-emerald-600 dark:text-emerald-500'
        : 'text-rose-600 dark:text-rose-500'
  const Icon = flat ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${color} ${className ?? ''}`}
      title="vs. previous period"
    >
      <Icon size={12} strokeWidth={2.5} />
      {Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  )
}

// ---------- KPI card ----------

export function KpiCard({
  label,
  value,
  hint,
  pct,
  invert = false,
  spark,
  accent,
}: {
  label: string
  value: number | string
  hint?: string
  pct?: number | null
  invert?: boolean
  spark?: number[]
  accent?: string
}) {
  return (
    <div className="group relative flex flex-col justify-between gap-3 overflow-hidden bg-card p-4 transition-colors hover:bg-accent/40">
      {accent ? (
        <span
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {pct != null ? <TrendBadge pct={pct} invert={invert} /> : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] font-semibold leading-none tabular-nums">
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
          {hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        {spark && spark.length > 1 ? (
          <Sparkline values={spark} color={accent ?? 'var(--primary)'} className="w-20" />
        ) : null}
      </div>
    </div>
  )
}

// ---------- Sparkline ----------

export function Sparkline({
  values,
  color = 'var(--primary)',
  className,
  fill = true,
}: {
  values: number[]
  color?: string
  className?: string
  fill?: boolean
}) {
  const id = useId()
  if (values.length < 2) return null
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const w = 80
  const h = 28
  const stepX = w / (values.length - 1)
  const yFor = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 3) - 1.5
  const pts = values.map((v, i) => `${i * stepX},${yFor(v)}`)
  const area = `0,${h} ${pts.join(' ')} ${w},${h}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-7 ${className ?? ''}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <polygon points={area} fill={`url(#sp-${id})`} /> : null}
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ---------- Multi-series line / area chart ----------

export interface ChartSeries {
  key: string
  label: string
  color: string
  fill?: boolean
}

type Row = { bucket: string; [key: string]: string | number }

const num = (v: string | number | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0))

export function AreaLineChart({
  data,
  series,
  height = 240,
  formatX,
  emptyLabel = 'No data in the selected range.',
}: {
  data: Row[]
  series: ChartSeries[]
  height?: number
  formatX?: (bucket: string) => string
  emptyLabel?: string
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const w = 720
  const h = height
  const padL = 36
  const padR = 12
  const padT = 12
  const padB = 26
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const max = useMemo(() => {
    const m = data.reduce(
      (acc, row) => Math.max(acc, ...series.map((s) => num(row[s.key]))),
      0
    )
    return Math.max(1, Math.ceil(m / 4) * 4)
  }, [data, series])

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        {emptyLabel}
      </div>
    )
  }

  const xFor = (i: number) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const yFor = (v: number) => padT + innerH - (v / max) * innerH

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => Math.round((max / ticks) * i))

  // X labels — aim for ~6 evenly spaced.
  const xLabelStep = Math.max(1, Math.ceil(data.length / 6))
  const formatXLabel = formatX ?? ((b: string) => b.slice(5))

  function handleMove(e: React.MouseEvent) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const vbX = ((e.clientX - rect.left) / rect.width) * w
    const idx = Math.round(((vbX - padL) / innerW) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, idx)))
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full touch-none select-none"
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* gridlines + y axis labels */}
        {yTicks.map((t, i) => {
          const y = padT + innerH - (i / ticks) * innerH
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={padL - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 9 }}
              >
                {formatNumber(t)}
              </text>
            </g>
          )
        })}

        {/* x axis labels */}
        {data.map((row, i) =>
          i % xLabelStep === 0 || i === data.length - 1 ? (
            <text
              key={i}
              x={xFor(i)}
              y={h - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: 9 }}
            >
              {formatXLabel(row.bucket)}
            </text>
          ) : null
        )}

        {/* area fills */}
        {series.map((s) =>
          s.fill ? (
            <polygon
              key={`fill-${s.key}`}
              points={`${xFor(0)},${padT + innerH} ${data
                .map((row, i) => `${xFor(i)},${yFor(num(row[s.key]))}`)
                .join(' ')} ${xFor(data.length - 1)},${padT + innerH}`}
              fill={`url(#g-${id}-${s.key})`}
            />
          ) : null
        )}

        {/* lines */}
        {series.map((s) => (
          <polyline
            key={`line-${s.key}`}
            points={data.map((row, i) => `${xFor(i)},${yFor(num(row[s.key]))}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* hover crosshair + points */}
        {hover != null ? (
          <g>
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={padT}
              y2={padT + innerH}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeDasharray="3 3"
            />
            {series.map((s) => (
              <circle
                key={`pt-${s.key}`}
                cx={xFor(hover)}
                cy={yFor(num(data[hover][s.key]))}
                r="3"
                fill="var(--background)"
                stroke={s.color}
                strokeWidth="2"
              />
            ))}
          </g>
        ) : null}
      </svg>

      {/* tooltip */}
      {hover != null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: `${(xFor(hover) / w) * 100}%` }}
        >
          <p className="mb-1 font-medium text-foreground">{formatXLabel(data[hover].bucket)}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">
                {formatNumber(num(data[hover][s.key]))}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color }))} />
    </div>
  )
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

// ---------- Donut ----------

export interface DonutSlice {
  label: string
  value: number
  color: string
}

export function DonutChart({
  data,
  centerLabel,
  size = 168,
}: {
  data: DonutSlice[]
  centerLabel?: string
  size?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((a, s) => a + s.value, 0)
  if (total === 0) {
    return <p className="text-xs text-muted-foreground">No data.</p>
  }
  const stroke = size * 0.13
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r

  let offset = 0
  const segments = data.map((s) => {
    const frac = s.value / total
    const seg = { ...s, frac, dash: frac * circ, offset }
    offset += frac * circ
    return seg
  })

  const active = hover != null ? segments[hover] : null

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity="0.06" strokeWidth={stroke} />
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${seg.dash} ${circ - seg.dash}`}
              strokeDashoffset={-seg.offset}
              strokeLinecap="butt"
              className="transition-opacity"
              style={{ opacity: hover == null || hover === i ? 1 : 0.3, cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold leading-none tabular-nums">
            {active ? formatNumber(active.value) : formatNumber(total)}
          </span>
          <span className="mt-1 max-w-[80%] truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {active ? active.label : centerLabel ?? 'Total'}
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((seg, i) => (
          <li
            key={i}
            className="flex items-center gap-2 text-[12px]"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: seg.color }} />
            <span className="truncate text-foreground">{seg.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(seg.value)}
              <span className="ml-1.5 text-[10px]">{Math.round(seg.frac * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Horizontal bars ----------

export interface BarItem {
  label: string
  value: number
  color?: string
  sub?: string
}

export function HorizontalBars({
  items,
  max,
  showPercent = false,
  emptyLabel = 'No data.',
}: {
  items: BarItem[]
  max?: number
  showPercent?: boolean
  emptyLabel?: string
}) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  const total = items.reduce((a, b) => a + b.value, 0)
  const ceiling = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-2.5">
      {items.map((b, i) => (
        <li key={i}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              {b.color ? (
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
              ) : null}
              <span className="truncate">{b.label}</span>
              {b.sub ? <span className="shrink-0 text-[11px] text-muted-foreground">{b.sub}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(b.value)}
              {showPercent && total > 0 ? (
                <span className="ml-1.5 text-[10px]">{Math.round((b.value / total) * 100)}%</span>
              ) : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(2, (b.value / ceiling) * 100)}%`,
                backgroundColor: b.color ?? 'var(--primary)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- Column chart (histogram) ----------

export function ColumnChart({
  data,
  color = 'var(--primary)',
  height = 180,
  emptyLabel = 'No data.',
}: {
  data: Array<{ label: string; count: number }>
  color?: string
  height?: number
  emptyLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((a, d) => a + d.count, 0)
  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        {emptyLabel}
      </div>
    )
  }
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d, i) => {
        const pct = (d.count / max) * 100
        return (
          <div
            key={i}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className={`text-[11px] font-medium tabular-nums transition-opacity ${
                hover === i ? 'opacity-100 text-foreground' : 'opacity-0'
              }`}
            >
              {formatNumber(d.count)}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-[3px] transition-all duration-500"
                style={{
                  height: `${Math.max(2, pct)}%`,
                  backgroundColor: color,
                  opacity: hover == null || hover === i ? 1 : 0.45,
                }}
              />
            </div>
            <span className="truncate text-[10px] text-muted-foreground">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Burndown ----------

export function BurndownChart({
  data,
  height = 240,
}: {
  data: Array<{ date: string; remaining: number; ideal: number }>
  height?: number
}) {
  return (
    <AreaLineChart
      data={data.map((d) => ({ bucket: d.date, remaining: d.remaining, ideal: d.ideal }))}
      series={[
        { key: 'remaining', label: 'Remaining', color: 'var(--primary)', fill: true },
        { key: 'ideal', label: 'Ideal', color: SERIES.ideal },
      ]}
      height={height}
      emptyLabel="No burndown data."
    />
  )
}

// ---------- Back-compat: SummaryCard (used by print view) ----------

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
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

// Back-compat shim for the old VelocityChart name.
export function VelocityChart({ data }: { data: Array<{ bucket: string; created: number; completed: number }> }) {
  return (
    <AreaLineChart
      data={data}
      series={[
        { key: 'created', label: 'Created', color: SERIES.created, fill: true },
        { key: 'completed', label: 'Completed', color: SERIES.completed, fill: true },
      ]}
    />
  )
}
