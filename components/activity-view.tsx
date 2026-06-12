'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  Activity as ActivityIcon,
  CheckCircle2,
  Edit3,
  MessageSquare,
  Pencil,
  Plus,
  Tag,
  Trash2,
  User,
  UserPlus,
  Users,
} from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { FilterBar, MultiSelect, SearchInput } from './listings/filter-bar'
import { MemberAvatar } from '@/components/ui/member-avatar'

interface EventRow {
  id: number
  actor_user_id: number | null
  actor_name: string | null
  actor_email: string | null
  entity_type: string
  entity_id: number
  action: string
  diff: Record<string, unknown> | null
  meta: Record<string, unknown> | null
  occurred_at: string
}

const ENTITY_TYPES = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'workspace_member', label: 'Members' },
  { value: 'invitation', label: 'Invitations' },
  { value: 'project', label: 'Projects' },
  { value: 'milestone', label: 'Milestones' },
  { value: 'issue', label: 'Issues' },
  { value: 'comment', label: 'Comments' },
  { value: 'attachment', label: 'Attachments' },
  { value: 'label', label: 'Labels' },
]

const ACTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'status_changed', label: 'Status changed' },
  { value: 'priority_changed', label: 'Priority changed' },
  { value: 'milestone_changed', label: 'Milestone changed' },
  { value: 'project_changed', label: 'Project changed' },
  { value: 'labeled', label: 'Labeled' },
  { value: 'unlabeled', label: 'Unlabeled' },
  { value: 'commented', label: 'Commented' },
  { value: 'member_added', label: 'Member added' },
  { value: 'member_removed', label: 'Member removed' },
  { value: 'invitation_created', label: 'Invitation sent' },
  { value: 'invitation_accepted', label: 'Invitation accepted' },
  { value: 'invitation_revoked', label: 'Invitation revoked' },
  { value: 'ownership_transferred', label: 'Ownership transferred' },
]

const ICONS: Record<string, React.ReactNode> = {
  created: <Plus size={14} className="text-muted-foreground" />,
  updated: <Pencil size={14} className="text-muted-foreground" />,
  deleted: <Trash2 size={14} className="text-muted-foreground" />,
  assigned: <User size={14} className="text-muted-foreground" />,
  unassigned: <User size={14} className="text-muted-foreground" />,
  status_changed: <CheckCircle2 size={14} className="text-muted-foreground" />,
  commented: <MessageSquare size={14} className="text-muted-foreground" />,
  labeled: <Tag size={14} className="text-muted-foreground" />,
  unlabeled: <Tag size={14} className="text-muted-foreground" />,
  member_added: <UserPlus size={14} className="text-muted-foreground" />,
  member_removed: <Users size={14} className="text-muted-foreground" />,
  invitation_created: <UserPlus size={14} className="text-muted-foreground" />,
  invitation_accepted: <UserPlus size={14} className="text-muted-foreground" />,
}

