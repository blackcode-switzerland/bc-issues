'use client'

// Workspace settings → Apps.
//
// One screen for the whole of Phase 4's UI surface: which apps this workspace
// runs, how each hands out access, and who has it. Deliberately not gold-plated —
// with one app in the suite most of this is a preview of what app #2 will need,
// and a screen built for three imaginary apps would be three guesses.
//
// Read-only for members: seeing that Ana has access and you don't is how a person
// works out what to ask for. Only owners see the controls.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Minus, Plus, ShieldCheck } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'

interface WorkspaceApp {
  slug: string
  name: string
  description: string | null
  globally_enabled: boolean
  enabled: boolean
  default_access: 'all_members' | 'invite_only' | null
  access_count: number
}

interface AccessMember {
  user_id: number
  email: string
  name: string | null
  member_role: string
  has_access: boolean
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // The API's `suggestion` is the actionable half of a refusal — the same string
    // the CLI prints as `hint:`. Dropping it here would make the web UI the one
    // surface that tells you "no" without telling you what to do.
    throw new Error(
      [body.error ?? 'Request failed', body.suggestion].filter(Boolean).join(' — ')
    )
  }
  return body as T
}

export function WorkspaceAppsPanel({
  slug,
  isOwner,
  currentApp,
}: {
  slug: string
  isOwner: boolean
  /** The app serving this page. It cannot disable itself — see the route. */
  currentApp: string
}) {
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const [expanded, setExpanded] = useState<string | null>(currentApp)

  const { data: apps, isLoading } = useQuery({
    queryKey: ['workspace-apps', slug],
    queryFn: async () =>
      (await json<{ data: WorkspaceApp[] }>(await fetch(`/api/workspaces/${slug}/apps`))).data,
  })

  const patchApp = useMutation({
    mutationFn: async ({ app, body }: { app: string; body: Record<string, unknown> }) =>
      json(
        await fetch(`/api/workspaces/${slug}/apps/${app}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ),
    onSuccess: () => {
      toast.success('App settings updated')
      queryClient.invalidateQueries({ queryKey: ['workspace-apps', slug] })
      queryClient.invalidateQueries({ queryKey: ['app-access', slug] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> Loading apps…
      </p>
    )
  }

  if (!apps?.length) {
    return <p className="text-sm text-muted-foreground">No apps are registered on this platform.</p>
  }

  return (
    <div className="space-y-3">
      {apps.map((app) => (
        <div key={app.slug} className="rounded-lg border border-border">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {app.name}
                {app.slug === currentApp ? (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                    you are here
                  </span>
                ) : null}
              </p>
              {app.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{app.description}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {app.enabled
                  ? `${app.access_count} member${app.access_count === 1 ? '' : 's'} with access`
                  : 'Not enabled for this workspace'}
              </p>
            </div>

            {isOwner ? (
              <div className="flex shrink-0 items-center gap-2">
                {app.enabled ? (
                  <select
                    value={app.default_access ?? 'all_members'}
                    disabled={patchApp.isPending}
                    onChange={(e) =>
                      patchApp.mutate({ app: app.slug, body: { default_access: e.target.value } })
                    }
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="all_members">Everyone in the workspace</option>
                    <option value="invite_only">Only people I grant</option>
                  </select>
                ) : null}
                {/* An app cannot be disabled from inside itself: it would revoke
                    every member's access to the app serving the request, this
                    route included, with no way back. The server refuses too. */}
                {app.slug === currentApp ? null : app.enabled ? (
                  <button
                    type="button"
                    disabled={patchApp.isPending}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Disable ${app.name}?`,
                          description:
                            'Every member loses access to it in this workspace. Their data is kept; access can be granted again by re-enabling.',
                          destructive: true,
                          confirmLabel: 'Disable',
                        }))
                      )
                        return
                      patchApp.mutate({ app: app.slug, body: { enabled: false } })
                    }}
                    className="cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={patchApp.isPending || !app.globally_enabled}
                    onClick={() => patchApp.mutate({ app: app.slug, body: { enabled: true } })}
                    className="cursor-pointer rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
                  >
                    Enable
                  </button>
                )}
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {app.enabled
                  ? app.default_access === 'invite_only'
                    ? 'Invite only'
                    : 'Open to members'
                  : 'Off'}
              </span>
            )}
          </div>

          {app.enabled ? (
            <div className="border-t border-border px-4 py-2">
              <button
                type="button"
                onClick={() => setExpanded(expanded === app.slug ? null : app.slug)}
                className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
              >
                {expanded === app.slug ? 'Hide' : 'Show'} who has access
              </button>
              {expanded === app.slug ? (
                <AppAccessList slug={slug} app={app.slug} isOwner={isOwner} />
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function AppAccessList({
  slug,
  app,
  isOwner,
}: {
  slug: string
  app: string
  isOwner: boolean
}) {
  const queryClient = useQueryClient()
  const { data: members, isLoading } = useQuery({
    queryKey: ['app-access', slug, app],
    queryFn: async () =>
      (
        await json<{ data: AccessMember[] }>(
          await fetch(`/api/workspaces/${slug}/apps/${app}/access`)
        )
      ).data,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['app-access', slug, app] })
    queryClient.invalidateQueries({ queryKey: ['workspace-apps', slug] })
  }

  const grant = useMutation({
    mutationFn: async (userId: number) =>
      json(
        await fetch(`/api/workspaces/${slug}/apps/${app}/access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        })
      ),
    onSuccess: () => {
      toast.success('Access granted')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revoke = useMutation({
    mutationFn: async (userId: number) =>
      json(
        await fetch(`/api/workspaces/${slug}/apps/${app}/access/${userId}`, { method: 'DELETE' })
      ),
    onSuccess: () => {
      toast.success('Access revoked')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        <Loader2 size={13} className="inline animate-spin" /> Loading…
      </p>
    )
  }

  const busy = grant.isPending || revoke.isPending

  return (
    <ul className="mt-2 divide-y divide-border">
      {(members ?? []).map((m) => (
        <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-sm">
            {m.name ?? m.email}
            {m.member_role === 'owner' ? (
              <span className="ml-2 text-xs text-muted-foreground">owner</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {m.has_access ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck size={13} /> access
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no access</span>
            )}
            {isOwner && m.member_role !== 'owner' ? (
              m.has_access ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke.mutate(m.user_id)}
                  className="cursor-pointer inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                >
                  <Minus size={11} /> Revoke
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => grant.mutate(m.user_id)}
                  className="cursor-pointer inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-50"
                >
                  <Plus size={11} /> Grant
                </button>
              )
            ) : null}
          </span>
        </li>
      ))}
      {(members ?? []).length === 0 ? (
        <li className="py-2 text-sm text-muted-foreground">No members.</li>
      ) : null}
    </ul>
  )
}
