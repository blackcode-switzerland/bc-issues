'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Calendar,
  Target,
  CheckCircle2,
  Edit2,
  Save,
  Search,
  Filter,
  LayoutGrid,
  GanttChartSquare,
  List,
  MessageSquare,
  Paperclip,
  Plus,
  X,
} from 'lucide-react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

// Status configuration
const STATUSES = [
  { id: 'backlog', label: 'Backlog', color: 'gray' },
  { id: 'todo', label: 'To Do', color: 'blue' },
  { id: 'in_progress', label: 'In Progress', color: 'amber' },
  { id: 'blocked', label: 'Blocked', color: 'red' },
  { id: 'in_review', label: 'In Review', color: 'purple' },
  { id: 'done', label: 'Done', color: 'green' },
] as const

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; barBg: string }> = {
  backlog: { label: 'Backlog', color: 'text-gray-500', bg: 'bg-gray-500', barBg: 'bg-gray-400' },
  todo: { label: 'To Do', color: 'text-blue-500', bg: 'bg-blue-500', barBg: 'bg-blue-500' },
  in_progress: { label: 'In Progress', color: 'text-amber-500', bg: 'bg-amber-500', barBg: 'bg-amber-500' },
  blocked: { label: 'Blocked', color: 'text-red-500', bg: 'bg-red-500', barBg: 'bg-red-500' },
  in_review: { label: 'In Review', color: 'text-purple-500', bg: 'bg-purple-500', barBg: 'bg-purple-500' },
  done: { label: 'Done', color: 'text-green-500', bg: 'bg-green-500', barBg: 'bg-green-500' },
}

const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500/10', barBg: 'bg-red-500' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10', barBg: 'bg-amber-500' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500/10', barBg: 'bg-blue-500' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10', barBg: 'bg-gray-400' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400/10', barBg: 'bg-gray-300' },
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
  milestone_id?: number
  milestone_name?: string
  start_date?: string | null
  due_date?: string | null
  comment_count?: number
  attachment_count?: number
  created_at: string
  updated_at: string
}

interface Milestone {
  id: number
  name: string
  description?: string
  due_date?: string
  project_id: number
  project_name?: string
  issue_count: number
  completed_issues: number
  created_at: string
  issues?: Issue[]
}

type ViewMode = 'list' | 'kanban' | 'gantt'
type SortBy = 'priority' | 'status' | 'updated' | 'created'
type FilterStatus = 'all' | string

