'use client'

/**
 * Linear-style status + priority glyphs. One canonical source — used by
 * listings, kanban, detail pages and create modals so every surface renders
 * work-item state identically.
 *
 * Status:   backlog = dashed circle · todo/planned = empty circle ·
 *           in progress = yellow pie · done/completed = indigo check ·
 *           cancelled = gray x
 * Priority: urgent = orange "!" square · high/medium/low = signal bars ·
 *           none = dashes
 */

const STATUS_COLORS: Record<string, string> = {
  backlog: '#8a8f98',
  todo: '#8a8f98',
  planned: '#8a8f98',
  in_progress: '#f2c94c',
  done: '#5e6ad2',
  completed: '#5e6ad2',
  cancelled: '#8a8f98',
}

export function StatusIcon({
  status,
  size = 14,
  className,
}: {
  status: string
  size?: number
  className?: string
}) {
  const color = STATUS_COLORS[status] ?? '#8a8f98'
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    className,
    'aria-hidden': true as const,
  }

  switch (status) {
    case 'backlog':
      return (
        <svg {...common}>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray="1.8 1.9"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'in_progress':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
          {/* half-pie fill */}
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={color} />
        </svg>
      )
    case 'done':
    case 'completed':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" fill={color} />
          <path
            d="M4.5 7.2 L6.3 9 L9.7 5.4"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'cancelled':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" fill={color} />
          <path
            d="M5 5 L9 9 M9 5 L5 9"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    // todo, planned, and anything unknown
    default:
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" />
        </svg>
      )
  }
}

export type PriorityKey = 'none' | 'urgent' | 'high' | 'medium' | 'low'

/** Map an issue's numeric priority (1..5) to a glyph key. */
export function issuePriorityKey(value: number | null | undefined): PriorityKey {
  switch (value) {
    case 1:
      return 'urgent'
    case 2:
      return 'high'
    case 3:
      return 'medium'
    case 4:
      return 'low'
    default:
      return 'none'
  }
}

/** Map a project's P0..P4 priority to a glyph key. */
export function projectPriorityKey(value: string | null | undefined): PriorityKey {
  switch (value) {
    case 'P0':
      return 'urgent'
    case 'P1':
      return 'high'
    case 'P2':
      return 'medium'
    case 'P3':
      return 'low'
    default:
      return 'none'
  }
}

export function PriorityIcon({
  priority,
  size = 14,
  className,
}: {
  priority: PriorityKey
  size?: number
  className?: string
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    className,
    'aria-hidden': true as const,
  }
  // Signal bars: x positions 2 / 6 / 10, widths 2.5, heights 4 / 7 / 10
  const bar = (x: number, h: number, on: boolean) => (
    <rect
      key={x}
      x={x}
      y={12 - h}
      width="2.5"
      height={h}
      rx="1"
      fill="currentColor"
      opacity={on ? 0.9 : 0.25}
    />
  )

  switch (priority) {
    case 'urgent':
      return (
        <svg {...common}>
          <rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill="#f2994a" />
          <path d="M7 3.6 V8" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="10.4" r="0.9" fill="white" />
        </svg>
      )
    case 'high':
      return (
        <svg {...common} className={`text-muted-foreground ${className ?? ''}`}>
          {bar(2, 4, true)}
          {bar(6, 7, true)}
          {bar(10, 10, true)}
        </svg>
      )
    case 'medium':
      return (
        <svg {...common} className={`text-muted-foreground ${className ?? ''}`}>
          {bar(2, 4, true)}
          {bar(6, 7, true)}
          {bar(10, 10, false)}
        </svg>
      )
    case 'low':
      return (
        <svg {...common} className={`text-muted-foreground ${className ?? ''}`}>
          {bar(2, 4, true)}
          {bar(6, 7, false)}
          {bar(10, 10, false)}
        </svg>
      )
    // 'none'
    default:
      return (
        <svg {...common} className={`text-muted-foreground ${className ?? ''}`}>
          <rect x="1.5" y="6.25" width="2.6" height="1.6" rx="0.8" fill="currentColor" opacity="0.55" />
          <rect x="5.7" y="6.25" width="2.6" height="1.6" rx="0.8" fill="currentColor" opacity="0.55" />
          <rect x="9.9" y="6.25" width="2.6" height="1.6" rx="0.8" fill="currentColor" opacity="0.55" />
        </svg>
      )
  }
}

const HEALTH_COLORS: Record<string, string> = {
  on_track: '#4cb782',
  at_risk: '#f2c94c',
  off_track: '#eb5757',
}

// Trend polylines per health state (rising / wavy / falling) in a 14×14 box.
const HEALTH_PATHS: Record<string, string> = {
  on_track: 'M3 9.5 L6 6.5 L8 8 L11 4',
  at_risk: 'M3 7 L5.5 5 L8.5 9 L11 6.5',
  off_track: 'M3 4.5 L6 7.5 L8 6 L11 10',
}

/**
 * Project "health" glyph — a sparkline inside a tinted circle.
 * on_track = green rising · at_risk = amber wavy · off_track = red falling.
 * Pass status `null`/unknown for the dashed "No updates" placeholder.
 */
export function HealthIcon({
  status,
  size = 14,
  className,
}: {
  status: string | null | undefined
  size?: number
  className?: string
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    className,
    'aria-hidden': true as const,
  }
  const color = status ? HEALTH_COLORS[status] : undefined
  const path = status ? HEALTH_PATHS[status] : undefined

  if (!color || !path) {
    return (
      <svg {...common}>
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="#8a8f98"
          strokeWidth="1.5"
          strokeDasharray="1.8 1.9"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <circle cx="7" cy="7" r="6.25" fill={color} opacity="0.16" />
      <circle cx="7" cy="7" r="6.25" stroke={color} strokeWidth="1" opacity="0.5" />
      <path
        d={path}
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Tiny circular progress ring (Linear-style percent indicator). */
export function ProgressRing({
  pct,
  size = 14,
  color = '#5e6ad2',
  className,
}: {
  pct: number
  size?: number
  color?: string
  className?: string
}) {
  const r = 5
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className} aria-hidden>
      <circle cx="7" cy="7" r={r} stroke="currentColor" strokeWidth="2" opacity="0.18" />
      <circle
        cx="7"
        cy="7"
        r={r}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * c} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}
