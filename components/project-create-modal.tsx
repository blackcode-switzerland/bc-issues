'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { Modal } from './ui/modal'
import { IconPicker } from './icon-picker'
import { MultiSelect } from './listings/filter-bar'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '@/lib/work-items'
import { StatusIcon, PriorityIcon, projectPriorityKey } from '@/components/ui/work-item-icons'
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
interface LabelRow {
  id: number
  name: string
  color: string
}

const STATUSES = PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const PRIORITIES = PROJECT_PRIORITIES

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (project: { id: number }) => void
}

export function ProjectCreateModal({ open, onClose, onCreated }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('backlog')
  const [priority, setPriority] = useState('P4')
  const [leadId, setLeadId] = useState('')
  const [memberIds, setMemberIds] = useState<Array<string | number>>([])
  const [labelIds, setLabelIds] = useState<Array<string | number>>([])
  const [icon, setIcon] = useState<string | null>('Folder')
  const [color, setColor] = useState('#5e6ad2')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })
  const labelList = useQuery({
    queryKey: ['ws-labels', ws?.slug],
    enabled: !!ws && open,
    queryFn: async (): Promise<LabelRow[]> => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/labels`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  function reset() {
    setName('')
    setDescription('')
    setStatus('backlog')
    setPriority('P4')
    setLeadId('')
    setMemberIds([])
    setLabelIds([])
    setIcon('Folder')
    setColor('#5e6ad2')
    setStartDate('')
    setEndDate('')
  }

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        status,
        priority,
        icon,
        color,
      }
      if (description.replace(/<[^>]*>/g, '').trim()) body.description = description
      if (leadId) body.lead_user_id = parseInt(leadId)
      if (memberIds.length) body.member_ids = memberIds.map((v) => Number(v))
      if (labelIds.length) body.label_ids = labelIds.map((v) => Number(v))
      if (startDate) body.start_date = startDate
      if (endDate) body.end_date = endDate
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create project')
      }
      return res.json() as Promise<{ id: number; name: string }>
    },
    onSuccess: (project) => {
      toast.success(`Created ${project.name}`)
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects'] })
      reset()
      onCreated?.(project)
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
          if (!name.trim()) {
            toast.error('Project name is required')
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
          <span className="text-xs text-muted-foreground">New project</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X size={15} />
          </button>
        </div>

        {/* icon + name row */}
        <div className="flex items-center gap-2">
          <IconPicker
            icon={icon}
            color={color}
            name={name}
            onChange={(v) => {
              setIcon(v.icon)
              setColor(v.color)
            }}
          />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Project name"
            className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="mt-1">
          <RichTextEditor
            content={description}
            onChange={setDescription}
            placeholder="What is this project about? Type @ to mention someone"
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
        </div>

        {/* property chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PropertySelect
            value={status}
            onChange={setStatus}
            options={STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
              icon: <StatusIcon status={s.value} size={14} />,
            }))}
            placeholder="Status"
            searchPlaceholder="Change status…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={priority}
            onChange={setPriority}
            options={PRIORITIES.map((p) => ({
              value: p.value,
              label: p.label,
              icon: <PriorityIcon priority={projectPriorityKey(p.value)} size={14} />,
            }))}
            placeholder="Priority"
            searchPlaceholder="Change priority…"
            buttonClassName={CHIP_BUTTON}
          />
          <PropertySelect
            value={leadId}
            onChange={setLeadId}
            options={[
              { value: '', label: 'You' },
              ...(members.data ?? []).map((m) => ({
                value: String(m.user_id),
                label: m.name ?? m.email,
                icon: <MemberAvatar name={m.name} email={m.email} size={16} />,
              })),
            ]}
            placeholder="Lead"
            searchPlaceholder="Set lead…"
            buttonClassName={CHIP_BUTTON}
          />
          <MultiSelect
            label="Add members"
            options={(members.data ?? []).map((m) => ({
              value: m.user_id,
              label: m.name ?? m.email,
            }))}
            selected={memberIds}
            onChange={setMemberIds}
          />
          <MultiSelect
            label="Add labels"
            options={(labelList.data ?? []).map((l) => ({
              value: l.id,
              label: l.name,
              color: l.color,
            }))}
            selected={labelIds}
            onChange={setLabelIds}
          />
          <DatePicker
            variant="chip"
            label="Start"
            align="right"
            value={startDate || null}
            onChange={(v) => setStartDate(v ?? '')}
          />
          <DatePicker
            variant="chip"
            label="Target"
            align="right"
            value={endDate || null}
            onChange={(v) => setEndDate(v ?? '')}
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
            Create project
          </button>
        </div>
      </form>
    </Modal>
  )
}
