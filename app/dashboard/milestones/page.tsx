'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { format, addDays, differenceInDays, startOfDay, parseISO, min, max, isSameDay } from 'date-fns'
import { toast } from 'sonner'
import {
  Plus,
  Edit2,
  Trash2,
  X,
  Calendar,
  Target,
  CheckCircle2,
  LayoutGrid,
  List,
  GanttChartSquare,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

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
}

type ViewMode = 'cards' | 'list' | 'timeline'

// Zoom levels: days per column
const ZOOM_LEVELS = [1, 2, 3, 7, 14, 30] as const
type ZoomLevel = typeof ZOOM_LEVELS[number]

export default function MilestonesPage() {
  const [showNewMilestone, setShowNewMilestone] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(7)
  const queryClient = useQueryClient()

  const { data: milestones = [], isLoading } = useQuery<Milestone[]>({
    queryKey: ['all-milestones'],
    queryFn: async () => {
      const res = await fetch('/api/milestones')
      if (!res.ok) throw new Error('Failed to fetch milestones')
      return res.json()
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects')
      if (!res.ok) return []
      return res.json()
    },
  })

  const createMilestone = useMutation({
    mutationFn: async (data: {
      project_id: number
      name: string
      description?: string
      due_date?: string
    }) => {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to create milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      setShowNewMilestone(false)
      toast.success('Milestone created!')
    },
    onError: () => {
      toast.error('Failed to create milestone')
    },
  })

  const updateMilestone = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number
      data: Partial<Milestone>
    }) => {
      const res = await fetch(`/api/milestones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      setEditingMilestone(null)
      toast.success('Milestone updated!')
    },
    onError: () => {
      toast.error('Failed to update milestone')
    },
  })

  const deleteMilestone = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/milestones/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete milestone')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      toast.success('Milestone deleted!')
    },
    onError: () => {
      toast.error('Failed to delete milestone')
    },
  })

  // Group milestones by project
  const milestonesByProject = milestones.reduce((acc, milestone) => {
    const projectId = milestone.project_id
    if (!acc[projectId]) {
      acc[projectId] = {
        project_id: projectId,
        project_name: milestone.project_name || `Project #${projectId}`,
        milestones: [],
      }
    }
    acc[projectId].milestones.push(milestone)
    return acc
  }, {} as Record<number, { project_id: number; project_name: string; milestones: Milestone[] }>)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Milestones</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {milestones.length} milestone{milestones.length !== 1 ? 's' : ''} across{' '}
                {Object.keys(milestonesByProject).length} project
                {Object.keys(milestonesByProject).length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => setShowNewMilestone(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={18} />
              New Milestone
            </button>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'cards'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid size={16} className="inline mr-1.5" />
                Cards
              </button>
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
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'timeline'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <GanttChartSquare size={16} className="inline mr-1.5" />
                Timeline
              </button>
            </div>

            {/* Zoom controls for timeline view */}
            {viewMode === 'timeline' && (
              <div className="flex items-center gap-1 border border-input rounded-lg p-1">
                <button
                  onClick={() => {
                    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel)
                    if (currentIndex > 0) setZoomLevel(ZOOM_LEVELS[currentIndex - 1])
                  }}
                  disabled={zoomLevel === ZOOM_LEVELS[0]}
                  className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
                <span className="px-2 text-xs text-muted-foreground min-w-[60px] text-center">
                  {zoomLevel === 1 ? '1 day' : `${zoomLevel} days`}
                </span>
                <button
                  onClick={() => {
                    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel)
                    if (currentIndex < ZOOM_LEVELS.length - 1) setZoomLevel(ZOOM_LEVELS[currentIndex + 1])
                  }}
                  disabled={zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                  className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        {isLoading ? (
          <div className="space-y-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 bg-card rounded-lg border border-border animate-pulse" />
            ))}
          </div>
        ) : Object.keys(milestonesByProject).length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
              <Target className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No milestones yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first milestone to track project goals
            </p>
            <button
              onClick={() => setShowNewMilestone(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={18} />
              Create Milestone
            </button>
          </div>
        ) : viewMode === 'cards' ? (
          <CardsView
            milestonesByProject={milestonesByProject}
            onEdit={setEditingMilestone}
            onDelete={(id) => deleteMilestone.mutate(id)}
          />
        ) : viewMode === 'list' ? (
          <ListView
            milestones={milestones}
            onEdit={setEditingMilestone}
            onDelete={(id) => deleteMilestone.mutate(id)}
          />
        ) : (
          <TimelineView milestones={milestones} zoomLevel={zoomLevel} />
        )}
      </main>

      {/* New Milestone Modal */}
      <AnimatePresence>
        {showNewMilestone && (
          <MilestoneModal
            projects={projects}
            onClose={() => setShowNewMilestone(false)}
            onSave={(data) => createMilestone.mutate(data)}
            isLoading={createMilestone.isPending}
          />
        )}
      </AnimatePresence>

      {/* Edit Milestone Modal */}
      <AnimatePresence>
        {editingMilestone && (
          <MilestoneModal
            projects={projects}
            milestone={editingMilestone}
            onClose={() => setEditingMilestone(null)}
            onSave={(data) =>
              updateMilestone.mutate({ id: editingMilestone.id, data })
            }
            isLoading={updateMilestone.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function MilestoneModal({
  projects,
  milestone,
  onClose,
  onSave,
  isLoading,
}: {
  projects: any[]
  milestone?: Milestone
  onClose: () => void
  onSave: (data: {
    project_id: number
    name: string
    description?: string
    due_date?: string
  }) => void
  isLoading: boolean
}) {
  const [name, setName] = useState(milestone?.name || '')
  const [description, setDescription] = useState(milestone?.description || '')
  const [projectId, setProjectId] = useState<number>(
    milestone?.project_id || projects[0]?.id || 0
  )
  const [dueDate, setDueDate] = useState(
    milestone?.due_date ? format(new Date(milestone.due_date), 'yyyy-MM-dd') : ''
  )

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
      >
        <div
          className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-xl font-bold mb-6">
            {milestone ? 'Edit Milestone' : 'Create New Milestone'}
          </h2>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim() && projectId) {
                onSave({
                  project_id: projectId,
                  name: name.trim(),
                  description: description.trim() || undefined,
                  due_date: dueDate || undefined,
                })
              }
            }}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(parseInt(e.target.value))}
                  disabled={!!milestone}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  required
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Milestone name"
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this milestone about?"
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || !projectId || isLoading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : milestone ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  )
}

