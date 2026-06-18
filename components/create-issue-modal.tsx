'use client'

import { useState, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import Image from 'next/image'
import {
  X,
  ChevronRight,
  Circle,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown,
  User,
  ListChecks,
  Maximize2,
  Minimize2,
  Check,
} from 'lucide-react'
import { RichTextEditor } from './rich-text-editor'

// Canonical issue statuses — must match lib/work-items.ts (ISSUE_STATUSES).
const STATUSES = [
  { id: 'backlog', label: 'Backlog', icon: Circle, color: 'text-gray-400' },
  { id: 'todo', label: 'Todo', icon: Circle, color: 'text-blue-400' },
  { id: 'in_progress', label: 'In progress', icon: Circle, color: 'text-amber-400' },
  { id: 'done', label: 'Done', icon: Check, color: 'text-green-400' },
  { id: 'cancelled', label: 'Cancelled', icon: X, color: 'text-gray-400' },
] as const

const PRIORITIES = [
  { id: 1, label: 'Urgent', icon: AlertTriangle, color: 'text-red-500' },
  { id: 2, label: 'High', icon: ArrowUp, color: 'text-amber-500' },
  { id: 3, label: 'Medium', icon: Minus, color: 'text-blue-500' },
  { id: 4, label: 'Low', icon: ArrowDown, color: 'text-gray-400' },
] as const

interface Project {
  id: number
  name: string
}

interface CreateIssueModalProps {
  projectId?: number
  defaultStatus?: string
  onClose: () => void
  onSuccess?: (issue: any) => void
}

export function CreateIssueModal({
  projectId,
  defaultStatus = 'backlog',
  onClose,
  onSuccess,
}: CreateIssueModalProps) {
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState(defaultStatus)
  const [priority, setPriority] = useState<number>(3)
  const [assigneeIds, setAssigneeIds] = useState<number[]>([])
  const [taskId, setTaskId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projectId || null)
  const [createMore, setCreateMore] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  // Dropdown states
  const [showStatusDropdown, setShowStatusDropdown] = useState(false)
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false)
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [showTaskDropdown, setShowTaskDropdown] = useState(false)

  // Close all dropdowns
  const closeAllDropdowns = () => {
    setShowStatusDropdown(false)
    setShowPriorityDropdown(false)
    setShowAssigneeDropdown(false)
    setShowProjectDropdown(false)
    setShowTaskDropdown(false)
  }

  // Fetch projects for dropdown (if no projectId provided)
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects', ws?.slug],
    enabled: !!ws?.slug,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) throw new Error('Failed to fetch projects')
      const json = await res.json()
      return json.data
    },
  })

  // Fetch project members for assignee dropdown
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', selectedProjectId, ws?.slug],
    queryFn: async () => {
      if (!selectedProjectId) return []
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${selectedProjectId}/members`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data
    },
    enabled: !!selectedProjectId && !!ws?.slug,
  })

  // Fetch tasks for dropdown
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', selectedProjectId, ws?.slug],
    queryFn: async () => {
      if (!selectedProjectId) return []
      const res = await fetch(`/api/workspaces/${ws!.slug}/tasks?project_id=${selectedProjectId}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data
    },
    enabled: !!selectedProjectId && !!ws?.slug,
  })

  // Get current project name
  const currentProject = projects.find(p => p.id === selectedProjectId)
  const currentStatus = STATUSES.find(s => s.id === status) || STATUSES[0]
  const currentPriority = PRIORITIES.find(p => p.id === priority) || PRIORITIES[2]
  const currentAssignees = members.filter((m: any) => assigneeIds.includes(m.user_id))
  const currentTask = tasks.find((m: any) => m.id === taskId)

  // Image upload handler for rich text editor
  const handleFileUpload = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error('Failed to upload image')
    }

    const data = await res.json()
    return data.url
  }, [])

  // Create issue mutation
  const createIssue = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId) throw new Error('No project selected')
      if (!title.trim()) throw new Error('Title is required')

      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: selectedProjectId,
          title: title.trim(),
          description: description || undefined,
          status,
          priority,
          assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
          task_id: taskId || undefined,
        }),
      })

      if (!res.ok) throw new Error('Failed to create issue')
      return res.json()
    },
    onSuccess: (newIssue) => {
      // Invalidate relevant caches
      queryClient.invalidateQueries({ queryKey: ['all-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })

      toast.success('Issue created!')

      if (createMore) {
        // Reset form but keep project and assignee
        setTitle('')
        setDescription('')
        setStatus(defaultStatus)
        setPriority(3)
        setTaskId(null)
        // Keep assigneeIds and project so "create more" stays in context.
        titleInputRef.current?.focus()
      } else {
        onSuccess?.(newIssue)
        onClose()
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create issue')
    },
  })

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    if (!selectedProjectId) {
      toast.error('Please select a project')
      return
    }
    createIssue.mutate()
  }

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      closeAllDropdowns()
    }
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
        onClick={() => closeAllDropdowns()}
      >
        <div
          className={`bg-card rounded-2xl border border-border shadow-2xl w-full flex flex-col overflow-hidden transition-all duration-200 ${
            isExpanded ? 'max-w-5xl max-h-[95vh]' : 'max-w-3xl max-h-[90vh]'
          }`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Header with breadcrumb */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-sm">
              {/* Project selector as breadcrumb */}
              <div className="relative">
                <button
                  onClick={() => {
                    closeAllDropdowns()
                    setShowProjectDropdown(!showProjectDropdown)
                  }}
                  className="font-medium text-foreground hover:text-primary transition-colors"
                >
                  {currentProject?.name || 'Select project'}
                </button>
                <AnimatePresence>
                  {showProjectDropdown && (
                    <DropdownMenu onClose={() => setShowProjectDropdown(false)}>
                      {projects.map((p) => (
                        <DropdownItem
                          key={p.id}
                          selected={selectedProjectId === p.id}
                          onClick={() => {
                            setSelectedProjectId(p.id)
                            setAssigneeIds([])
                            setTaskId(null)
                            setShowProjectDropdown(false)
                          }}
                        >
                          {p.name}
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  )}
                </AnimatePresence>
              </div>
              <ChevronRight size={14} className="text-muted-foreground" />
              <span className="text-muted-foreground">New issue</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground"
                title={isExpanded ? 'Minimize' : 'Expand'}
              >
                {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Title - Clean, no label */}
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              className="w-full text-xl font-semibold bg-transparent border-none focus:outline-hidden focus:ring-0 placeholder:text-muted-foreground/50"
              autoFocus
            />

            {/* Description - Rich text editor with toolbar */}
            <div className="min-h-[200px]">
              <RichTextEditor
                content={description}
                onChange={setDescription}
                placeholder="Add description… type / to format, @ to mention"
                onFileUpload={handleFileUpload}
                hideToolbar
                minHeight={isExpanded ? '350px' : '200px'}
              />
            </div>
          </div>

          {/* Bottom control bar - Linear style */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-card/50">
            <div className="flex items-center gap-1">
              {/* Status button */}
              <div className="relative">
                <ControlButton
                  onClick={() => {
                    closeAllDropdowns()
                    setShowStatusDropdown(!showStatusDropdown)
                  }}
                  active={showStatusDropdown}
                >
                  <currentStatus.icon size={14} className={currentStatus.color} />
                  <span className="hidden sm:inline">{currentStatus.label}</span>
                </ControlButton>
                <AnimatePresence>
                  {showStatusDropdown && (
                    <DropdownMenu onClose={() => setShowStatusDropdown(false)} position="top">
                      {STATUSES.map((s) => {
                        const Icon = s.icon
                        return (
                          <DropdownItem
                            key={s.id}
                            selected={status === s.id}
                            onClick={() => {
                              setStatus(s.id)
                              setShowStatusDropdown(false)
                            }}
                          >
                            <Icon size={14} className={s.color} />
                            {s.label}
                          </DropdownItem>
                        )
                      })}
                    </DropdownMenu>
                  )}
                </AnimatePresence>
              </div>

              {/* Priority button */}
              <div className="relative">
                <ControlButton
                  onClick={() => {
                    closeAllDropdowns()
                    setShowPriorityDropdown(!showPriorityDropdown)
                  }}
                  active={showPriorityDropdown}
                >
                  <currentPriority.icon size={14} className={currentPriority.color} />
                  <span className="hidden sm:inline">{currentPriority.label}</span>
                </ControlButton>
                <AnimatePresence>
                  {showPriorityDropdown && (
                    <DropdownMenu onClose={() => setShowPriorityDropdown(false)} position="top">
                      {PRIORITIES.map((p) => {
                        const Icon = p.icon
                        return (
                          <DropdownItem
                            key={p.id}
                            selected={priority === p.id}
                            onClick={() => {
                              setPriority(p.id)
                              setShowPriorityDropdown(false)
                            }}
                          >
                            <Icon size={14} className={p.color} />
                            {p.label}
                          </DropdownItem>
                        )
                      })}
                    </DropdownMenu>
                  )}
                </AnimatePresence>
              </div>

              {/* Assignee button — multi-select */}
              <div className="relative">
                <ControlButton
                  onClick={() => {
                    closeAllDropdowns()
                    setShowAssigneeDropdown(!showAssigneeDropdown)
                  }}
                  active={showAssigneeDropdown}
                  disabled={!selectedProjectId}
                >
                  {currentAssignees.length === 0 ? (
                    <>
                      <User size={14} />
                      <span className="hidden sm:inline">Assignees</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center">
                        {currentAssignees.slice(0, 2).map((m: any, i: number) => (
                          <span key={m.user_id} style={{ marginLeft: i > 0 ? '-4px' : 0 }}>
                            {m.avatar_url ? (
                              <Image src={m.avatar_url} alt="" width={16} height={16} className="rounded-full" />
                            ) : (
                              <div className="w-4 h-4 bg-primary/20 rounded-full flex items-center justify-center text-[8px]">
                                {(m.name || m.email)?.charAt(0)}
                              </div>
                            )}
                          </span>
                        ))}
                      </span>
                      <span className="hidden sm:inline">
                        {currentAssignees.length === 1
                          ? (currentAssignees[0] as any).name || (currentAssignees[0] as any).email
                          : `${currentAssignees.length} assignees`}
                      </span>
                    </>
                  )}
                </ControlButton>
                <AnimatePresence>
                  {showAssigneeDropdown && (
                    <DropdownMenu onClose={() => setShowAssigneeDropdown(false)} position="top">
                      {assigneeIds.length > 0 && (
                        <DropdownItem
                          selected={false}
                          onClick={() => setAssigneeIds([])}
                        >
                          <User size={14} className="text-muted-foreground" />
                          Clear assignees
                        </DropdownItem>
                      )}
                      {members.map((m: any) => (
                        <DropdownItem
                          key={m.user_id}
                          selected={assigneeIds.includes(m.user_id)}
                          onClick={() => {
                            setAssigneeIds((prev) =>
                              prev.includes(m.user_id)
                                ? prev.filter((id) => id !== m.user_id)
                                : [...prev, m.user_id]
                            )
                          }}
                        >
                          {m.avatar_url ? (
                            <Image
                              src={m.avatar_url}
                              alt=""
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                          ) : (
                            <div className="w-4 h-4 bg-primary/20 rounded-full flex items-center justify-center text-[8px]">
                              {(m.name || m.email)?.charAt(0)}
                            </div>
                          )}
                          {m.name || m.email}
                          {assigneeIds.includes(m.user_id) && (
                            <span className="ml-auto text-primary">✓</span>
                          )}
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  )}
                </AnimatePresence>
              </div>

              {/* Task button */}
              <div className="relative">
                <ControlButton
                  onClick={() => {
                    closeAllDropdowns()
                    setShowTaskDropdown(!showTaskDropdown)
                  }}
                  active={showTaskDropdown}
                  disabled={!selectedProjectId}
                >
                  <ListChecks size={14} />
                  <span className="hidden sm:inline">
                    {currentTask?.name || 'Task'}
                  </span>
                </ControlButton>
                <AnimatePresence>
                  {showTaskDropdown && (
                    <DropdownMenu onClose={() => setShowTaskDropdown(false)} position="top">
                      <DropdownItem
                        selected={!taskId}
                        onClick={() => {
                          setTaskId(null)
                          setShowTaskDropdown(false)
                        }}
                      >
                        <ListChecks size={14} className="text-muted-foreground" />
                        No task
                      </DropdownItem>
                      {tasks.map((m: any) => (
                        <DropdownItem
                          key={m.id}
                          selected={taskId === m.id}
                          onClick={() => {
                            setTaskId(m.id)
                            setShowTaskDropdown(false)
                          }}
                        >
                          <ListChecks size={14} />
                          {m.name}
                        </DropdownItem>
                      ))}
                    </DropdownMenu>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Right side: Create more + Submit */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={createMore}
                  onChange={(e) => setCreateMore(e.target.checked)}
                  className="rounded border-input"
                />
                Create more
              </label>
              <button
                onClick={handleSubmit}
                disabled={!title.trim() || !selectedProjectId || createIssue.isPending}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {createIssue.isPending ? 'Creating...' : 'Create issue'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

// Control button component for bottom bar
function ControlButton({
  onClick,
  active,
  disabled,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  )
}

// Dropdown menu component
function DropdownMenu({
  children,
  onClose,
  position = 'bottom',
}: {
  children: React.ReactNode
  onClose: () => void
  position?: 'top' | 'bottom'
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: position === 'top' ? 5 : -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: position === 'top' ? 5 : -5 }}
      className={`absolute left-0 z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-xl py-1 ${
        position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
      }`}
    >
      {children}
    </motion.div>
  )
}

// Dropdown item component
function DropdownItem({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-secondary transition-colors ${
        selected ? 'bg-secondary/50 text-primary' : ''
      }`}
    >
      {children}
    </button>
  )
}
