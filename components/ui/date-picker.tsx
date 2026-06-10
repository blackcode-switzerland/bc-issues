'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react'

/**
 * Professional date picker — a calendar popover replacing native <input type="date">.
 *
 * Value is a plain `yyyy-MM-dd` string (or null). Two visual variants:
 *  - `chip`   — bordered chip for create-modals (matches the property-chip row)
 *  - `inline` — full-width quiet row for detail-page sidebars
 *
 * Parsing is timezone-safe: `yyyy-MM-dd` is read as a *local* calendar day, so
 * the selected date never drifts by a day across timezones.
 */

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function parseValue(value: string | null | undefined): Date | null {
  if (!value) return null
  // Accept full ISO timestamps too (detail pages sometimes pass them).
  const ymd = value.slice(0, 10)
  const d = parse(ymd, 'yyyy-MM-dd', new Date())
  return Number.isNaN(d.getTime()) ? null : d
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Set date',
  label,
  variant = 'inline',
  align = 'left',
  displayFormat = 'MMM d, yyyy',
  clearable = true,
  buttonClassName,
}: {
  value: string | null | undefined
  onChange: (v: string | null) => void
  placeholder?: string
  /** Optional leading label rendered inside chip variant (e.g. "Due date"). */
  label?: string
  variant?: 'chip' | 'inline'
  align?: 'left' | 'right'
  displayFormat?: string
  clearable?: boolean
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => parseValue(value), [value])
  const [viewMonth, setViewMonth] = useState<Date>(() => selected ?? new Date())

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (open) setViewMonth(selected ?? new Date())
  }, [open, selected])

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [viewMonth])

  function choose(day: Date) {
    onChange(format(day, 'yyyy-MM-dd'))
    setOpen(false)
  }

  const display = selected ? format(selected, displayFormat) : null

  const trigger =
    variant === 'chip' ? (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs hover:bg-secondary'
        }
      >
        <CalendarIcon size={12} className="text-muted-foreground" />
        {label ? <span className="text-muted-foreground">{label}</span> : null}
        <span className={display ? 'text-foreground' : 'text-muted-foreground'}>
          {display ?? placeholder}
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ??
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary'
        }
      >
        <CalendarIcon size={13} className="shrink-0 text-muted-foreground" />
        <span className={`flex-1 truncate ${display ? 'text-foreground' : 'text-muted-foreground'}`}>
          {display ?? placeholder}
        </span>
        {clearable && selected ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X size={12} />
          </span>
        ) : null}
      </button>
    )

  return (
    <div ref={ref} className="relative">
      {trigger}

      {open ? (
        <div
          className={`absolute top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-2 shadow-xl duration-100 animate-in fade-in zoom-in-95 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="mb-1 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-medium">{format(viewMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {DAY_LABELS.map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day) => {
              const isSelected = selected ? isSameDay(day, selected) : false
              const inMonth = isSameMonth(day, viewMonth)
              const today = isToday(day)
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => choose(day)}
                  className={`flex h-8 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors ${
                    isSelected
                      ? 'bg-primary font-medium text-primary-foreground'
                      : inMonth
                        ? 'text-foreground hover:bg-secondary'
                        : 'text-muted-foreground/50 hover:bg-secondary'
                  } ${today && !isSelected ? 'font-semibold text-primary' : ''}`}
                >
                  {format(day, 'd')}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => choose(new Date())}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Today
            </button>
            {clearable && selected ? (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