export function ActivityView() {
  const { data: ws } = useActiveWorkspace()
  const [search, setSearch] = useState('')
  const [entityTypes, setEntityTypes] = useState<Array<string | number>>([])
  const [actions, setActions] = useState<Array<string | number>>([])
  const [actors, setActors] = useState<Array<string | number>>([])

  const members = useQuery({
    queryKey: ['ws-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Array<{ user_id: number; email: string; name: string | null; avatar_url: string | null }>
    },
  })

  const events = useQuery({
    queryKey: ['ws-activity', ws?.slug, { entityTypes, actions, actors }],
    enabled: !!ws,
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('limit', '200')
      if (entityTypes.length > 0) params.set('entity_type', entityTypes.join(','))
      if (actions.length > 0) params.set('action', actions.join(','))
      if (actors.length > 0) params.set('actor', actors.join(','))
      const res = await fetch(`/api/workspaces/${ws!.slug}/activity?${params}`)
      if (!res.ok) throw new Error('failed')
      const j = await res.json()
      return j.data as EventRow[]
    },
  })

  const filtered = useMemo(() => {
    let data = events.data ?? []
    if (search) {
      const needle = search.toLowerCase()
      data = data.filter((e) => JSON.stringify(e.meta).toLowerCase().includes(needle))
    }
    return data
  }, [events.data, search])

  // Group by day
  const grouped = useMemo(() => {
    const map = new Map<string, EventRow[]>()
    for (const e of filtered) {
      const day = format(new Date(e.occurred_at), 'yyyy-MM-dd')
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-sm font-semibold">Activity</h1>
        <span className="text-xs text-muted-foreground">{ws?.name ?? '…'}</span>
      </header>

      <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search in metadata…" />
        <FilterBar>
          <MultiSelect
            label="Entity"
            options={ENTITY_TYPES}
            selected={entityTypes}
            onChange={setEntityTypes}
          />
          <MultiSelect label="Action" options={ACTIONS} selected={actions} onChange={setActions} />
          <MultiSelect
            label="Actor"
            options={(members.data ?? []).map((m) => ({
              value: m.user_id,
              label: m.name ?? m.email,
              icon: <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={14} />,
            }))}
            selected={actors}
            onChange={setActors}
          />
        </FilterBar>
      </div>

      {events.isLoading ? (
        <p className="px-6 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
          <ActivityIcon size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No activity matches your filters.</p>
        </div>
      ) : (
        <div>
          {grouped.map(([day, rows]) => (
            <section key={day}>
              <h2 className="bg-secondary/30 px-6 py-1.5 text-[11px] text-muted-foreground">
                {format(new Date(day), 'EEEE, MMMM d')}
              </h2>
              <ul>
                {rows.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 border-b border-border/40 px-6 py-2.5 transition-colors hover:bg-secondary/40"
                  >
                    <span className="mt-0.5 shrink-0">{ICONS[e.action] ?? <Edit3 size={14} className="text-muted-foreground" />}</span>
                    {(() => {
                      const member = members.data?.find((m) => m.user_id === e.actor_user_id)
                      return e.actor_user_id ? (
                        <MemberAvatar
                          name={member?.name ?? e.actor_name}
                          email={member?.email ?? e.actor_email}
                          avatarUrl={member?.avatar_url ?? null}
                          size={22}
                          className="mt-0.5 shrink-0"
                        />
                      ) : null
                    })()}
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-medium">
                        {e.actor_name ?? e.actor_email ?? 'system'}
                      </span>{' '}
                      <span className="text-sm text-muted-foreground">{describe(e)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                      {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function describe(e: EventRow): string {
  const meta = (e.meta ?? {}) as Record<string, string | number | null | undefined>
  const entityRef = e.entity_type === 'issue' && meta.seq
    ? `${e.entity_type} ${meta.seq}`
    : e.entity_type
  switch (e.action) {
    case 'created':
      return `created ${entityRef}${meta.title ? `: ${meta.title}` : ''}`
    case 'updated':
      return `updated ${entityRef}`
    case 'deleted':
      return `deleted ${entityRef}`
    case 'assigned':
      return `assigned ${entityRef}${meta.title ? ` "${meta.title}"` : ''}`
    case 'unassigned':
      return `unassigned ${entityRef}`
    case 'status_changed':
      return `moved ${entityRef} ${meta.from} → ${meta.to}`
    case 'priority_changed':
      return `changed priority of ${entityRef}`
    case 'milestone_changed':
      return `re-milestoned ${entityRef}`
    case 'project_changed':
      return `moved ${entityRef} between projects`
    case 'labeled':
      return `labeled ${entityRef}${meta.label_name ? ` with "${meta.label_name}"` : ''}`
    case 'unlabeled':
      return `removed label${meta.label_name ? ` "${meta.label_name}"` : ''} from ${entityRef}`
    case 'commented':
      return `commented on ${entityRef}${meta.excerpt ? `: "${meta.excerpt}"` : ''}`
    case 'member_added':
      return `joined as member`
    case 'member_removed':
      return `removed a member`
    case 'invitation_created':
      return `invited ${meta.email ?? 'someone'}`
    case 'invitation_accepted':
      return `accepted invitation`
    case 'invitation_revoked':
      return `revoked invitation`
    case 'ownership_transferred':
      return `transferred ownership`
    default:
      return `${e.action} ${entityRef}`
  }
}
