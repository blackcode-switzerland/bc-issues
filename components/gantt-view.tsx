'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  format,
  addDays,
  differenceInDays,
  startOfDay,
  endOfDay,
  min,
  max,
  parseISO,
  isSameDay,
} from 'date-fns'
import {
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  GanttChartSquare,
  Users,
  X,
  Settings,
} from 'lucide-react'
import { ProjectMembersPanel } from './project-members-panel'

// Priority configuration matching kanban-board
const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500', barBg: 'bg-red-500' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500', barBg: 'bg-amber-500' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500', barBg: 'bg-blue-500' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500', barBg: 'bg-gray-400' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400', barBg: 'bg-gray-300' },
} as const

// Status configuration matching kanban-board
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; barBg: string }> = {
  backlog: { label: 'Backlog', color: 'text-gray-500', bg: 'bg-gray-500', barBg: 'bg-gray-400' },
  todo: { label: 'To Do', color: 'text-blue-500', bg: 'bg-blue-500', barBg: 'bg-blue-500' },
  in_progress: { label: 'In Progress', color: 'text-amber-500', bg: 'bg-amber-500', barBg: 'bg-amber-500' },
  blocked: { label: 'Blocked', color: 'text-red-500', bg: 'bg-red-500', barBg: 'bg-red-500' },
  in_review: { label: 'In Review', color: 'text-purple-500', bg: 'bg-purple-500', barBg: 'bg-purple-500' },
  done: { label: 'Done', color: 'text-green-500', bg: 'bg-green-500', barBg: 'bg-green-500' },
}

interface Issue {
  id: number
  title: string
  description?: string
  status: string
  priority: number
  assignee_id?: number
  assignee_name?: string
  assignee_avatar?: string
  milestone_id?: number
  milestone_name?: string
  start_date?: string | null
  due_date?: string | null
  comment_count?: number
  attachment_count?: number
  created_at: string
  updated_at: string
}

interface Project {
  id: number
  name: string
  description?: string | null
}

interface User {
  id?: number
  name?: string | null
  email?: string | null
  image?: string | null
}

type GroupBy = 'milestone' | 'status' | 'assignee' | 'none'
type ColorBy = 'priority' | 'status'

// Zoom levels: days per column
const ZOOM_LEVELS = [1, 2, 3, 7, 14, 30] as const
type ZoomLevel = typeof ZOOM_LEVELS[number]

