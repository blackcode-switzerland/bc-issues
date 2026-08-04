'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { PROJECT_ICON_MAP, ProjectIcon, searchProjectIcons } from './project-icon'

export const ICON_COLORS = [
  '#6b7280', // gray
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#22c55e', // green
  '#eab308', // amber
  '#f97316', // orange
  '#ec4899', // pink
  '#ef4444', // red
  '#a855f7', // purple
]

interface IconPickerProps {
  icon: string | null
  color: string
  name?: string
  onChange: (next: { icon: string | null; color: string }) => void
}

// Linear-style icon + color picker. The chosen color tints the icon. Click the
// tile to open a popover with color swatches and a searchable icon grid.
export function IconPicker({ icon, color, name, onChange }: IconPickerProps) {
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

  const results = searchProjectIcons(query)

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border p-1 pr-2 transition-colors hover:bg-secondary"
        title="Choose icon & color"
      >
        <ProjectIcon icon={icon} color={color} name={name} size={32} />
        <ChevronDown size={13} className="text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          {/* color swatches */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-3">
            {ICON_COLORS.map((c) => {
              const selected = c.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ icon, color: c })}
                  className="flex size-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: c }}
                  title={c}
                >
                  {selected ? <Check size={13} className="text-white" /> : null}
                </button>
              )
            })}
          </div>

          {/* search */}
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search icons…"
                className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* grid */}
          <div className="max-h-56 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">No icons match.</p>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {results.map((key) => {
                  const Icon = PROJECT_ICON_MAP[key]
                  const selected = key === icon
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onChange({ icon: key, color })}
                      title={key}
                      className={`flex aspect-square items-center justify-center rounded-md transition-colors hover:bg-secondary ${
                        selected ? 'ring-1 ring-primary' : ''
                      }`}
                      style={selected ? { color } : undefined}
                    >
                      <Icon size={16} className={selected ? '' : 'text-muted-foreground'} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
