'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { MemberAvatar } from './member-avatar'

export interface AssigneeOption {
  user_id: number
  name: string | null
  email: string
  avatar_url?: string | null
}

export interface AssigneeInfo {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
}

interface MultiAssigneeSelectProps {
  /** Currently assigned users */
  assignees: AssigneeInfo[]
  /** All available members to choose from */
  members: AssigneeOption[]
  onChange: (ids: number[]) => void
  /** Render as avatar stack without extra chrome (used in list rows) */
  compact?: boolean
  /** Right-align the dropdown */
  align?: 'left' | 'right'
  disabled?: boolean
}

export function MultiAssigneeSelect({
  assignees,
  members,
  onChange,
  compact = false,
  align = 'left',
  disabled = false,
}: MultiAssigneeSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const assignedIds = new Set(assignees.map((a) => a.id))

  function toggle(uid: number) {
    const next = assignedIds.has(uid)
      ? [...assignedIds].filter((id) => id !== uid)
      : [...assignedIds, uid]
    onChange(next)
  }

  const filtered = search
    ? members.filter(
        (m) =>
          (m.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
          m.email.toLowerCase().includes(search.toLowerCase())
      )
    : members

  const displayAssignees = assignees.slice(0, 3)
  const overflow = assignees.length - displayAssignees.length

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={
          compact
            ? 'flex items-center rounded p-0.5 hover:bg-secondary disabled:cursor-not-allowed'
            : 'flex min-h-8 flex-wrap items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-secondary disabled:cursor-not-allowed'
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {assignees.length === 0 ? (
          compact ? (
            <span className="flex size-[15px] items-center justify-center rounded-full bg-neutral-700 text-[7px] font-semibold tracking-tight text-neutral-400">
              UA
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <UserPlus size={14} />
              <span>Assignees</span>
            </span>
          )
        ) : (
          <span className="flex items-center">
            {displayAssignees.map((a, i) => (
              <span
                key={a.id}
                className="block"
                style={{ marginLeft: i > 0 ? '-4px' : 0, zIndex: displayAssignees.length - i }}
              >
                <MemberAvatar name={a.name} email={a.email} avatarUrl={a.avatar_url} size={compact ? 15 : 18} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">+{overflow}</span>
            )}
            {!compact && (
              <span className="ml-1.5 truncate max-w-[120px]">
                {assignees.length === 1
                  ? (assignees[0].name ?? assignees[0].email)
                  : `${assignees.length} assignees`}
              </span>
            )}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-card py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          role="listbox"
          aria-multiselectable="true"
        >
          <div className="border-b border-border px-2 pb-1">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No members found</p>
            )}
            {filtered.map((m) => {
              const selected = assignedIds.has(m.user_id)
              return (
                <button
                  key={m.user_id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => toggle(m.user_id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={16} />
                  <span className="flex-1 truncate">{m.name ?? m.email}</span>
                  {selected && <Check size={13} className="shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
          {assignees.length > 0 && (
            <div className="border-t border-border px-2 pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-1 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
