'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowUpDown,
  Filter,
  Search,
  ChevronDown,
  X,
  MessageSquare,
  Paperclip,
  Plus,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { CreateIssueModal } from '@/components/create-issue-modal'

const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
] as const

const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500/10' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400/10' },
} as const

interface Issue {
  id: number
  title: string
  description?: string
  status: string
  priority: number
  assignee_id?: number
  assignee_name?: string
  assignee_avatar?: string
  project_id: number
  project_name?: string
  comment_count: number
  attachment_count: number
  created_at: string
  updated_at: string
}

type SortField = 'id' | 'title' | 'status' | 'priority' | 'created_at' | 'updated_at' | 'project_name'
type SortDirection = 'asc' | 'desc'

export default function AllIssuesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<number | null>(null)
  const [projectFilter, setProjectFilter] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const router = useRouter()

  // Fetch all issues (filtering is done client-side for simplicity with Neon serverless)
  const { data: issues = [], isLoading } = useQuery<Issue[]>({
    queryKey: ['all-issues'],
    queryFn: async () => {
      const res = await fetch('/api/issues?includeProject=true')
      if (!res.ok) throw new Error('Failed to fetch issues')
      return res.json()
    },
  })

  // Fetch projects for filter
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')
      return res.json()
    },
  })

  // Fetch users for filter
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      if (!res.ok) return []
      return res.json()
    },
  })

  // Filter and sort issues
  const filteredIssues = issues
    .filter((issue) => {
      // Status filter
      if (statusFilter && issue.status !== statusFilter) return false
      // Priority filter
      if (priorityFilter && issue.priority !== priorityFilter) return false
      // Assignee filter
      if (assigneeFilter && issue.assignee_id !== assigneeFilter) return false
      // Project filter
      if (projectFilter && issue.project_id !== projectFilter) return false
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (
          !issue.title.toLowerCase().includes(query) &&
          !issue.id.toString().includes(query) &&
          !issue.project_name?.toLowerCase().includes(query)
        ) {
          return false
        }
      }
      return true
    })
    .sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]

      if (sortField === 'priority') {
        // Lower number = higher priority
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
      }
    })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const clearFilters = () => {
    setStatusFilter(null)
    setPriorityFilter(null)
    setAssigneeFilter(null)
    setProjectFilter(null)
    setSearchQuery('')
  }

  const activeFiltersCount =
    (statusFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (assigneeFilter ? 1 : 0) +
    (projectFilter ? 1 : 0)

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">All Issues</h1>
              <p className="text-sm text-muted-foreground mt-1" data-loading={isLoading || undefined}>
                {isLoading ? (
                  <span className="inline-block h-4 w-20 bg-muted animate-pulse rounded" />
                ) : (
                  `${filteredIssues.length} issue${filteredIssues.length !== 1 ? 's' : ''}`
                )}
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={18} />
              New Issue
            </button>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search issues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors ${
                activeFiltersCount > 0 ? 'border-primary' : ''
              }`}
            >
              <Filter size={16} />
              Filters
              {activeFiltersCount > 0 && (
                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
                Clear
              </button>
            )}
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 bg-secondary/50 rounded-lg border border-border space-y-3"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Status</label>
                  <select
                    value={statusFilter || ''}
                    onChange={(e) => setStatusFilter(e.target.value || null)}
                    className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All</option>
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Priority</label>
                  <select
                    value={priorityFilter || ''}
                    onChange={(e) =>
                      setPriorityFilter(e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All</option>
                    <option value="1">Urgent</option>
                    <option value="2">High</option>
                    <option value="3">Medium</option>
                    <option value="4">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Assignee</label>
                  <select
                    value={assigneeFilter || ''}
                    onChange={(e) =>
                      setAssigneeFilter(e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Project</label>
                  <select
                    value={projectFilter || ''}
                    onChange={(e) =>
                      setProjectFilter(e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="w-full px-3 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All</option>
                    {projects.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </header>

      {/* Table */}
      <main className="p-6">
        {isLoading ? (
          <div data-loading="true" className="space-y-3">
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-muted-foreground">Loading issues...</p>
            </div>
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="h-16 bg-card rounded-lg border border-border animate-pulse"
              />
            ))}
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No issues found</h2>
            <p className="text-muted-foreground">
              {searchQuery || activeFiltersCount > 0
                ? 'Try adjusting your filters'
                : 'Create your first issue to get started'}
            </p>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('id')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        ID
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('title')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Title
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('project_name')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Project
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('status')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Status
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('priority')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Priority
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Assignee
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('created_at')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Created
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left">
                      <button
                        onClick={() => handleSort('updated_at')}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Updated
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIssues.map((issue) => {
                    const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
                    const status = STATUSES.find((s) => s.id === issue.status)

                    return (
                      <tr
                        key={issue.id}
                        onClick={() => router.push(`/dashboard/issues/${issue.id}`)}
                        className="border-b border-border hover:bg-secondary/50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-muted-foreground">
                            #{issue.id}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{issue.title}</span>
                            {issue.comment_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MessageSquare size={12} />
                                {issue.comment_count}
                              </span>
                            )}
                            {issue.attachment_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Paperclip size={12} />
                                {issue.attachment_count}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/${issue.project_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm text-muted-foreground hover:text-primary"
                          >
                            {issue.project_name || `Project #${issue.project_id}`}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`status-badge status-${issue.status}`}>
                            {status?.label || issue.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {priority && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}
                            >
                              {priority.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {issue.assignee_avatar ? (
                            <Image
                              src={issue.assignee_avatar}
                              alt={issue.assignee_name || 'Assignee'}
                              width={24}
                              height={24}
                              className="rounded-full"
                              title={issue.assignee_name}
                            />
                          ) : issue.assignee_name ? (
                            <div
                              className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center text-[10px] font-medium"
                              title={issue.assignee_name}
                            >
                              {issue.assignee_name.charAt(0)}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(issue.created_at))} ago
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(issue.updated_at))} ago
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Create Issue Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateIssueModal
            onClose={() => setShowCreateModal(false)}
            onSuccess={(newIssue) => {
              // Navigate to the new issue
              router.push(`/dashboard/issues/${newIssue.id}`)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