export default function MilestoneDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const milestoneId = parseInt(params.id as string)

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('priority')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterPriority, setFilterPriority] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [editedDueDate, setEditedDueDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showAddIssues, setShowAddIssues] = useState(false)
  const [addIssueSearch, setAddIssueSearch] = useState('')

  // Fetch milestone with issues
  const { data: milestone, isLoading } = useQuery<Milestone>({
    queryKey: ['milestone', milestoneId],
    queryFn: async () => {
      const res = await fetch(`/api/milestones/${milestoneId}?includeIssues=true`)
      if (!res.ok) throw new Error('Failed to fetch milestone')
      return res.json()
    },
  })

  // Fetch all issues from the same project (for adding to milestone)
  const { data: projectIssues = [] } = useQuery<Issue[]>({
    queryKey: ['project-issues', milestone?.project_id],
    queryFn: async () => {
      if (!milestone?.project_id) return []
      const res = await fetch(`/api/issues?project_id=${milestone.project_id}`)
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!milestone?.project_id && showAddIssues,
  })

  // Issues available to add (not already in milestone)
  const availableIssues = useMemo(() => {
    if (!projectIssues.length) return []
    const milestoneIssueIds = new Set(milestone?.issues?.map((i) => i.id) || [])
    return projectIssues
      .filter((issue) => !milestoneIssueIds.has(issue.id) && !issue.milestone_id)
      .filter((issue) => {
        if (!addIssueSearch) return true
        const query = addIssueSearch.toLowerCase()
        return issue.title.toLowerCase().includes(query) || issue.id.toString().includes(query)
      })
  }, [projectIssues, milestone?.issues, addIssueSearch])

  // Initialize edit form when milestone loads
  useEffect(() => {
    if (milestone && !isEditing) {
      setEditedName(milestone.name)
      setEditedDescription(milestone.description || '')
      setEditedDueDate(milestone.due_date ? milestone.due_date.split('T')[0] : '')
    }
  }, [milestone?.id, isEditing])

  // Update milestone mutation
  const updateMilestone = useMutation({
    mutationFn: async (data: { name?: string; description?: string; due_date?: string }) => {
      const res = await fetch(`/api/milestones/${milestoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestone', milestoneId] })
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      setIsEditing(false)
      toast.success('Milestone updated!')
    },
    onError: () => {
      toast.error('Failed to update milestone')
    },
  })

  // Update issue status mutation
  const updateIssueStatus = useMutation({
    mutationFn: async ({ issueId, status }: { issueId: number; status: string }) => {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update issue')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestone', milestoneId] })
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
    },
    onError: () => {
      toast.error('Failed to update issue')
    },
  })

  // Add issue to milestone mutation
  const addIssueToMilestone = useMutation({
    mutationFn: async (issueId: number) => {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestone_id: milestoneId }),
      })
      if (!res.ok) throw new Error('Failed to add issue to milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestone', milestoneId] })
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues', milestone?.project_id] })
      toast.success('Issue added to milestone!')
    },
    onError: () => {
      toast.error('Failed to add issue')
    },
  })

  // Remove issue from milestone mutation
  const removeIssueFromMilestone = useMutation({
    mutationFn: async (issueId: number) => {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestone_id: null }),
      })
      if (!res.ok) throw new Error('Failed to remove issue from milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestone', milestoneId] })
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      toast.success('Issue removed from milestone!')
    },
    onError: () => {
      toast.error('Failed to remove issue')
    },
  })

  // Filter and sort issues
  const filteredIssues = useMemo(() => {
    if (!milestone?.issues) return []

    let filtered = [...milestone.issues]

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          issue.id.toString().includes(query)
      )
    }

    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter((issue) => issue.status === filterStatus)
    }

    // Priority filter
    if (filterPriority !== null) {
      filtered = filtered.filter((issue) => issue.priority === filterPriority)
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          return a.priority - b.priority
        case 'status':
          const statusOrder = STATUSES.map((s) => s.id)
          return statusOrder.indexOf(a.status as any) - statusOrder.indexOf(b.status as any)
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default:
          return 0
      }
    })

    return filtered
  }, [milestone?.issues, searchQuery, filterStatus, filterPriority, sortBy])

  // Group issues by status for Kanban view
  const kanbanData = useMemo(() => {
    const data: Record<string, Issue[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      blocked: [],
      in_review: [],
      done: [],
    }

    for (const issue of filteredIssues) {
      if (data[issue.status]) {
        data[issue.status].push(issue)
      } else {
        data.backlog.push(issue)
      }
    }

    return data
  }, [filteredIssues])

  // Handle drag end for Kanban
  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result

    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index)
      return

    const issueId = parseInt(draggableId)
    const newStatus = destination.droppableId

    // Optimistically update the query cache
    queryClient.setQueryData<Milestone>(['milestone', milestoneId], (old) => {
      if (!old?.issues) return old
      return {
        ...old,
        issues: old.issues.map((issue) =>
          issue.id === issueId ? { ...issue, status: newStatus } : issue
        ),
      }
    })

    // Update on server
    updateIssueStatus.mutate({ issueId, status: newStatus })
  }

  const handleSave = () => {
    updateMilestone.mutate({
      name: editedName,
      description: editedDescription,
      due_date: editedDueDate || undefined,
    })
  }

  const activeFiltersCount =
    (filterStatus !== 'all' ? 1 : 0) + (filterPriority !== null ? 1 : 0)

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <div className="h-8 bg-card rounded-lg animate-pulse mb-4" />
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  if (!milestone) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center py-24">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
            <Target className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Milestone not found</h2>
          <Link href="/dashboard/milestones" className="text-primary hover:underline">
            Back to milestones
          </Link>
        </div>
      </div>
    )
  }

  const progress =
    milestone.issue_count > 0
      ? Math.round((milestone.completed_issues / milestone.issue_count) * 100)
      : 0

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard/milestones"
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div className="flex-1">
                {isEditing ? (
                  <input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="px-3 py-1 bg-background border border-input rounded-lg text-xl font-bold focus:outline-none focus:ring-2 focus:ring-ring w-full max-w-md"
                    autoFocus
                  />
                ) : (
                  <h1 className="text-2xl font-bold">{milestone.name}</h1>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  <Link
                    href={`/dashboard/${milestone.project_id}`}
                    className="hover:text-primary"
                  >
                    {milestone.project_name || `Project #${milestone.project_id}`}
                  </Link>
                  {' - '}
                  {milestone.issue_count} issue{milestone.issue_count !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddIssues(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                <Plus size={16} />
                Add Issues
              </button>
              {isEditing ? (
                <>
                  <button
                    onClick={() => {
                      setIsEditing(false)
                      setEditedName(milestone.name)
                      setEditedDescription(milestone.description || '')
                      setEditedDueDate(milestone.due_date ? milestone.due_date.split('T')[0] : '')
                    }}
                    className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={updateMilestone.isPending || !editedName.trim()}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Save size={16} />
                    Save
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80"
                >
                  <Edit2 size={16} />
                  Edit
                </button>
              )}
            </div>
          </div>

          {/* Progress and Details */}
          <div className="grid md:grid-cols-4 gap-4 mb-4">
            {/* Progress */}
            <div className="bg-background rounded-lg border border-input p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Progress</span>
                <span className="text-sm font-medium">{progress}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {milestone.completed_issues} of {milestone.issue_count} completed
              </p>
            </div>

            {/* Due Date */}
            <div className="bg-background rounded-lg border border-input p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Calendar size={14} />
                Due Date
              </div>
              {isEditing ? (
                <input
                  type="date"
                  value={editedDueDate}
                  onChange={(e) => setEditedDueDate(e.target.value)}
                  className="w-full px-2 py-1 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              ) : milestone.due_date ? (
                <p className="font-medium">
                  {format(new Date(milestone.due_date), 'MMM d, yyyy')}
                </p>
              ) : (
                <p className="text-muted-foreground">Not set</p>
              )}
            </div>

            {/* Status Summary */}
            <div className="bg-background rounded-lg border border-input p-4 md:col-span-2">
              <div className="text-sm text-muted-foreground mb-2">Status Breakdown</div>
              <div className="flex gap-2 flex-wrap">
                {STATUSES.map((status) => {
                  const count = milestone.issues?.filter((i) => i.status === status.id).length || 0
                  if (count === 0) return null
                  return (
                    <span
                      key={status.id}
                      className={`status-badge status-${status.id} text-xs`}
                    >
                      {status.label}: {count}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Description */}
          {(isEditing || milestone.description) && (
            <div className="mb-4">
              {isEditing ? (
                <textarea
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="Add a description..."
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={2}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{milestone.description}</p>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List size={16} className="inline mr-1.5" />
                List
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid size={16} className="inline mr-1.5" />
                Kanban
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'gantt'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <GanttChartSquare size={16} className="inline mr-1.5" />
                Gantt
              </button>
            </div>

            {/* Search */}
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

            {/* Filters */}
            <div className="relative">
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

              {showFilters && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-lg shadow-lg p-4 z-30">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-sm">Filters</span>
                    {activeFiltersCount > 0 && (
                      <button
                        onClick={() => {
                          setFilterStatus('all')
                          setFilterPriority(null)
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Status filter */}
                  <div className="mb-3">
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      Status
                    </label>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm"
                    >
                      <option value="all">All statuses</option>
                      {STATUSES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Priority filter */}
                  <div className="mb-3">
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      Priority
                    </label>
                    <select
                      value={filterPriority ?? ''}
                      onChange={(e) =>
                        setFilterPriority(e.target.value ? parseInt(e.target.value) : null)
                      }
                      className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm"
                    >
                      <option value="">All priorities</option>
                      <option value="1">Urgent</option>
                      <option value="2">High</option>
                      <option value="3">Medium</option>
                      <option value="4">Low</option>
                    </select>
                  </div>

                  {/* Sort */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      Sort by
                    </label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortBy)}
                      className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm"
                    >
                      <option value="priority">Priority</option>
                      <option value="status">Status</option>
                      <option value="updated">Recently updated</option>
                      <option value="created">Recently created</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        {filteredIssues.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {searchQuery || filterStatus !== 'all' || filterPriority !== null
                ? 'No matching issues'
                : 'No issues yet'}
            </h2>
            <p className="text-muted-foreground">
              {searchQuery || filterStatus !== 'all' || filterPriority !== null
                ? 'Try adjusting your filters'
                : 'Add issues to this milestone from the project board'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <ListView issues={filteredIssues} onRemove={(id) => removeIssueFromMilestone.mutate(id)} />
        ) : viewMode === 'kanban' ? (
          <KanbanView kanbanData={kanbanData} onDragEnd={handleDragEnd} />
        ) : (
          <GanttViewEmbedded issues={filteredIssues} milestone={milestone} />
        )}
      </main>

      {/* Add Issues Modal */}
      {showAddIssues && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setShowAddIssues(false)
              setAddIssueSearch('')
            }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
          >
            <div
              className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-lg font-semibold">Add Issues to Milestone</h2>
                <button
                  onClick={() => {
                    setShowAddIssues(false)
                    setAddIssueSearch('')
                  }}
                  className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search */}
              <div className="p-4 border-b border-border">
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    placeholder="Search issues..."
                    value={addIssueSearch}
                    onChange={(e) => setAddIssueSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    autoFocus
                  />
                </div>
              </div>

              {/* Issue list */}
              <div className="flex-1 overflow-y-auto p-4">
                {availableIssues.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {addIssueSearch
                      ? 'No matching issues found'
                      : 'All issues are already in a milestone'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {availableIssues.map((issue) => {
                      const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
                      const status = STATUS_CONFIG[issue.status]
                      return (
                        <button
                          key={issue.id}
                          onClick={() => addIssueToMilestone.mutate(issue.id)}
                          disabled={addIssueToMilestone.isPending}
                          className="w-full text-left p-3 bg-secondary/30 hover:bg-secondary rounded-lg transition-colors disabled:opacity-50"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-muted-foreground">#{issue.id}</span>
                            <span className="flex-1 text-sm font-medium truncate">{issue.title}</span>
                            <span className={`text-xs ${status?.color}`}>{status?.label}</span>
                            {priority && (
                              <span className={`text-xs ${priority.color}`}>{priority.label}</span>
                            )}
                            <Plus size={16} className="text-muted-foreground" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
                {availableIssues.length} issue{availableIssues.length !== 1 ? 's' : ''} available to add
              </div>
            </div>
          </motion.div>
        </>
      )}
    </div>
  )
}

// List View Component
function ListView({ issues, onRemove }: { issues: Issue[]; onRemove: (id: number) => void }) {
  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
        const status = STATUS_CONFIG[issue.status]

        return (
          <div
            key={issue.id}
            className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-all group"
          >
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-muted-foreground">#{issue.id}</span>
              <Link
                href={`/dashboard/issues/${issue.id}`}
                className="font-medium flex-1 hover:text-primary transition-colors"
              >
                {issue.title}
              </Link>
              <span className={`status-badge status-${issue.status}`}>{status?.label}</span>
              {priority && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
                  {priority.label}
                </span>
              )}
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
                  className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center text-xs font-medium"
                  title={issue.assignee_name}
                >
                  {issue.assignee_name.charAt(0)}
                </div>
              ) : null}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {(issue.comment_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <MessageSquare size={12} />
                    {issue.comment_count}
                  </span>
                )}
                {(issue.attachment_count ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <Paperclip size={12} />
                    {issue.attachment_count}
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (confirm('Remove this issue from the milestone?')) {
                    onRemove(issue.id)
                  }
                }}
                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-500 rounded transition-all"
                title="Remove from milestone"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Kanban View Component
function KanbanView({
  kanbanData,
  onDragEnd,
}: {
  kanbanData: Record<string, Issue[]>
  onDragEnd: (result: DropResult) => void
}) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-6 overflow-x-auto pb-6">
        {STATUSES.map((status) => (
          <div key={status.id} className="flex-shrink-0 w-80">
            {/* Column header */}
            <div className="flex items-center gap-2 mb-4">
              <div className={`w-2 h-2 rounded-full ${colorClasses[status.color]}`} />
              <span className="font-medium">{status.label}</span>
              <span className="text-sm text-muted-foreground ml-1">
                {kanbanData[status.id]?.length || 0}
              </span>
            </div>

            <Droppable droppableId={status.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-[200px] rounded-lg transition-colors ${
                    snapshot.isDraggingOver
                      ? 'bg-primary/5 border-primary/20 border-2 border-dashed'
                      : ''
                  }`}
                >
                  {kanbanData[status.id]?.map((issue, index) => (
                    <Draggable
                      key={issue.id}
                      draggableId={issue.id.toString()}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <KanbanCard issue={issue} isDragging={snapshot.isDragging} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  )
}

function KanbanCard({ issue, isDragging }: { issue: Issue; isDragging: boolean }) {
  const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]

  return (
    <Link href={`/dashboard/issues/${issue.id}`}>
      <motion.div
        layout
        className={`kanban-card mb-3 ${isDragging ? 'shadow-xl ring-2 ring-primary' : ''}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground font-mono">#{issue.id}</span>
          {priority && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
              {priority.label}
            </span>
          )}
        </div>

        {/* Title */}
        <h4 className="font-medium text-sm mb-3 line-clamp-2">{issue.title}</h4>

        {/* Meta */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {(issue.comment_count ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare size={12} />
                {issue.comment_count}
              </span>
            )}
            {(issue.attachment_count ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Paperclip size={12} />
                {issue.attachment_count}
              </span>
            )}
          </div>

          {/* Assignee */}
          {issue.assignee_avatar ? (
            <Image
              src={issue.assignee_avatar}
              alt={issue.assignee_name || 'Assignee'}
              width={20}
              height={20}
              className="rounded-full"
              title={issue.assignee_name}
            />
          ) : issue.assignee_name ? (
            <div
              className="w-5 h-5 bg-primary/20 rounded-full flex items-center justify-center text-[10px] font-medium"
              title={issue.assignee_name}
            >
              {issue.assignee_name.charAt(0)}
            </div>
          ) : null}
        </div>
      </motion.div>
    </Link>
  )
}

// Simplified Gantt View for Milestone
function GanttViewEmbedded({ issues, milestone }: { issues: Issue[]; milestone: Milestone }) {
  const router = useRouter()

  // Filter issues with dates
  const issuesWithDates = useMemo(() => {
    return issues.filter((issue) => issue.start_date || issue.due_date)
  }, [issues])

  const issuesWithoutDates = useMemo(() => {
    return issues.filter((issue) => !issue.start_date && !issue.due_date)
  }, [issues])

  // Calculate date range
  const { startDate, endDate, totalDays } = useMemo(() => {
    if (issuesWithDates.length === 0) {
      const today = new Date()
      const start = new Date(today)
      start.setDate(start.getDate() - 7)
      const end = new Date(today)
      end.setDate(end.getDate() + 30)
      return { startDate: start, endDate: end, totalDays: 37 }
    }

    const dates: Date[] = []
    for (const issue of issuesWithDates) {
      if (issue.start_date) dates.push(new Date(issue.start_date))
      if (issue.due_date) dates.push(new Date(issue.due_date))
    }

    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))

    minDate.setDate(minDate.getDate() - 7)
    maxDate.setDate(maxDate.getDate() + 14)

    const days = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

    return { startDate: minDate, endDate: maxDate, totalDays: Math.max(days, 30) }
  }, [issuesWithDates])

  // Generate date columns
  const dateColumns = useMemo(() => {
    const columns: { date: Date; label: string; isToday: boolean; isWeekend: boolean }[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let i = 0; i < totalDays; i++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + i)
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      columns.push({
        date,
        label: format(date, 'd'),
        isToday,
        isWeekend,
      })
    }

    return columns
  }, [startDate, totalDays])

  // Generate month headers
  const monthHeaders = useMemo(() => {
    const months: { month: string; startIndex: number; span: number }[] = []
    let currentMonth = ''
    let currentStartIndex = 0
    let currentSpan = 0

    dateColumns.forEach((col, index) => {
      const month = format(col.date, 'MMMM yyyy')
      if (month !== currentMonth) {
        if (currentMonth) {
          months.push({ month: currentMonth, startIndex: currentStartIndex, span: currentSpan })
        }
        currentMonth = month
        currentStartIndex = index
        currentSpan = 1
      } else {
        currentSpan++
      }
    })

    if (currentMonth) {
      months.push({ month: currentMonth, startIndex: currentStartIndex, span: currentSpan })
    }

    return months
  }, [dateColumns])

  const columnWidth = 40
  const rowHeight = 40
  const labelWidth = 280

  // Calculate bar position
  const getBarStyle = (issue: Issue) => {
    const issueStart = issue.start_date ? new Date(issue.start_date) : null
    const issueEnd = issue.due_date ? new Date(issue.due_date) : null

    if (!issueStart && issueEnd) {
      const dayOffset = Math.floor(
        (issueEnd.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      return { left: dayOffset * columnWidth, width: Math.max(columnWidth / 2, 16) }
    }

    if (issueStart && !issueEnd) {
      const dayOffset = Math.floor(
        (issueStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      return { left: dayOffset * columnWidth, width: Math.max(columnWidth / 2, 16) }
    }

    if (issueStart && issueEnd) {
      const dayOffset = Math.floor(
        (issueStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      const duration =
        Math.floor((issueEnd.getTime() - issueStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
      return {
        left: dayOffset * columnWidth,
        width: Math.max(duration * columnWidth, 16),
      }
    }

    return { left: 0, width: 0 }
  }

  const getBarColor = (issue: Issue) => {
    const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
    return priority?.barBg || 'bg-gray-400'
  }

  if (issuesWithDates.length === 0) {
    return (
      <div className="text-center py-24">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
          <Calendar className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No scheduled issues</h2>
        <p className="text-muted-foreground">
          Add start or due dates to issues to see them in the Gantt view
        </p>
      </div>
    )
  }

  return (
    <div className="flex border border-border rounded-lg overflow-hidden">
      {/* Fixed left panel */}
      <div className="flex-shrink-0 border-r border-border bg-card" style={{ width: labelWidth }}>
        <div className="h-[72px] border-b border-border bg-secondary/50" />
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          {issuesWithDates.map((issue) => (
            <div
              key={issue.id}
              onClick={() => router.push(`/dashboard/issues/${issue.id}`)}
              className="flex items-center gap-2 px-4 border-b border-border hover:bg-secondary/50 cursor-pointer transition-colors"
              style={{ height: rowHeight }}
            >
              <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                #{issue.id}
              </span>
              <span className="text-sm truncate flex-1" title={issue.title}>
                {issue.title}
              </span>
            </div>
          ))}
          {issuesWithoutDates.length > 0 && (
            <>
              <div className="px-4 py-2 bg-secondary/30 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  No Dates ({issuesWithoutDates.length})
                </span>
              </div>
              {issuesWithoutDates.map((issue) => (
                <div
                  key={issue.id}
                  onClick={() => router.push(`/dashboard/issues/${issue.id}`)}
                  className="flex items-center gap-2 px-4 border-b border-border hover:bg-secondary/50 cursor-pointer transition-colors opacity-60"
                  style={{ height: rowHeight }}
                >
                  <span className="text-xs font-mono text-muted-foreground flex-shrink-0">
                    #{issue.id}
                  </span>
                  <span className="text-sm truncate flex-1" title={issue.title}>
                    {issue.title}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Scrollable right panel */}
      <div className="flex-1 overflow-x-auto" style={{ maxHeight: 'calc(100vh - 328px)' }}>
        <div style={{ minWidth: dateColumns.length * columnWidth }}>
          {/* Month headers */}
          <div className="h-8 flex border-b border-border bg-secondary/30 sticky top-0">
            {monthHeaders.map((month, i) => (
              <div
                key={`${month.month}-${i}`}
                className="text-xs font-medium text-muted-foreground flex items-center justify-center border-r border-border"
                style={{ width: month.span * columnWidth }}
              >
                {month.month}
              </div>
            ))}
          </div>

          {/* Date headers */}
          <div className="h-10 flex border-b border-border bg-card sticky top-8">
            {dateColumns.map((col, i) => (
              <div
                key={i}
                className={`flex items-center justify-center text-xs border-r border-border ${
                  col.isToday
                    ? 'bg-primary/10 font-bold text-primary'
                    : col.isWeekend
                    ? 'bg-secondary/50 text-muted-foreground'
                    : ''
                }`}
                style={{ width: columnWidth }}
              >
                {col.label}
              </div>
            ))}
          </div>

          {/* Gantt bars */}
          <div className="relative">
            {/* Grid lines */}
            <div className="absolute inset-0 flex pointer-events-none">
              {dateColumns.map((col, i) => (
                <div
                  key={i}
                  className={`border-r border-border ${
                    col.isToday ? 'bg-primary/5' : col.isWeekend ? 'bg-secondary/30' : ''
                  }`}
                  style={{ width: columnWidth, height: '100%' }}
                />
              ))}
            </div>

            {/* Issue bars */}
            {issuesWithDates.map((issue) => {
              const barStyle = getBarStyle(issue)
              const barColor = getBarColor(issue)

              return (
                <div
                  key={issue.id}
                  className="relative border-b border-border"
                  style={{ height: rowHeight }}
                >
                  {barStyle.width > 0 && (
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      onClick={() => router.push(`/dashboard/issues/${issue.id}`)}
                      className={`absolute top-1.5 h-7 rounded-md cursor-pointer hover:ring-2 hover:ring-primary/50 hover:brightness-110 transition-all shadow-sm ${barColor}`}
                      style={{
                        left: barStyle.left,
                        width: barStyle.width,
                        transformOrigin: 'left',
                      }}
                      title={`${issue.title}${issue.start_date ? `\nStart: ${format(new Date(issue.start_date), 'MMM d, yyyy')}` : ''}${issue.due_date ? `\nDue: ${format(new Date(issue.due_date), 'MMM d, yyyy')}` : ''}`}
                    >
                      <div className="px-2 h-full flex items-center">
                        <span className="text-[10px] text-white font-medium truncate drop-shadow-sm">
                          {barStyle.width > 60 ? issue.title : ''}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </div>
              )
            })}

            {/* Issues without dates */}
            {issuesWithoutDates.length > 0 && (
              <>
                <div className="h-[33px] border-b border-border bg-secondary/10" />
                {issuesWithoutDates.map((issue) => (
                  <div
                    key={issue.id}
                    className="relative border-b border-border bg-secondary/10"
                    style={{ height: rowHeight }}
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-muted-foreground">
                      No dates set
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
