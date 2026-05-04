'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { format, formatDistanceToNow, startOfDay, isSameDay } from 'date-fns'
import {
  Calendar,
  MessageSquare,
  Paperclip,
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  User2,
  Users,
  X,
} from 'lucide-react'
import { ProjectMembersPanel } from './project-members-panel'

const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500/10', dot: 'bg-red-500' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500/10', dot: 'bg-blue-500' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10', dot: 'bg-gray-500' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400/10', dot: 'bg-gray-400' },
} as const

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  backlog: { label: 'Backlog', color: 'text-gray-500', bg: 'bg-gray-500' },
  todo: { label: 'To Do', color: 'text-blue-500', bg: 'bg-blue-500' },
  in_progress: { label: 'In Progress', color: 'text-amber-500', bg: 'bg-amber-500' },
  blocked: { label: 'Blocked', color: 'text-red-500', bg: 'bg-red-500' },
  in_review: { label: 'In Review', color: 'text-purple-500', bg: 'bg-purple-500' },
  done: { label: 'Done', color: 'text-green-500', bg: 'bg-green-500' },
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
  comment_count: number
  attachment_count: number
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

export function TimelineView({
  project,
  issues,
  user,
  view = 'timeline',
  onViewChange,
}: {
  project: Project
  issues: Issue[]
  user: User
  view?: 'kanban' | 'timeline'
  onViewChange?: (view: 'kanban' | 'timeline') => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'created_at' | 'updated_at'>('created_at')
  const [showMembersPanel, setShowMembersPanel] = useState(false)

  // Filter issues
  const filteredIssues = issues.filter((issue) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        issue.title.toLowerCase().includes(query) ||
        issue.id.toString().includes(query)
      )
    }
    return true
  })

  // Sort issues (with null safety)
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const aDateStr = a[sortBy] || a.created_at || ''
    const bDateStr = b[sortBy] || b.created_at || ''
    const aDate = aDateStr ? new Date(aDateStr) : new Date(0)
    const bDate = bDateStr ? new Date(bDateStr) : new Date(0)
    return bDate.getTime() - aDate.getTime() // Most recent first
  })

  // Group issues by day (with null safety)
  const issuesByDay = sortedIssues.reduce((acc, issue) => {
    const dateStr = issue[sortBy] || issue.created_at
    if (!dateStr) return acc // Skip issues without dates
    
    const date = startOfDay(new Date(dateStr))
    const dateKey = format(date, 'yyyy-MM-dd')
    if (!acc[dateKey]) {
      acc[dateKey] = {
        date,
        issues: [],
      }
    }
    acc[dateKey].issues.push(issue)
    return acc
  }, {} as Record<string, { date: Date; issues: Issue[] }>)

  const dayGroups = Object.values(issuesByDay).sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
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
                  #{project.id} - Timeline view - {sortedIssues.length} issues
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
                  onClick={() => onViewChange('timeline')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    view === 'timeline'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <List size={16} className="inline mr-1.5" />
                  Timeline
                </button>
              </div>
            )}

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

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'created_at' | 'updated_at')}
              className="px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="created_at">Sort by Created</option>
              <option value="updated_at">Sort by Updated</option>
            </select>

            {/* Team Members */}
            <button
              onClick={() => setShowMembersPanel(true)}
              className="flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors"
            >
              <Users size={16} />
              Team
            </button>
          </div>
        </div>
      </header>

      {/* Timeline */}
      <main className="p-6">
        <div className="max-w-5xl mx-auto">
          {dayGroups.length === 0 ? (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">No issues found</h2>
              <p className="text-muted-foreground">
                {searchQuery ? 'Try adjusting your search' : 'Create your first issue to get started'}
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Center timeline line */}
              <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/50 via-border to-border" />

              <div className="space-y-12">
                {dayGroups.map((group, groupIndex) => {
                  const isToday = isSameDay(group.date, new Date())
                  const isYesterday = isSameDay(
                    group.date,
                    new Date(Date.now() - 24 * 60 * 60 * 1000)
                  )

                  let dateLabel = format(group.date, 'MMMM d, yyyy')
                  if (isToday) dateLabel = 'Today'
                  else if (isYesterday) dateLabel = 'Yesterday'

                  return (
                    <div key={format(group.date, 'yyyy-MM-dd')} className="relative">
                      {/* Date marker - centered */}
                      <div className="flex justify-center mb-8">
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: groupIndex * 0.1 }}
                          className="relative z-10 flex items-center gap-3 px-4 py-2 bg-card border-2 border-primary/30 rounded-full shadow-lg"
                        >
                          <Calendar className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-sm">{dateLabel}</span>
                          <span className="text-xs text-muted-foreground px-2 py-0.5 bg-secondary rounded-full">
                            {group.issues.length} issue{group.issues.length !== 1 ? 's' : ''}
                          </span>
                        </motion.div>
                      </div>

                      {/* Issues - staggered left and right */}
                      <div className="space-y-6">
                        {group.issues.map((issue, issueIndex) => {
                          const isLeft = issueIndex % 2 === 0
                          const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
                          const status = STATUS_CONFIG[issue.status] || STATUS_CONFIG.backlog

                          return (
                            <motion.div
                              key={issue.id}
                              initial={{ opacity: 0, x: isLeft ? -50 : 50 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: (groupIndex * 0.1) + (issueIndex * 0.08) }}
                              className={`relative flex items-center ${isLeft ? 'justify-start' : 'justify-end'}`}
                            >
                              {/* Connector line from center to card */}
                              <div 
                                className={`absolute top-1/2 h-0.5 bg-border ${
                                  isLeft 
                                    ? 'right-1/2 left-[calc(50%-12rem)] mr-2' 
                                    : 'left-1/2 right-[calc(50%-12rem)] ml-2'
                                }`}
                              />
                              
                              {/* Center dot */}
                              <div className={`absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full ${priority?.dot || 'bg-primary'} border-4 border-background shadow-md z-10`} />

                              {/* Issue card */}
                              <Link 
                                href={`/dashboard/issues/${issue.id}`}
                                className={`w-[calc(50%-3rem)] ${isLeft ? 'mr-auto pr-8' : 'ml-auto pl-8'}`}
                              >
                                <div className="group bg-card rounded-xl border border-border p-4 hover:border-primary/50 hover:shadow-xl transition-all duration-200">
                                  {/* Header row */}
                                  <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                                        #{issue.id}
                                      </span>
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${status.bg}/20 ${status.color}`}>
                                        {status.label}
                                      </span>
                                      {priority && (
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
                                          {priority.label}
                                        </span>
                                      )}
                                    </div>
                                    
                                    {/* Assignee */}
                                    {issue.assignee_avatar ? (
                                      <Image
                                        src={issue.assignee_avatar}
                                        alt={issue.assignee_name || 'Assignee'}
                                        width={28}
                                        height={28}
                                        className="rounded-full ring-2 ring-background flex-shrink-0"
                                        title={issue.assignee_name}
                                      />
                                    ) : issue.assignee_name ? (
                                      <div 
                                        className="w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                                        title={issue.assignee_name}
                                      >
                                        {issue.assignee_name.charAt(0)}
                                      </div>
                                    ) : (
                                      <div className="w-7 h-7 bg-secondary rounded-full flex items-center justify-center flex-shrink-0">
                                        <User2 size={14} className="text-muted-foreground" />
                                      </div>
                                    )}
                                  </div>

                                  {/* Title */}
                                  <h3 className="font-medium text-sm mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                                    {issue.title}
                                  </h3>

                                  {/* Description */}
                                  {issue.description && (
                                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                                      {issue.description}
                                    </p>
                                  )}

                                  {/* Footer */}
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-border/50">
                                    {issue.comment_count > 0 && (
                                      <span className="flex items-center gap-1">
                                        <MessageSquare size={12} />
                                        {issue.comment_count}
                                      </span>
                                    )}
                                    {issue.attachment_count > 0 && (
                                      <span className="flex items-center gap-1">
                                        <Paperclip size={12} />
                                        {issue.attachment_count}
                                      </span>
                                    )}
                                    <span className="ml-auto">
                                      {(issue[sortBy] || issue.created_at) && formatDistanceToNow(new Date(issue[sortBy] || issue.created_at))} ago
                                    </span>
                                  </div>
                                </div>
                              </Link>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* End marker */}
              <div className="flex justify-center mt-12">
                <div className="w-3 h-3 rounded-full bg-border" />
              </div>
            </div>
          )}
        </div>
      </main>

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
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border shadow-2xl z-50 overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 bg-card/80 backdrop-blur border-b border-border px-6 py-4">
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
