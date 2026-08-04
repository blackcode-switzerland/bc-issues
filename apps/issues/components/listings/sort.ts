// Client-side sort for the listing pages. "Manual" preserves the server order
// (the `position` drag-order); every other key reorders the already
// fetched+filtered rows. Drag-to-reorder is only enabled under "manual".

export interface SortOption {
  value: string
  label: string
}

export const SORT_MANUAL = 'manual'

const BASE: SortOption[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'updated', label: 'Recently updated' },
]

export const PROJECT_SORTS: SortOption[] = [
  ...BASE,
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
]
export const ISSUE_SORTS: SortOption[] = [
  ...BASE,
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
]
export const TASK_SORTS: SortOption[] = [...BASE, { value: 'due', label: 'Due date' }]

function ts(s?: string | null): number {
  return s ? new Date(s).getTime() : 0
}

// Lower = higher priority. Issues use 1–5; projects use "P0".."P4"; null sinks.
function priorityValue(p?: number | string | null): number {
  if (p == null) return 999
  if (typeof p === 'number') return p
  const m = /\d+/.exec(p)
  return m ? parseInt(m[0]) : 999
}

// Earliest due first; missing dates sink to the bottom.
function dueCompare(a?: string | null, b?: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return ts(a) - ts(b)
}

interface Sortable {
  name?: string
  title?: string
  created_at?: string
  updated_at?: string
  due_date?: string | null
  priority?: number | string | null
}

// Returns a new sorted array (or the original reference for "manual").
export function sortItems<T extends Sortable>(rows: T[], key: string): T[] {
  if (key === SORT_MANUAL) return rows
  const arr = [...rows]
  const nameOf = (x: T) => String(x.name ?? x.title ?? '')
  switch (key) {
    case 'name':
      arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }))
      break
    case 'newest':
      arr.sort((a, b) => ts(b.created_at) - ts(a.created_at))
      break
    case 'oldest':
      arr.sort((a, b) => ts(a.created_at) - ts(b.created_at))
      break
    case 'updated':
      arr.sort((a, b) => ts(b.updated_at) - ts(a.updated_at))
      break
    case 'priority':
      arr.sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority))
      break
    case 'due':
      arr.sort((a, b) => dueCompare(a.due_date, b.due_date))
      break
    default:
      return rows
  }
  return arr
}
