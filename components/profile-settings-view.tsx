'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'

interface Me {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  active_workspace_id: number | null
}

export function ProfileSettingsView() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me> => {
      const res = await fetch('/api/me')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')

  useEffect(() => {
    if (data) {
      setName(data.name ?? '')
      setTagline(data.tagline ?? '')
      setAvatarUrl(data.avatar_url ?? '')
    }
  }, [data])

  const save = useMutation({
    mutationFn: async (patch: Record<string, string | null>) => {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Profile updated')
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: () => toast.error('Failed to update'),
  })

  return (
    <section className="rounded-lg border border-border bg-card/30 p-5">
      <h2 className="mb-3 text-sm font-medium">Profile</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        How you appear to teammates across all your workspaces.
      </p>
      <div className="space-y-4">
        <Field label="Email" hint="Read-only.">
          <input
            value={data?.email ?? ''}
            disabled
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
          />
        </Field>
        <Field label="Display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="Tagline" hint="A short line that shows on your member profile. Max 140 chars.">
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            maxLength={140}
            placeholder="What you're focused on this quarter"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="Avatar URL" hint="Public URL to a square image. Leave blank for initials.">
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <button
          onClick={() =>
            save.mutate({
              name: name || null,
              tagline: tagline || null,
              avatar_url: avatarUrl || null,
            })
          }
          disabled={save.isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save size={14} />
          Save profile
        </button>
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