// Cards View Component
function CardsView({
  milestonesByProject,
  onEdit,
  onDelete,
}: {
  milestonesByProject: Record<number, { project_id: number; project_name: string; milestones: Milestone[] }>
  onEdit: (milestone: Milestone) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="space-y-8">
      {Object.values(milestonesByProject).map((group) => (
        <div key={group.project_id}>
          <div className="flex items-center gap-2 mb-4">
            <Link
              href={`/dashboard/${group.project_id}`}
              className="text-lg font-semibold hover:text-primary transition-colors"
            >
              {group.project_name}
            </Link>
            <span className="text-sm text-muted-foreground">
              ({group.milestones.length} milestone{group.milestones.length !== 1 ? 's' : ''})
            </span>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.milestones.map((milestone) => {
              const progress =
                milestone.issue_count > 0
                  ? (milestone.completed_issues / milestone.issue_count) * 100
                  : 0

              return (
                <motion.div
                  key={milestone.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-card rounded-lg border border-border p-5 hover:border-primary/50 transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <Link
                      href={`/dashboard/milestones/${milestone.id}`}
                      className="flex-1 hover:text-primary transition-colors"
                    >
                      <h3 className="font-semibold mb-1">{milestone.name}</h3>
                      {milestone.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {milestone.description}
                        </p>
                      )}
                    </Link>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(milestone)
                        }}
                        className="p-1.5 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('Are you sure you want to delete this milestone?')) {
                            onDelete(milestone.id)
                          }
                        }}
                        className="p-1.5 hover:bg-secondary rounded-md transition-colors text-destructive hover:text-destructive"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <Link href={`/dashboard/milestones/${milestone.id}`}>
                    {milestone.due_date && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                        <Calendar size={14} />
                        <span>{format(new Date(milestone.due_date), 'MMM d, yyyy')}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">
                          {milestone.completed_issues} / {milestone.issue_count}
                          <span className="ml-1 text-muted-foreground">
                            ({Math.round(progress)}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            progress === 100
                              ? 'bg-green-500'
                              : progress >= 50
                              ? 'bg-primary'
                              : 'bg-amber-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// List View Component
function ListView({
  milestones,
  onEdit,
  onDelete,
}: {
  milestones: Milestone[]
  onEdit: (milestone: Milestone) => void
  onDelete: (id: number) => void
}) {
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-secondary/30">
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Milestone
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Project
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Due Date
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Progress
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Issues
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {milestones.map((milestone) => {
            const progress =
              milestone.issue_count > 0
                ? Math.round((milestone.completed_issues / milestone.issue_count) * 100)
                : 0

            return (
              <tr key={milestone.id} className="hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/milestones/${milestone.id}`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {milestone.name}
                  </Link>
                  {milestone.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {milestone.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/${milestone.project_id}`}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    {milestone.project_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm">
                  {milestone.due_date ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar size={14} />
                      {format(new Date(milestone.due_date), 'MMM d, yyyy')}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">Not set</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          progress === 100
                            ? 'bg-green-500'
                            : progress >= 50
                            ? 'bg-primary'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{progress}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {milestone.completed_issues}/{milestone.issue_count}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onEdit(milestone)}
                      className="p-1.5 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this milestone?')) {
                          onDelete(milestone.id)
                        }
                      }}
                      className="p-1.5 hover:bg-secondary rounded-md transition-colors text-destructive hover:text-destructive"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Timeline/Gantt View Component
function TimelineView({ milestones, zoomLevel }: { milestones: Milestone[]; zoomLevel: ZoomLevel }) {
  // Filter milestones with due dates
  const milestonesWithDates = useMemo(() => {
    return milestones.filter((m) => m.due_date)
  }, [milestones])

  const milestonesWithoutDates = useMemo(() => {
    return milestones.filter((m) => !m.due_date)
  }, [milestones])

  // Calculate date range
  const { startDate, endDate, totalDays } = useMemo(() => {
    if (milestonesWithDates.length === 0) {
      const today = startOfDay(new Date())
      return {
        startDate: addDays(today, -14),
        endDate: addDays(today, 60),
        totalDays: 74,
      }
    }

    const dates: Date[] = milestonesWithDates.map((m) => parseISO(m.due_date!))
    const today = startOfDay(new Date())
    dates.push(today)

    const minDate = min(dates)
    const maxDate = max(dates)

    // Add padding
    const start = addDays(startOfDay(minDate), -14)
    const end = addDays(maxDate, 30)
    const days = differenceInDays(end, start) + 1

    return {
      startDate: start,
      endDate: end,
      totalDays: Math.max(days, 60),
    }
  }, [milestonesWithDates])

  // Generate date columns based on zoom level
  const dateColumns = useMemo(() => {
    const columns: { date: Date; label: string; isToday: boolean; isWeekend: boolean }[] = []
    const today = startOfDay(new Date())

    for (let i = 0; i < totalDays; i += zoomLevel) {
      const date = addDays(startDate, i)
      const isToday = isSameDay(date, today)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6

      let label: string
      if (zoomLevel === 1) {
        label = format(date, 'd')
      } else if (zoomLevel <= 7) {
        label = format(date, 'MMM d')
      } else {
        label = format(date, 'MMM d')
      }

      columns.push({ date, label, isToday, isWeekend })
    }

    return columns
  }, [startDate, totalDays, zoomLevel])

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

  const columnWidth = zoomLevel === 1 ? 40 : zoomLevel <= 7 ? 60 : 80
  const rowHeight = 48
  const labelWidth = 300

  // Calculate milestone position
  const getMilestonePosition = (milestone: Milestone) => {
    if (!milestone.due_date) return null
    const dueDate = parseISO(milestone.due_date)
    const dayOffset = differenceInDays(dueDate, startDate)
    return (dayOffset / zoomLevel) * columnWidth
  }

  if (milestonesWithDates.length === 0) {
    return (
      <div className="text-center py-24">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
          <Calendar className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No scheduled milestones</h2>
        <p className="text-muted-foreground">
          Add due dates to milestones to see them in the timeline view
        </p>
      </div>
    )
  }

  return (
    <div className="flex border border-border rounded-lg overflow-hidden">
      {/* Fixed left panel - milestone labels */}
      <div className="flex-shrink-0 border-r border-border bg-card" style={{ width: labelWidth }}>
        {/* Header spacer */}
        <div className="h-[72px] border-b border-border bg-secondary/50" />

        {/* Milestone labels */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
          {milestonesWithDates.map((milestone) => {
            const progress =
              milestone.issue_count > 0
                ? Math.round((milestone.completed_issues / milestone.issue_count) * 100)
                : 0

            return (
              <Link
                key={milestone.id}
                href={`/dashboard/milestones/${milestone.id}`}
                className="flex items-center gap-3 px-4 border-b border-border hover:bg-secondary/50 transition-colors"
                style={{ height: rowHeight }}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">{milestone.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {milestone.project_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        progress === 100 ? 'bg-green-500' : progress >= 50 ? 'bg-primary' : 'bg-amber-500'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8">{progress}%</span>
                </div>
              </Link>
            )
          })}

          {/* Milestones without dates */}
          {milestonesWithoutDates.length > 0 && (
            <>
              <div className="px-4 py-2 bg-secondary/30 border-b border-border">
                <span className="text-sm text-muted-foreground">No Due Date ({milestonesWithoutDates.length})</span>
              </div>
              {milestonesWithoutDates.map((milestone) => (
                <Link
                  key={milestone.id}
                  href={`/dashboard/milestones/${milestone.id}`}
                  className="flex items-center gap-3 px-4 border-b border-border hover:bg-secondary/50 transition-colors opacity-60"
                  style={{ height: rowHeight }}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{milestone.name}</span>
                    <span className="text-xs text-muted-foreground">{milestone.project_name}</span>
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Scrollable right panel - timeline */}
      <div className="flex-1 overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 248px)' }}>
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

          {/* Milestone bars */}
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

            {/* Today marker */}
            {dateColumns.some((col) => col.isToday) && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                style={{
                  left:
                    (differenceInDays(startOfDay(new Date()), startDate) / zoomLevel) * columnWidth +
                    columnWidth / 2,
                }}
              />
            )}

            {/* Milestone markers */}
            {milestonesWithDates.map((milestone) => {
              const position = getMilestonePosition(milestone)
              if (position === null) return null

              const progress =
                milestone.issue_count > 0
                  ? Math.round((milestone.completed_issues / milestone.issue_count) * 100)
                  : 0

              return (
                <div
                  key={milestone.id}
                  className="relative border-b border-border"
                  style={{ height: rowHeight }}
                >
                  {/* Diamond marker for milestone due date */}
                  <Link
                    href={`/dashboard/milestones/${milestone.id}`}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 cursor-pointer group"
                    style={{ left: position + columnWidth / 2 }}
                  >
                    <div
                      className={`w-4 h-4 rotate-45 shadow-sm transition-all group-hover:scale-125 ${
                        progress === 100 ? 'bg-green-500' : progress >= 50 ? 'bg-primary' : 'bg-amber-500'
                      }`}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap">
                        <div className="font-medium">{milestone.name}</div>
                        <div className="text-muted-foreground">
                          Due: {format(parseISO(milestone.due_date!), 'MMM d, yyyy')}
                        </div>
                        <div className="text-muted-foreground">
                          {milestone.completed_issues}/{milestone.issue_count} issues ({progress}%)
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>
              )
            })}

            {/* Milestones without dates - empty rows */}
            {milestonesWithoutDates.length > 0 && (
              <>
                <div className="h-[33px] border-b border-border bg-secondary/10" />
                {milestonesWithoutDates.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="relative border-b border-border bg-secondary/10"
                    style={{ height: rowHeight }}
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-muted-foreground">
                      No due date set
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