export function GanttView({
  project,
  issues: rawIssues,
  user,
  view = 'timeline',
  onViewChange,
  onOpenSettings,
}: {
  project: Project
  issues: Issue[]
  user: User
  view?: 'kanban' | 'timeline' | 'list'
  onViewChange?: (view: 'kanban' | 'timeline' | 'list') => void
  onOpenSettings?: () => void
}) {
  // Ensure issues is always an array (handle edge cases where it might be object/null)
  const issues = useMemo(() => {
    if (!rawIssues) return []
    if (Array.isArray(rawIssues)) return rawIssues
    // If it's an object (e.g., kanban data), flatten it
    if (typeof rawIssues === 'object') {
      return Object.values(rawIssues).flat() as Issue[]
    }
    return []
  }, [rawIssues])
  const router = useRouter()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [colorBy, setColorBy] = useState<ColorBy>('priority')
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1)
  const [showMembersPanel, setShowMembersPanel] = useState(false)

  // Filter issues with dates
  const issuesWithDates = useMemo(() => {
    return issues.filter(issue => {
      // Must have at least one date
      if (!issue.start_date && !issue.due_date) return false

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          issue.title.toLowerCase().includes(query) ||
          issue.id.toString().includes(query)
        )
      }
      return true
    })
  }, [issues, searchQuery])

  // Issues without dates for the "no dates" section
  const issuesWithoutDates = useMemo(() => {
    return issues.filter(issue => {
      if (issue.start_date || issue.due_date) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          issue.title.toLowerCase().includes(query) ||
          issue.id.toString().includes(query)
        )
      }
      return true
    })
  }, [issues, searchQuery])

  // Calculate date range
  const { startDate, endDate, totalDays } = useMemo(() => {
    if (issuesWithDates.length === 0) {
      const today = startOfDay(new Date())
      return {
        startDate: addDays(today, -7),
        endDate: addDays(today, 30),
        totalDays: 37,
      }
    }

    const dates: Date[] = []
    for (const issue of issuesWithDates) {
      if (issue.start_date) {
        dates.push(parseISO(issue.start_date))
      }
      if (issue.due_date) {
        dates.push(parseISO(issue.due_date))
      }
    }

    const minDate = min(dates)
    const maxDate = max(dates)

    // Add padding
    const start = addDays(startOfDay(minDate), -7)
    const end = addDays(endOfDay(maxDate), 14)
    const days = differenceInDays(end, start) + 1

    return {
      startDate: start,
      endDate: end,
      totalDays: Math.max(days, 30),
    }
  }, [issuesWithDates])

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

  // Group issues
  const groupedIssues = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', label: 'All Issues', issues: issuesWithDates }]
    }

    const groups: Record<string, { label: string; issues: Issue[] }> = {}

    for (const issue of issuesWithDates) {
      let key: string
      let label: string

      switch (groupBy) {
        case 'milestone':
          key = issue.milestone_id?.toString() || 'no-milestone'
          label = issue.milestone_name || 'No Milestone'
          break
        case 'status':
          key = issue.status
          label = STATUS_CONFIG[issue.status]?.label || issue.status
          break
        case 'assignee':
          key = issue.assignee_id?.toString() || 'unassigned'
          label = issue.assignee_name || 'Unassigned'
          break
        default:
          key = 'all'
          label = 'All Issues'
      }

      if (!groups[key]) {
        groups[key] = { label, issues: [] }
      }
      groups[key].issues.push(issue)
    }

    return Object.entries(groups).map(([key, value]) => ({
      key,
      label: value.label,
      issues: value.issues,
    }))
  }, [issuesWithDates, groupBy])

  // Column width in pixels
  const columnWidth = zoomLevel === 1 ? 40 : zoomLevel <= 7 ? 60 : 80
  const rowHeight = 40
  const labelWidth = 280

  // Calculate bar position and width
  const getBarStyle = (issue: Issue) => {
    const issueStart = issue.start_date ? parseISO(issue.start_date) : null
    const issueEnd = issue.due_date ? parseISO(issue.due_date) : null

    // If only one date, show as a point (narrow bar)
    if (!issueStart && issueEnd) {
      const dayOffset = differenceInDays(issueEnd, startDate)
      const left = (dayOffset / zoomLevel) * columnWidth
      return { left, width: Math.max(columnWidth / 2, 16) }
    }

    if (issueStart && !issueEnd) {
      const dayOffset = differenceInDays(issueStart, startDate)
      const left = (dayOffset / zoomLevel) * columnWidth
      return { left, width: Math.max(columnWidth / 2, 16) }
    }

    if (issueStart && issueEnd) {
      const dayOffset = differenceInDays(issueStart, startDate)
      const duration = differenceInDays(issueEnd, issueStart) + 1
      const left = (dayOffset / zoomLevel) * columnWidth
      const width = Math.max((duration / zoomLevel) * columnWidth, 16)
      return { left, width }
    }

    return { left: 0, width: 0 }
  }

  // Get bar color based on colorBy setting
  const getBarColor = (issue: Issue) => {
    if (colorBy === 'priority') {
      const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
      return priority?.barBg || 'bg-gray-400'
    } else {
      const status = STATUS_CONFIG[issue.status]
      return status?.barBg || 'bg-gray-400'
    }
  }

  // Handle issue click
  const handleIssueClick = (issueId: number) => {
    router.push(`/dashboard/issues/${issueId}`)
  }

  // Zoom controls
  const handleZoomIn = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel)
    if (currentIndex > 0) {
      setZoomLevel(ZOOM_LEVELS[currentIndex - 1])
    }
  }

  const handleZoomOut = () => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel)
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      setZoomLevel(ZOOM_LEVELS[currentIndex + 1])
    }
  }

  // Scroll to today
  const scrollToToday = useCallback(() => {
    if (scrollContainerRef.current) {
      const today = startOfDay(new Date())
      const dayOffset = differenceInDays(today, startDate)
      const scrollPosition = (dayOffset / zoomLevel) * columnWidth - 200
      scrollContainerRef.current.scrollLeft = Math.max(0, scrollPosition)
    }
  }, [startDate, zoomLevel, columnWidth])

  // Scroll to today on mount
  useEffect(() => {
    scrollToToday()
  }, [scrollToToday])

  // Navigate timeline
  const navigateDays = (days: number) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft += (days / zoomLevel) * columnWidth
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-xl font-bold">{project.name}</h1>
                <p className="text-sm text-muted-foreground">
                  #{project.id} - Gantt view - {issuesWithDates.length} scheduled issues
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* View Toggle */}
            {onViewChange && (
              <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
                <button
                  onClick={() => onViewChange('kanban')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === 'kanban'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <LayoutGrid size={16} className="inline mr-1.5" />
                  Kanban
                </button>
                <button
                  onClick={() => onViewChange('list')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === 'list'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <List size={16} className="inline mr-1.5" />
                  List
                </button>
                <button
                  onClick={() => onViewChange('timeline')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === 'timeline'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <GanttChartSquare size={16} className="inline mr-1.5" />
                  Gantt
                </button>
              </div>
            )}

            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <label htmlFor="gantt-search" className="sr-only">Search issues</label>
              <input
                id="gantt-search"
                type="text"
                placeholder="Search issues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Group By */}
            <label htmlFor="gantt-group-by" className="sr-only">Group issues by</label>
            <select
              id="gantt-group-by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="none">No Grouping</option>
              <option value="milestone">Group by Milestone</option>
              <option value="status">Group by Status</option>
              <option value="assignee">Group by Assignee</option>
            </select>

            {/* Color By */}
            <select
              value={colorBy}
              onChange={(e) => setColorBy(e.target.value as ColorBy)}
              className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            >
              <option value="priority">Color by Priority</option>
              <option value="status">Color by Status</option>
            </select>

            {/* Timeline Controls */}
            <div className="flex items-center gap-1 border border-input rounded-lg p-1">
              <button
                onClick={() => navigateDays(-7)}
                className="p-1.5 hover:bg-secondary rounded-md transition-colors"
                title="Previous week"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={scrollToToday}
                className="px-2 py-1 text-xs font-medium hover:bg-secondary rounded-md transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => navigateDays(7)}
                className="p-1.5 hover:bg-secondary rounded-md transition-colors"
                title="Next week"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 border border-input rounded-lg p-1">
              <button
                onClick={handleZoomIn}
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
                onClick={handleZoomOut}
                disabled={zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                className="p-1.5 hover:bg-secondary rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
            </div>

            {/* Team Members */}
            <button
              onClick={() => setShowMembersPanel(true)}
              className="flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors"
            >
              <Users size={16} />
              Team
            </button>

            {/* Settings */}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-2 bg-background border border-input rounded-lg hover:bg-secondary transition-colors"
                title="Project Settings"
              >
                <Settings size={16} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Gantt Chart */}
      <main className="flex-1 overflow-hidden">
        {issuesWithDates.length === 0 && issuesWithoutDates.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">No issues found</h2>
              <p className="text-muted-foreground">
                {searchQuery ? 'Try adjusting your search' : 'Create issues with start/due dates to see them here'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full">
            {/* Fixed left panel - issue labels */}
            <div className="shrink-0 border-r border-border bg-card" style={{ width: labelWidth }}>
              {/* Header spacer for month + date headers */}
              <div className="h-[72px] border-b border-border bg-secondary/50" />

              {/* Issue labels by group */}
              <div className="overflow-y-auto" style={{ height: 'calc(100vh - 200px)' }}>
                {groupedIssues.map((group) => (
                  <div key={group.key}>
                    {/* Group header */}
                    {groupBy !== 'none' && (
                      <div className="px-4 py-2 bg-secondary/50 border-b border-border">
                        <span className="font-medium text-sm">{group.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({group.issues.length})
                        </span>
                      </div>
                    )}

                    {/* Issues in group */}
                    {group.issues.map((issue) => (
                      <div
                        key={issue.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleIssueClick(issue.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleIssueClick(issue.id)
                          }
                        }}
                        aria-label={`Issue #${issue.id}: ${issue.title}`}
                        className="flex items-center gap-2 px-4 border-b border-border hover:bg-secondary/50 cursor-pointer transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-inset"
                        style={{ height: rowHeight }}
                      >
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          #{issue.id}
                        </span>
                        <span className="text-sm truncate flex-1" title={issue.title}>
                          {issue.title}
                        </span>
                        {/* Assignee avatar */}
                        {issue.assignee_avatar ? (
                          <Image
                            src={issue.assignee_avatar}
                            alt={issue.assignee_name || 'Assignee'}
                            width={20}
                            height={20}
                            className="rounded-full shrink-0"
                            title={issue.assignee_name}
                          />
                        ) : issue.assignee_name ? (
                          <div
                            className="w-5 h-5 bg-primary/20 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
                            title={issue.assignee_name}
                          >
                            {issue.assignee_name.charAt(0)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}

                {/* Issues without dates */}
                {issuesWithoutDates.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-secondary/30 border-b border-border">
                      <span className="font-medium text-sm text-muted-foreground">No Dates Scheduled</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({issuesWithoutDates.length})
                      </span>
                    </div>
                    {issuesWithoutDates.map((issue) => (
                      <div
                        key={issue.id}
                        onClick={() => handleIssueClick(issue.id)}
                        className="flex items-center gap-2 px-4 border-b border-border hover:bg-secondary/50 cursor-pointer transition-colors opacity-60"
                        style={{ height: rowHeight }}
                      >
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          #{issue.id}
                        </span>
                        <span className="text-sm truncate flex-1" title={issue.title}>
                          {issue.title}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Scrollable right panel - timeline */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-x-auto overflow-y-auto"
              style={{ height: 'calc(100vh - 128px)' }}
            >
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

                  {/* Today marker */}
                  {dateColumns.some(col => col.isToday) && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                      style={{
                        left: (differenceInDays(startOfDay(new Date()), startDate) / zoomLevel) * columnWidth + columnWidth / 2,
                      }}
                    />
                  )}

                  {/* Issue bars by group */}
                  {groupedIssues.map((group) => (
                    <div key={group.key}>
                      {/* Group header spacer */}
                      {groupBy !== 'none' && (
                        <div className="h-[33px] border-b border-border" />
                      )}

                      {/* Issue bars */}
                      {group.issues.map((issue) => {
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
                                onClick={() => handleIssueClick(issue.id)}
                                className={`absolute top-1.5 h-7 rounded-md cursor-pointer hover:ring-2 hover:ring-primary/50 hover:brightness-110 transition-all shadow-xs ${barColor}`}
                                style={{
                                  left: barStyle.left,
                                  width: barStyle.width,
                                  transformOrigin: 'left',
                                }}
                                title={`${issue.title}${issue.start_date ? `\nStart: ${format(parseISO(issue.start_date), 'MMM d, yyyy')}` : ''}${issue.due_date ? `\nDue: ${format(parseISO(issue.due_date), 'MMM d, yyyy')}` : ''}`}
                              >
                                <div className="px-2 h-full flex items-center">
                                  <span className="text-[10px] text-white font-medium truncate drop-shadow-xs">
                                    {barStyle.width > 60 ? issue.title : ''}
                                  </span>
                                </div>
                              </motion.div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}

                  {/* Issues without dates - just empty rows */}
                  {issuesWithoutDates.length > 0 && (
                    <div>
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
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Legend */}
      <footer className="border-t border-border bg-card px-6 py-3">
        <div className="flex items-center gap-6 text-xs">
          <span className="text-muted-foreground">Legend:</span>
          {colorBy === 'priority' ? (
            <>
              {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded ${config.barBg}`} />
                  <span className="text-muted-foreground">{config.label}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded ${config.barBg}`} />
                  <span className="text-muted-foreground">{config.label}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </footer>

      {/* Members Panel */}
      <AnimatePresence>
        {showMembersPanel && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMembersPanel(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border shadow-2xl z-50 overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Team Members</h2>
                  <button
                    onClick={() => setShowMembersPanel(false)}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <ProjectMembersPanel
                  projectId={project.id}
                  currentUserId={user.id || 0}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
