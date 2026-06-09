'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from './ui/modal'
import { IconPicker } from './icon-picker'
import { MultiSelect } from './listings/filter-bar'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '@/lib/work-items'

interface Member {
  user_id: number
  email: string
  name: string | null
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
  const [color, setColor] = useState('#3b82f6')
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
    setColor('#3b82f6')
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
      if (description.trim()) body.description = description.trim()
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

  return (
    <Modal open={open} onClose={onClose} title="New project" widthClass="max-w-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) {
            toast.error('Project name is required')
            return
          }
          create.mutate()
        }}
        className="space-y-4"
      >
        {/* icon + name row */}
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Icon</label>
            <IconPicker
              icon={icon}
              color={color}
              name={name}
              onChange={(v) => {
                setIcon(v.icon)
                setColor(v.color)
              }}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Frontend Redesign"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this project about?"
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lead">
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">You</option>
              {(members.data ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          </Field>
          <div />
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Target date">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Members">
            <MultiSelect
              label="Add members"
              options={(members.data ?? []).map((m) => ({
                value: m.user_id,
                label: m.name ?? m.email,
              }))}
              selected={memberIds}
              onChange={setMemberIds}
            />
          </Field>
          <Field label="Labels">
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
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Create project
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
