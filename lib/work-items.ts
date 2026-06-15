// Canonical status + priority definitions for issues and projects. One source
// of truth, imported by both the query layer (validation, analytics) and the
// UI (dropdowns, kanban columns, colors). Plain data — safe on server + client.

export interface Option {
  value: string
  label: string
  color: string
}

// ---------- issues ----------

export const ISSUE_STATUSES: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#71717a' },
  { value: 'todo', label: 'Todo', color: '#a1a1aa' },
  { value: 'in_progress', label: 'In progress', color: '#f2c94c' },
  { value: 'done', label: 'Done', color: '#007bd3' },
  { value: 'cancelled', label: 'Cancelled', color: '#71717a' },
]

export const ISSUE_STATUS_VALUES = ISSUE_STATUSES.map((s) => s.value)
export const ISSUE_TERMINAL_STATUSES = ['done', 'cancelled']

export function issueStatusLabel(value: string): string {
  return ISSUE_STATUSES.find((s) => s.value === value)?.label ?? value
}
export function issueStatusColor(value: string): string {
  return ISSUE_STATUSES.find((s) => s.value === value)?.color ?? '#71717a'
}

// Priority is stored as an int 1..5 on issues. Listed in the order the user
// sees them: No priority, Urgent, High, Medium, Low.
export interface PriorityOption {
  value: number
  label: string
  color: string
}
export const ISSUE_PRIORITIES: PriorityOption[] = [
  { value: 5, label: 'No priority', color: '#71717a' },
  { value: 1, label: 'Urgent', color: '#ef4444' },
  { value: 2, label: 'High', color: '#f97316' },
  { value: 3, label: 'Medium', color: '#8a8f98' },
  { value: 4, label: 'Low', color: '#a1a1aa' },
]
export function issuePriorityLabel(value: number): string {
  return ISSUE_PRIORITIES.find((p) => p.value === value)?.label ?? '—'
}
export function issuePriorityColor(value: number): string {
  return ISSUE_PRIORITIES.find((p) => p.value === value)?.color ?? '#71717a'
}

// ---------- projects ----------

export const PROJECT_STATUSES: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#71717a' },
  { value: 'planned', label: 'Planned', color: '#a1a1aa' },
  { value: 'in_progress', label: 'In progress', color: '#f2c94c' },
  { value: 'completed', label: 'Completed', color: '#007bd3' },
  { value: 'cancelled', label: 'Cancelled', color: '#71717a' },
]
export const PROJECT_STATUS_VALUES = PROJECT_STATUSES.map((s) => s.value)
export function projectStatusLabel(value: string): string {
  return PROJECT_STATUSES.find((s) => s.value === value)?.label ?? value
}
export function projectStatusColor(value: string): string {
  return PROJECT_STATUSES.find((s) => s.value === value)?.color ?? '#71717a'
}

// Project priority stored as P0..P4 (P0 = highest). Same display order.
export const PROJECT_PRIORITIES: { value: string; label: string }[] = [
  { value: 'P4', label: 'No priority' },
  { value: 'P0', label: 'Urgent' },
  { value: 'P1', label: 'High' },
  { value: 'P2', label: 'Medium' },
  { value: 'P3', label: 'Low' },
]
export function projectPriorityLabel(value: string | null | undefined): string {
  return PROJECT_PRIORITIES.find((p) => p.value === value)?.label ?? 'No priority'
}

// ---------- project updates (health) ----------
// A project's posted status update — its "health". On track / At risk / Off track.

export const PROJECT_UPDATE_STATUSES: Option[] = [
  { value: 'on_track', label: 'On track', color: '#4cb782' },
  { value: 'at_risk', label: 'At risk', color: '#f2c94c' },
  { value: 'off_track', label: 'Off track', color: '#eb5757' },
]
export const PROJECT_UPDATE_STATUS_VALUES = PROJECT_UPDATE_STATUSES.map((s) => s.value)
export function projectUpdateStatusLabel(value: string | null | undefined): string {
  return PROJECT_UPDATE_STATUSES.find((s) => s.value === value)?.label ?? 'No updates'
}
export function projectUpdateStatusColor(value: string | null | undefined): string {
  return PROJECT_UPDATE_STATUSES.find((s) => s.value === value)?.color ?? '#8a8f98'
}
