'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { KanbanBoard } from './kanban-board'
import { GanttView } from './gantt-view'
import { IssueListView } from './issue-list-view'
import { ProjectSettingsModal } from './project-settings-modal'
import { AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  GanttChartSquare,
  Settings,
  Users,
  Plus,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { ProjectMembersPanel } from './project-members-panel'
import { CreateIssueModal } from './create-issue-modal'

interface Project {
  id: number
  name: string
  description?: string | null
  priority?: string | null
  visibility?: string | null
  color?: string | null
  icon_url?: string | null
  banner_url?: string | null
  start_date?: string | null
  end_date?: string | null
  owner_id?: number | null
  status?: string | null
}

interface User {
  id?: number
  name?: string | null
  email?: string | null
  image?: string | null
}

interface KanbanData {
  [status: string]: any[]
}

type ViewMode = 'kanban' | 'list' | 'timeline'

// Extracted ViewToggle component to avoid TypeScript narrowing issues
function ViewToggle({
  currentView,
  onViewChange,
}: {
  currentView: ViewMode
  onViewChange: (view: ViewMode) => void
}) {
  return (
    <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
      <button
        onClick={() => onViewChange('kanban')}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          currentView === 'kanban'
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
          currentView === 'list'
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
          currentView === 'timeline'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <GanttChartSquare size={16} className="inline mr-1.5" />
        Gantt
      </button>
    </div>
  )
}

export function ProjectView({
  project: initialProject,
  initialKanban,
  user,
}: {
  project: Project
  initialKanban: KanbanData
  user: User
}) {
  const [project, setProject] = useState(initialProject)
  const [view, setView] = useState<ViewMode>('kanban')
  const [showSettings, setShowSettings] = useState(false)
  const [showMembersPanel, setShowMembersPanel] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const allIssues = useMemo(() => {
    // Flatten kanban data to get all issues
    return Object.values(initialKanban).flat()
  }, [initialKanban])

  // Fetch all issues for List and Gantt views
  const { data: issues = allIssues } = useQuery({
    queryKey: ['project-issues', project.id],
    queryFn: async () => {
      const res = await fetch(`/api/issues?project_id=${project.id}&includeProject=true`)
      if (!res.ok) return allIssues
      const data = await res.json()
      // Ensure we always return an array
      if (Array.isArray(data)) return data
      // If it's kanban format, flatten it
      if (data && typeof data === 'object') {
        return Object.values(data).flat()
      }
      return allIssues
    },
    enabled: view === 'timeline' || view === 'list',
    initialData: allIssues,
  })

  // Calculate project color for header
  const projectColor = project.color || '#3B82F6'

  // For kanban view, delegate to the KanbanBoard component
  if (view === 'kanban') {
    return (
      <>
        <KanbanBoard
          project={project}
          initialKanban={initialKanban}
          user={user}
          view="kanban"
          onViewChange={(v) => setView(v as ViewMode)}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <ProjectSettingsModal
              project={project}
              onClose={() => setShowSettings(false)}
              onUpdate={(updatedProject) => setProject(updatedProject)}
            />
          )}
        </AnimatePresence>
      </>
    )
  }

  // For timeline view, delegate to the GanttView component
  if (view === 'timeline') {
    return (
      <>
        <GanttView
          project={project}
          issues={issues}
          user={user}
          view="timeline"
          onViewChange={(v) => setView(v as ViewMode)}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <ProjectSettingsModal
              project={project}
              onClose={() => setShowSettings(false)}
              onUpdate={(updatedProject) => setProject(updatedProject)}
            />
          )}
        </AnimatePresence>
      </>
    )
  }

  // List view - render directly here
  return (
    <div className="min-h-screen bg-background">
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
                  #{project.id} - List view - {issues.length} issues
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <ViewToggle currentView="list" onViewChange={setView} />

              {/* Team Members */}
              <button
                onClick={() => setShowMembersPanel(true)}
                className="flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors"
              >
                <Users size={16} />
                Team
              </button>

              {/* Settings */}
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 bg-background border border-input rounded-lg hover:bg-secondary transition-colors"
                title="Project Settings"
              >
                <Settings size={16} />
              </button>

              {/* New Issue */}
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={18} />
                New Issue
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <IssueListView issues={issues} showProjectColumn={false} />
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <ProjectSettingsModal
            project={project}
            onClose={() => setShowSettings(false)}
            onUpdate={(updatedProject) => setProject(updatedProject)}
          />
        )}
      </AnimatePresence>

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

      {/* Create Issue Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateIssueModal
            projectId={project.id}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

