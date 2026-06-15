'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { toast } from 'sonner'
import { ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { ProjectIcon } from './project-icon'
import { IconPicker } from './icon-picker'
import { RichTextEditor, RichTextDisplay, type MentionItem } from './rich-text-editor'
import { ActivityFeed } from './activity-feed'
import { DatePicker } from '@/components/ui/date-picker'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'
import {
  StatusIcon,
  PriorityIcon,
  projectPriorityKey,
  ProgressRing,
  HealthIcon,
} from '@/components/ui/work-item-icons'
import {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_UPDATE_STATUSES,
  projectUpdateStatusLabel,
  projectUpdateStatusColor,
} from '@/lib/work-items'
import { useDeleteDialog } from '@/components/ui/delete-with-children-dialog'
import { DetailPageSkeleton } from '@/components/ui/motion'

interface ProjectMember {
  user_id: number
  email: string
  name: string | null
  avatar_url: string | null
}

interface ProjectDetail {
  id: number
  workspace_id: number
  name: string
  description: string | null
  status: string
  priority: string | null
  color: string | null
  icon: string | null
  owner_id: number | null
  start_date: string | null
  end_date: string | null
  created_at: string
  members: ProjectMember[]
}

interface IssueAssignee {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  assignees: IssueAssignee[]
}

interface MilestoneRow {
  id: number
  name: string
  due_date: string | null
  status: string | null
  issue_count: number
  completed_issues: number
}

interface WsMember {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}

export function ProjectDetailView({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { confirmDelete } = useDeleteDialog()
  const { data: ws } = useActiveWorkspace()
  const searchParams = useSearchParams()
  const isNew = searchParams.get('new') === '1'
  const nameInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const router = useRouter()

  const createMilestone = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Milestone', project_id: projectId }),
      })
      if (!res.ok) throw new Error('Failed to create milestone')
      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (milestone) => {
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones'] })
      queryClient.invalidateQueries({ queryKey: ['project-milestones', projectId] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/milestones/${milestone.id}?new=1`)
    },
    onError: () => toast.error('Failed to create milestone'),
  })

  const createIssue = useMutation({
    mutationFn: async (milestoneId: number | null) => {
      const body: Record<string, unknown> = { title: 'New Issue', project_id: projectId }
      if (milestoneId != null) body.milestone_id = milestoneId
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create issue')
      return res.json() as Promise<{ id: number }>
    },
    onSuccess: (issue) => {
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues', projectId] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/issues/${issue.id}?new=1`)
    },
    onError: () => toast.error('Failed to create issue'),
  })

  // Project Updates
  const [showUpdateComposer, setShowUpdateComposer] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('on_track')
  const [updateBody, setUpdateBody] = useState('')
  const [updateBodyKey, setUpdateBodyKey] = useState(0)
  const [selectedUpdate, setSelectedUpdate] = useState(0) // index into updates, 0 = latest
  const descRef = useRef<string>('')
  const descTouchedRef = useRef(false)

  const project = useQuery({
    queryKey: ['project', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<ProjectDetail | null> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}`)
      if (!res.ok) return null
      return res.json()
    },
  })

  useEffect(() => {
    if (isNew && project.data && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isNew, project.data?.id])

  // Warn before close/reload when there are unsaved changes.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (nameDraft !== null || descTouchedRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [nameDraft])

  const issues = useQuery({
    queryKey: ['project-issues', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<IssueRow[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/issues?project_id=${projectId}&limit=200`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const milestones = useQuery({
    queryKey: ['project-milestones', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<MilestoneRow[]> => {
      const res = await fetch(
        `/api/workspaces/${ws!.slug}/milestones?project_id=${projectId}`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const updates = useQuery({
    queryKey: ['project-updates', projectId, ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}/updates`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Array<{
        id: number
        status: string
        body: string | null
        created_at: string
        author_name: string | null
        author_email: string | null
        author_avatar: string | null
      }>
    },
  })

  const wsMembers = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async (): Promise<WsMember[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const patch = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects'] })
      toast.success('Saved')
    },
    onError: () => toast.error('Failed to update project'),
  })

  const postUpdate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: updateStatus, body: updateBody }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Update posted')
      setShowUpdateComposer(false)
      setUpdateBody('')
      setUpdateBodyKey((k) => k + 1)
      setUpdateStatus('on_track')
      setSelectedUpdate(0)
      queryClient.invalidateQueries({ queryKey: ['project-updates', projectId] })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
    },
    onError: () => toast.error('Could not post update'),
  })

  const remove = useMutation({
    mutationFn: async (mode: 'cascade' | 'detach') => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}?mode=${mode}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Project moved to Trash')
      queryClient.setQueriesData<{ id: number }[]>({ queryKey: ['ws-projects-listing'] }, (old) =>
        old?.filter((p) => p.id !== projectId)
      )
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects'] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push('/dashboard')
    },
    onError: () => toast.error('Could not delete project'),
  })

  if (project.isLoading) {
    return <DetailPageSkeleton hasIcon />
  }
  if (!project.data) {
    return (
      <div className="p-8">
        <Link href="/dashboard" className="text-xs text-muted-foreground hover:underline">
          ← Back to projects
        </Link>
        <p className="mt-4 text-sm">Project not found.</p>
      </div>
    )
  }

  const data = project.data
  const total = issues.data?.length ?? 0
  const done =
    issues.data?.filter((i) => i.status === 'done' || i.status === 'cancelled').length ?? 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const memberIds = new Set((data.members ?? []).map((m) => m.user_id))
  const addableMembers = (wsMembers.data ?? []).filter((m) => !memberIds.has(m.user_id))

  const mentionItems: MentionItem[] = (wsMembers.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  const selUpdate = updates.data?.[selectedUpdate] ?? updates.data?.[0]

  function commitName() {
    const next = nameDraft?.trim()
    if (next && next !== data.name) patch.mutate({ name: next })
    setNameDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Breadcrumb header */}
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[14px] backdrop-blur">
        <Link
          href="/dashboard"
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Projects
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        <ProjectIcon icon={data.icon} color={data.color} name={data.name} size={18} />
        <span className="max-w-[32ch] truncate font-medium">{data.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={async () => {
              const decision = await confirmDelete({
                kind: 'project',
                name: data.name,
                previewUrl: `/api/workspaces/${ws!.slug}/projects/${projectId}?preview=1`,
              })
              if (!decision) return
              remove.mutate(decision.mode)
            }}
            title="Delete project"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col xl:flex-row">
        {/* Document */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
            {/* Icon + Title — same row */}
            <div className="mb-3 flex items-start gap-3">
              <div className="mt-1 shrink-0">
                <IconPicker
                  icon={data.icon}
                  color={data.color ?? '#5e6ad2'}
                  name={data.name}
                  onChange={(v) => patch.mutate({ icon: v.icon, color: v.color })}
                />
              </div>
              <textarea
                rows={1}
                value={nameDraft ?? data.name}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.target as HTMLTextAreaElement).blur()
                  }
                }}
                maxLength={100}
                placeholder="Project name"
                className="w-full resize-none overflow-hidden bg-transparent pt-1 text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
                ref={(el) => {
                  nameInputRef.current = el
                  if (el) {
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }
                }}
              />
            </div>

            {/* Updates */}
            <section className="mb-6 mt-1">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-base font-medium">Updates</h2>
                <div className="h-px flex-1 bg-border" />
                <button
                  onClick={() => setShowUpdateComposer((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {showUpdateComposer ? <X size={13} /> : <Plus size={13} />}
                  {showUpdateComposer ? 'Cancel' : 'Add update'}
                </button>
              </div>

              {showUpdateComposer ? (
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="mb-2">
                    <PropertySelect
                      value={updateStatus}
                      onChange={setUpdateStatus}
                      options={PROJECT_UPDATE_STATUSES.map((s) => ({
                        value: s.value,
                        label: s.label,
                        icon: <HealthIcon status={s.value} size={14} />,
                      }))}
                      buttonClassName="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs hover:bg-secondary"
                    />
                  </div>
                  <RichTextEditor
                    key={`update-${updateBodyKey}`}
                    content=""
                    onChange={setUpdateBody}
                    placeholder="Write an update…"
                    variant="seamless"
                    minHeight="80px"
                    mentionItems={mentionItems}
                    onFileUpload={async (file) => {
                      const fd = new FormData()
                      fd.append('file', file)
                      const res = await fetch('/api/upload', { method: 'POST', body: fd })
                      if (!res.ok) throw new Error('upload failed')
                      const j = await res.json()
                      return j.url
                    }}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowUpdateComposer(false)
                        setUpdateBody('')
                        setUpdateBodyKey((k) => k + 1)
                        setUpdateStatus('on_track')
                      }}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => postUpdate.mutate()}
                      disabled={postUpdate.isPending}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      Post update
                    </button>
                  </div>
                </div>
              ) : selUpdate ? (
                <div className="rounded-lg border border-border bg-card/40 p-3.5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <HealthIcon status={selUpdate.status} size={16} />
                    <span
                      className="font-medium"
                      style={{ color: projectUpdateStatusColor(selUpdate.status) }}
                    >
                      {projectUpdateStatusLabel(selUpdate.status)}
                    </span>
                    <span className="ml-1 flex items-center gap-1.5 text-muted-foreground">
                      <MemberAvatar
                        name={selUpdate.author_name}
                        email={selUpdate.author_email}
                        avatarUrl={selUpdate.author_avatar}
                        size={18}
                      />
                      <span>{selUpdate.author_name ?? selUpdate.author_email}</span>
                    </span>
                    <span
                      className="ml-auto text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatDistanceToNow(new Date(selUpdate.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {selUpdate.body ? (
                    <RichTextDisplay content={selUpdate.body} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No details.</p>
                  )}
                  {(updates.data?.length ?? 0) > 1 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
                      {(updates.data ?? []).map((u, i) => (
                        <button
                          key={u.id}
                          onClick={() => setSelectedUpdate(i)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                            i === selectedUpdate
                              ? 'border-border bg-secondary text-foreground'
                              : 'border-transparent text-muted-foreground hover:bg-secondary/60'
                          }`}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: projectUpdateStatusColor(u.status) }}
                          />
                          <span suppressHydrationWarning>
                            {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3.5 py-3 text-[13px] text-muted-foreground">
                  <HealthIcon status={null} size={16} />
                  <span>No updates yet</span>
                </div>
              )}
            </section>

            {/* Description — seamless TipTap, saves on blur */}
            <RichTextEditor
              key={`pdesc-${data.id}`}
              content={data.description ?? ''}
              onChange={(html) => {
                descRef.current = html
                descTouchedRef.current = true
              }}
              onBlur={() => {
                if (descTouchedRef.current && descRef.current !== (data.description ?? '')) {
                  patch.mutate({ description: descRef.current })
                }
                descTouchedRef.current = false
              }}
              placeholder="Add description… type @ to mention someone"
              variant="seamless"
              minHeight="100px"
              mentionItems={mentionItems}
              onFileUpload={async (file) => {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/upload', { method: 'POST', body: fd })
                if (!res.ok) throw new Error('upload failed')
                const j = await res.json()
                return j.url
              }}
            />

            {/* Milestones */}
            <section className="mt-12">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-base font-medium">
                  Milestones{' '}
                  {milestones.data?.length ? (
                    <span className="font-normal text-muted-foreground">{milestones.data.length}</span>
                  ) : null}
                </h2>
                <div className="h-px flex-1 bg-border" />
                <button
                  onClick={() => ws && createMilestone.mutate()}
                  disabled={createMilestone.isPending || !ws}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={13} />
                  New milestone
                </button>
              </div>
              {milestones.data?.length ? (
                <ul>
                  {milestones.data.map((m) => {
                    const t = m.issue_count ?? 0
                    const d = m.completed_issues ?? 0
                    const p = t > 0 ? Math.round((d / t) * 100) : 0
                    return (
                      <li key={m.id} className="group -mx-2 flex items-center gap-1 rounded-md px-2 transition-colors hover:bg-secondary/50">
                        <Link
                          href={`/dashboard/milestones/${m.id}`}
                          prefetch={false}
                          className="flex flex-1 items-center gap-2.5 py-2 text-sm"
                        >
                          <span
                            className="size-2 shrink-0 rotate-45 rounded-[2px]"
                            style={{ backgroundColor: data.color ?? '#5e6ad2' }}
                          />
                          <span className="flex-1 truncate">{m.name}</span>
                          {m.due_date ? (
                            <span
                              className="shrink-0 text-xs text-muted-foreground"
                              suppressHydrationWarning
                            >
                              {format(new Date(m.due_date), 'MMM d')}
                            </span>
                          ) : null}
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <ProgressRing pct={p} size={13} />
                            {d}/{t}
                          </span>
                        </Link>
                        <button
                          onClick={() => ws && createIssue.mutate(m.id)}
                          disabled={createIssue.isPending || !ws}
                          title="Add issue to milestone"
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 disabled:opacity-30"
                        >
                          <Plus size={13} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  No milestones in this project yet.
                </p>
              )}
            </section>

            {/* Issues */}
            <section className="mt-12">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-base font-medium">
                  Issues{' '}
                  <span className="font-normal text-muted-foreground">{total}</span>
                </h2>
                <div className="h-px flex-1 bg-border" />
                <button
                  onClick={() => ws && createIssue.mutate(null)}
                  disabled={createIssue.isPending || !ws}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={13} />
                  New issue
                </button>
              </div>
              {issues.data?.length ? (
                <ul>
                  {issues.data.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/dashboard/issues/${i.id}`}
                        prefetch={false}
                        className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-secondary/50"
                      >
                        <StatusIcon status={i.status} className="shrink-0" />
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {i.seq != null && ws ? `${ws.key}-${i.seq}` : `#${i.id}`}
                        </span>
                        <span className="flex-1 truncate">{i.title}</span>
                        {(i.assignees ?? []).slice(0, 2).map((a, idx) => (
                          <span key={a.id} style={{ marginLeft: idx > 0 ? '-4px' : 0 }}>
                            <MemberAvatar name={a.name} email={a.email} avatarUrl={a.avatar_url} size={18} className="shrink-0" />
                          </span>
                        ))}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  No issues in this project yet.
                </p>
              )}
            </section>

            {/* Activity */}
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-base font-medium">Activity</h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              <ActivityFeed
                entityType="project"
                entityId={projectId}
                wsSlug={ws?.slug ?? ''}
                commentsUrl={`/api/workspaces/${ws?.slug}/projects/${projectId}/comments`}
                commentsQueryKey={['project-comments', projectId, ws?.slug]}
                mentionItems={mentionItems}
                members={wsMembers.data}
              />
            </section>
          </div>
        </main>

        {/* Properties sidebar */}
        <aside className="w-full shrink-0 border-t border-border xl:w-72 xl:border-l xl:border-t-0">
          <div className="sticky top-12 px-4 py-5">
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Properties</p>

            <PropertySelect
              value={data.status}
              searchPlaceholder="Change status…"
              options={PROJECT_STATUSES.map((s) => ({
                value: s.value,
                label: s.label,
                icon: <StatusIcon status={s.value} />,
              }))}
              onChange={(v) => patch.mutate({ status: v })}
            />
            <PropertySelect
              value={data.priority ?? 'P4'}
              searchPlaceholder="Change priority…"
              options={PROJECT_PRIORITIES.map((p) => ({
                value: p.value,
                label: p.label,
                icon: <PriorityIcon priority={projectPriorityKey(p.value)} />,
              }))}
              onChange={(v) => patch.mutate({ priority: v })}
            />
            <PropertySelect
              value={data.owner_id ? String(data.owner_id) : ''}
              placeholder="Lead"
              searchPlaceholder="Set lead…"
              options={[
                { value: '', label: 'No lead' },
                ...(wsMembers.data ?? []).map((m) => ({
                  value: String(m.user_id),
                  label: m.name ?? m.email,
                  icon: (
                    <MemberAvatar
                      name={m.name}
                      email={m.email}
                      avatarUrl={m.avatar_url}
                      size={16}
                    />
                  ),
                })),
              ]}
              onChange={(v) => patch.mutate({ lead_user_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Members</p>
            <ul className="space-y-0.5">
              {(data.members ?? []).map((m) => (
                <li
                  key={m.user_id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
                >
                  <MemberAvatar
                    name={m.name}
                    email={m.email}
                    avatarUrl={m.avatar_url}
                    size={16}
                  />
                  <span className="flex-1 truncate">{m.name ?? m.email}</span>
                  <button
                    onClick={() =>
                      patch.mutate({
                        member_ids: (data.members ?? [])
                          .filter((x) => x.user_id !== m.user_id)
                          .map((x) => x.user_id),
                      })
                    }
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="Remove member"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
            {addableMembers.length > 0 ? (
              <PropertySelect
                value=""
                placeholder="Add member"
                searchPlaceholder="Add member…"
                buttonClassName="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                options={addableMembers.map((m) => ({
                  value: String(m.user_id),
                  label: m.name ?? m.email,
                  icon: (
                    <MemberAvatar
                      name={m.name}
                      email={m.email}
                      avatarUrl={m.avatar_url}
                      size={16}
                    />
                  ),
                }))}
                onChange={(v) => {
                  if (v) {
                    patch.mutate({
                      member_ids: [...(data.members ?? []).map((x) => x.user_id), parseInt(v)],
                    })
                  }
                }}
              />
            ) : (data.members ?? []).length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No members</p>
            ) : null}

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Start date</p>
            <DatePicker
              variant="inline"
              value={data.start_date ?? null}
              onChange={(v) => patch.mutate({ start_date: v })}
              placeholder="Set start date"
            />
            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Target date</p>
            <DatePicker
              variant="inline"
              value={data.end_date ?? null}
              onChange={(v) => patch.mutate({ end_date: v })}
              placeholder="Set target date"
            />

            <div className="my-4 h-px bg-border" />
            <div className="flex items-center gap-2.5 px-2 text-sm">
              <ProgressRing pct={pct} size={16} />
              <span className="text-muted-foreground">
                {done} of {total} issues done
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{pct}%</span>
            </div>
            {(milestones.data?.length ?? 0) > 0 ? (() => {
              const mTotal = milestones.data!.length
              const mDone = milestones.data!.filter((m) => m.status === 'done').length
              const mPct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0
              return (
                <div className="mt-1 flex items-center gap-2.5 px-2 text-[13px]">
                  <ProgressRing pct={mPct} size={16} />
                  <span className="text-muted-foreground">
                    {mDone} of {mTotal} milestones done
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{mPct}%</span>
                </div>
              )
            })() : null}
          </div>
        </aside>
      </div>

    </div>
  )
}
