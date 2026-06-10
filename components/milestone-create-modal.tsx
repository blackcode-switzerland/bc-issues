'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { Modal } from './ui/modal'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { PropertySelect } from '@/components/ui/property-select'
import { DatePicker } from '@/components/ui/date-picker'
import { RichTextEditor, type MentionItem } from './rich-text-editor'

const CHIP_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs hover:bg-secondary'

interface Project {
  id: number
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Prefill the project (e.g. opening from a project page). */
  defaultProjectId?: number | null
  onCreated?: (milestone: { id: number }) => void
}

export function MilestoneCreateModal({ open, onClose, defaultProjectId, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState<string>(defaultProjectId ? String(defaultProjectId) : '')
  const [dueDate, setDueDate] = useState('')

  const projects = useQuery({
    queryKey: ['ws-projects', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Array<{ user_id: number; name: string | null; email: string; avatar_url: string | null }>
    },
  })

  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  function reset() {
    setName('')
    setDescription('')
    setProjectId(defaultProjectId ? String(defaultProjectId) : '')
    setDueDate('')
  }

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        project_id: projectId ? parseInt(projectId) : null,
      }
      if (dueDate) body.due_date = dueDate
      if (description.replace(/<[^>]*>/g, '').trim()) body.description = description
      const res = await fetch(`/api/workspaces/${ws!.slug}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create milestone')
      }
      return res.json() as Promise<{ id: number; name: string }>
    },
    onSuccess: (milestone) => {
      toast.success(`Created ${milestone.name}`)
      queryClient.invalidateQueries({ queryKey: ['ws-milestones-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-milestones'] })
      reset()
      onCreated?.(milestone)
      onClose()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Milestone name is required')
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
          <span className="text-xs text-muted-foreground">New milestone</span>
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Milestone name"
          className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/60"
        />

        {/* description */}
        <div className="mt-3">
          <RichTextEditor
            content={description}
            onChange={setDescription}
            placeholder="Add description… type @ to mention someone"
            variant="bordered"
            minHeight="100px"
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
        </div>

        {/* property chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PropertySelect
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: '', label: 'No project (standalone)' },
              ...(projects.data ?? []).map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            placeholder="Project"
            searchPlaceholder="Set project…"
            buttonClassName={CHIP_BUTTON}
          />
          <DatePicker variant="chip" label="Target" align="right" value={dueDate || null} onChange={(v) => setDueDate(v ?? '')} />
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
            Create milestone
          </button>
        </div>
      </form>
    </Modal>
  )
}
