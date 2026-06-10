'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { Modal } from './ui/modal'
import { MultiSelect } from './listings/filter-bar'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/work-items'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@/components/ui/member-avatar'
import { PropertySelect } from '@/components/ui/property-select'
import { RichTextEditor, type MentionItem } from './rich-text-editor'
import { DatePicker } from '@/components/ui/date-picker'

const CHIP_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs hover:bg-secondary'

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}
interface Project {
  id: number
  name: string
}
interface Milestone {
  id: number
  name: string
  project_id: number | null
}
interface LabelRow {
  id: number
  name: string
  color: string
}

interface Props {
  open: boolean
  onClose: () => void
  defaultProjectId?: number | null
  defaultMilestoneId?: number | null
  onCreated?: (issue: { id: number }) => void
}

export function IssueCreateModal({
  open,
  onClose,
  defaultProjectId,
  defaultMilestoneId,
  onCreated,
}: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('backlog')
  const [priority, setPriority] = useState(5)
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ? String(defaultProjectId) : '')
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId ? String(defaultMilestoneId) : '')
  const [labelIds, setLabelIds] = useState<Array<string | number>>([])
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    if (open) {
      setProjectId(defaultProjectId ? String(defaultProjectId) : '')
      setMilestoneId(defaultMilestoneId ? String(defaultMilestoneId) : '')
    }
  }, [open, defaultProjectId, defaultMilestoneId])

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const milestones = useQuery({
    queryKey: ['ws-milestones', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Milestone[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })
  const labelList = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<LabelRow[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!res.ok) return []
      return (await res.json()).data
    },
  })

  const filteredMilestones = (milestones.data ?? []).filter(
    (m) => !projectId || m.project_id === parseInt(projectId) || m.project_id == null
  )

  function reset() {
    setTitle('')
    setDescription('')
    setStatus('backlog')
    setPriority(5)
    setAssigneeId('')
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
    setMilestoneId(defaultMilestoneId ? String(defaultMilestoneId) : '')
    setLabelIds([])
    setDueDate('')
  }

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: title.trim(),
        status,
        priority,
      }
      if (description.replace(/<[^>]*>/g, '').trim()) body.description = description
      if (assigneeId) body.assignee_id = parseInt(assigneeId)
      if (projectId) body.project_id = parseInt(projectId)
      if (milestoneId) body.milestone_id = parseInt(milestoneId)
      if (labelIds.length) body.label_ids = labelIds.map((v) => Number(v))
      if (dueDate) body.due_date = dueDate
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create issue')
      }
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (issue) => {
      toast.success(`Created ${ws?.key}-${issue.seq ?? issue.id}`)
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      reset()
      onCreated?.(issue)
      onClose()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) {
            toast.error('Title is required')
            return
          }
          create.mutate()
        }}
      >
        {/* breadcrumb header */}
        <div className="mb-3 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {ws?.name ?? 'Workspace'}
          </span>
          <ChevronRight size={12} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">New issue</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X size={15} />
          </button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Issue title"
          className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/60"
        />
        <RichTextEditor
          content={description}
          onChange={setDescription}
          placeholder="Add description… type @ to mention someone"
          variant="bordered"
          minHeight="120px"
          mentionItems={mentionItems}
          onImageUpload={async (file) => {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            if (!res.ok) throw new Error('upload failed')
            const j = await res.json()
            return j.url
          }}
        />

        {/* property chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PropertySelect
            value={status}
            onChange={setStatus}
            options={ISSUE_STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
              icon: <StatusIcon status={s.value} size={14} />,
            }))}
            placeholder="Status"
            searchPlaceholder="Change status…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={String(priority)}
            onChange={(v) => setPriority(parseInt(v))}
            options={ISSUE_PRIORITIES.map((p) => ({
              value: String(p.value),
              label: p.label,
              icon: <PriorityIcon priority={issuePriorityKey(p.value)} size={14} />,
            }))}
            placeholder="Priority"
            searchPlaceholder="Change priority…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={assigneeId}
            onChange={setAssigneeId}
            options={[
              { value: '', label: 'Unassigned' },
              ...(members.data ?? []).map((m) => ({
                value: String(m.user_id),
                label: m.name ?? m.email,
                icon: <MemberAvatar name={m.name} email={m.email} size={16} />,
              })),
            ]}
            placeholder="Assignee"
            searchPlaceholder="Assign to…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={projectId}
            onChange={(v) => {
              setProjectId(v)
              if (v && milestoneId) {
                const m = (milestones.data ?? []).find((x) => x.id === parseInt(milestoneId))
                if (m && m.project_id != null && m.project_id !== parseInt(v)) {
                  setMilestoneId('')
                }
              }
            }}
            options={[
              { value: '', label: 'No project' },
              ...(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            placeholder="Project"
            searchPlaceholder="Move to project…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={milestoneId}
            onChange={setMilestoneId}
            options={[
              { value: '', label: 'No milestone' },
              ...filteredMilestones.map((m) => ({ value: String(m.id), label: m.name })),
            ]}
            placeholder="Milestone"
            searchPlaceholder="Set milestone…"
            buttonClassName={CHIP_BUTTON}
          />
          <MultiSelect
            label="Add labels"
            options={(labelList.data ?? []).map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            selected={labelIds}
            onChange={setLabelIds}
          />
          <DatePicker
            variant="chip"
            label="Due"
            align="right"
            value={dueDate || null}
            onChange={(v) => setDueDate(v ?? '')}
          />
        </div>

        {/* footer */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Create issue
          </button>
        </div>
      </form>
    </Modal>
  )
}
