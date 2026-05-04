'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Plus,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  X,
  Upload,
  Globe,
  Users,
  Lock,
  Check,
} from 'lucide-react'

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
}

interface Project {
  id: number
  name: string
  description?: string
  status: string
  issue_count: number
  open_issues: number
  created_at: string
}

export function Dashboard({ user }: { user: User }) {
  const [showNewProject, setShowNewProject] = useState(false)
  const queryClient = useQueryClient()

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects')
      if (!res.ok) throw new Error('Failed to fetch projects')
      return res.json() as Promise<Project[]>
    },
  })

  const createProject = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to create project')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setShowNewProject(false)
      toast.success('Project created!')
    },
    onError: () => {
      toast.error('Failed to create project')
    },
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1" data-loading={isLoading || undefined}>
            {isLoading ? (
              <span className="inline-block h-4 w-24 bg-muted animate-pulse rounded" />
            ) : (
              `${projects.length} project${projects.length !== 1 ? 's' : ''}`
            )}
          </p>
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={18} />
          New Project
        </button>
      </div>

      {/* Projects grid */}
      {isLoading ? (
        <div data-loading="true" className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="col-span-full text-center py-8">
            <div className="inline-flex items-center justify-center w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-40 bg-card rounded-xl border border-border animate-pulse"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-24"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
            <LayoutGrid className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
          <p className="text-muted-foreground mb-6">
            Create your first project to get started
          </p>
          <button
            onClick={() => setShowNewProject(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={18} />
            Create Project
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {projects.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} />
          ))}
        </motion.div>
      )}

      {/* New project modal */}
      <AnimatePresence>
        {showNewProject && (
          <NewProjectModal
            onClose={() => setShowNewProject(false)}
            onCreate={(data) => createProject.mutate(data)}
            isLoading={createProject.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  const [expanded, setExpanded] = useState(false)

  // Calculate completion rate
  const completedIssues = (project.issue_count || 0) - (project.open_issues || 0)
  const completionRate = project.issue_count > 0
    ? Math.round((completedIssues / project.issue_count) * 100)
    : 0

  // Generate a consistent color based on project id
  const colors = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899']
  const projectColor = colors[project.id % colors.length]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      layout
    >
      <div className="bg-card rounded-xl border border-border overflow-hidden hover:border-primary/50 hover:shadow-lg transition-all">
        {/* Banner */}
        <div
          className="h-12 relative"
          style={{
            background: `linear-gradient(135deg, ${projectColor}50, ${projectColor}20)`,
          }}
        />

        {/* Content */}
        <div className="p-4">
          {/* Header row with logo */}
          <div className="flex items-start mb-3 -mt-8">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl border-4 border-card shadow-lg flex items-center justify-center text-white font-bold text-lg"
                style={{ backgroundColor: projectColor }}
              >
                {project.name.charAt(0).toUpperCase()}
              </div>
              <div className="pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{project.name}</h3>
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 rounded">
                    P2
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  #{project.id} • Team
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          {project.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {project.description}
            </p>
          )}

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">
                <span className="text-green-500">● {project.open_issues || 0} open</span>
                {' - '}
                {project.issue_count || 0} total
              </span>
              <span className="text-muted-foreground">{completionRate}%</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-green-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${completionRate}%` }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
              />
            </div>
          </div>

          {/* View project link */}
          <Link
            href={`/dashboard/${project.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View project
            <ChevronRight size={14} />
          </Link>
        </div>

        {/* Expand indicator at bottom */}
        <button
          onClick={(e) => {
            e.preventDefault()
            setExpanded(!expanded)
          }}
          className="w-full py-2 flex items-center justify-center gap-1 border-t border-border hover:bg-secondary/50 transition-colors group"
        >
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          </motion.div>
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            {expanded ? 'Show less' : 'Show more'}
          </span>
        </button>

        {/* Expandable section */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-border overflow-hidden"
            >
              <div className="p-4 space-y-4 bg-secondary/30">
                {/* Recent issues placeholder */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Recent Issues</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">No recent issues</span>
                    </div>
                  </div>
                </div>

                {/* Team placeholder */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Team</h4>
                  <div className="flex -space-x-2">
                    <div className="w-7 h-7 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center text-[10px] font-medium">
                      ?
                    </div>
                  </div>
                </div>

                {/* Next milestone placeholder */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Next Milestone</h4>
                  <p className="text-sm text-muted-foreground">No milestones set</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

const PRIORITY_OPTIONS = [
  { id: 'P0', label: 'P0 - Critical', color: 'bg-red-500' },
  { id: 'P1', label: 'P1 - High', color: 'bg-amber-500' },
  { id: 'P2', label: 'P2 - Medium', color: 'bg-blue-500' },
  { id: 'P3', label: 'P3 - Low', color: 'bg-gray-500' },
] as const

const VISIBILITY_OPTIONS = [
  { id: 'private', label: 'Private', description: 'Only you can see', icon: Lock },
  { id: 'team', label: 'Team', description: 'Team members can access', icon: Users },
  { id: 'public', label: 'Public', description: 'Anyone can view', icon: Globe },
] as const

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#6B7280',
]

function NewProjectModal({
  onClose,
  onCreate,
  isLoading,
}: {
  onClose: () => void
  onCreate: (data: { name: string; description: string }) => void
  isLoading: boolean
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('P2')
  const [visibility, setVisibility] = useState('team')
  const [color, setColor] = useState('#3B82F6')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setLogoPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setBannerPreview(e.target?.result as string)
      reader.readAsDataURL(file)
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
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
      >
        <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* Banner preview area */}
          <div
            className="h-24 relative flex-shrink-0"
            style={{
              background: bannerPreview
                ? `url(${bannerPreview}) center/cover`
                : `linear-gradient(135deg, ${color}40, ${color}10)`,
            }}
          >
            <input
              type="file"
              ref={bannerInputRef}
              onChange={handleBannerSelect}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded hover:bg-black/70 transition-colors"
            >
              {bannerPreview ? 'Change banner' : 'Add banner'}
            </button>
            <button
              onClick={onClose}
              className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Logo positioned over banner */}
          <div className="relative px-6 -mt-8">
            <input
              type="file"
              ref={logoInputRef}
              onChange={handleLogoSelect}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="w-16 h-16 rounded-xl border-4 border-card bg-card shadow-lg flex items-center justify-center overflow-hidden hover:opacity-80 transition-opacity"
              style={{ backgroundColor: !logoPreview ? color : undefined }}
            >
              {logoPreview ? (
                <Image src={logoPreview} alt="Logo" width={64} height={64} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-white">{name.charAt(0).toUpperCase() || 'P'}</span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <form
              id="new-project-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim()) {
                  onCreate({ name: name.trim(), description: description.trim() })
                }
              }}
              className="space-y-5"
            >
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Project"
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this project about?"
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Priority and Color in row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Color
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-primary scale-110' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Visibility
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {VISIBILITY_OPTIONS.map((v) => {
                    const Icon = v.icon
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVisibility(v.id)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                          visibility === v.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input hover:bg-secondary'
                        }`}
                      >
                        <Icon size={18} />
                        <span className="text-sm font-medium">{v.label}</span>
                        <span className="text-[10px] text-muted-foreground">{v.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </form>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="new-project-form"
              disabled={!name.trim() || isLoading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
