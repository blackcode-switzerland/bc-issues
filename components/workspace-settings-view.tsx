'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Crown, Save, Trash2 } from 'lucide-react'

interface Workspace {
  id: number
  name: string
  slug: string
  key: string
  logo_url: string | null
  owner_id: number
  member_role: 'owner' | 'member'
}

interface Member {
  user_id: number
  email: string
  name: string | null
  role: 'owner' | 'member'
}

async function fetchActiveWorkspace(): Promise<Workspace | null> {
  const meRes = await fetch('/api/me')
  if (!meRes.ok) return null
  const me = await meRes.json()
  if (!me.active_workspace_id) return null
  const wsRes = await fetch('/api/me/workspaces')
  if (!wsRes.ok) return null
  const { data } = await wsRes.json()
  return (data as Workspace[]).find((w) => w.id === me.active_workspace_id) ?? null
}

export function WorkspaceSettingsView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useQuery({ queryKey: ['active-workspace'], queryFn: fetchActiveWorkspace })

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [logoUrl, setLogoUrl] = useState('')

  useEffect(() => {
    if (ws) {
      setName(ws.name)
      setKey(ws.key)
      setLogoUrl(ws.logo_url ?? '')
    }
  }, [ws])

  const { data: members } = useQuery({
    queryKey: ['workspace-members', ws?.slug],
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data as Member[]
    },
  })

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Workspace updated')
      queryClient.invalidateQueries({ queryKey: ['active-workspace'] })
      queryClient.invalidateQueries({ queryKey: ['me-workspaces'] })
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const transfer = useMutation({
    mutationFn: async (newOwnerId: number) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_owner_user_id: newOwnerId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Ownership transferred')
      queryClient.invalidateQueries()
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      toast.success('Workspace deleted')
      queryClient.invalidateQueries()
      router.push('/dashboard')
      router.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!ws) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">No active workspace.</p>
      </div>
    )
  }

  const isOwner = ws.member_role === 'owner'
  const otherMembers = (members ?? []).filter((m) => m.user_id !== ws.owner_id)

  return (
    <div className="mx-auto max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Workspace settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isOwner ? `You own ${ws.name}.` : `You are a member of ${ws.name}.`}
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-border bg-card/30 p-5">
        <h2 className="mb-4 text-sm font-medium">General</h2>
        <div className="space-y-4">
          <Field label="Name" hint="Displayed across the app." disabled={!isOwner}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={!isOwner}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </Field>
          <Field
            label="Key"
            hint="3–6 letters, used as the prefix on issue ids (e.g. ACME-42)."
            disabled={!isOwner}
          >
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              maxLength={6}
              disabled={!isOwner}
              className="w-32 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </Field>
          <Field label="Logo URL" hint="Optional. Public URL to a square image." disabled={!isOwner}>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              disabled={!isOwner}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </Field>
          {isOwner ? (
            <button
              type="button"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ name, key, logo_url: logoUrl || null })
              }
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save size={14} />
              Save changes
            </button>
          ) : null}
        </div>
      </section>

      {isOwner && otherMembers.length > 0 ? (
        <section className="mb-8 rounded-lg border border-border bg-card/30 p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Crown size={14} className="text-amber-400" />
            Transfer ownership
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            The current owner will become a regular member after transfer.
          </p>
          <select
            onChange={(e) => {
              const v = parseInt(e.target.value)
              if (!Number.isNaN(v) && confirm('Transfer ownership? This cannot be undone without the new owner cooperating.')) {
                transfer.mutate(v)
              }
              e.currentTarget.value = ''
            }}
            defaultValue=""
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Pick a new owner…
            </option>
            {otherMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {isOwner ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle size={14} />
            Danger zone
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Deleting a workspace removes all of its projects, milestones, issues, comments, attachments, labels,
            members, and history. This cannot be undone.
          </p>
          <button
            onClick={() => {
              const phrase = prompt(`Type "${ws.name}" to confirm deletion`)
              if (phrase === ws.name) remove.mutate()
              else if (phrase !== null) toast.error('Name did not match — cancelled')
            }}
            className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            <Trash2 size={14} />
            Delete workspace
          </button>
        </section>
      ) : null}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  disabled,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div>
      <label className={`mb-1 block text-xs font-medium ${disabled ? 'text-muted-foreground' : ''}`}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
