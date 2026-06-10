'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Save, Trash2, Upload } from 'lucide-react'

interface Me {
  id: number
  email: string
  name: string | null
  tagline: string | null
  avatar_url: string | null
  active_workspace_id: number | null
  connected_google: boolean
  avatar_editable: boolean
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

export function ProfileSettingsView() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
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
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (data) {
      setName(data.name ?? '')
      setTagline(data.tagline ?? '')
    }
  }, [data])

  const save = useMutation({
    mutationFn: async (patch: Record<string, string | null>) => {
      const res = await fetch('/api/me', {
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
      queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.success('Profile updated')
    },
    onError: () => toast.error('Could not update profile'),
  })

  const setAvatar = useMutation({
    mutationFn: async (avatar_url: string | null) => {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      queryClient.invalidateQueries({ queryKey: ['active-workspace'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Please choose a JPG, PNG, GIF, or WebP image')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be 5MB or smaller')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed')
      await setAvatar.mutateAsync(j.url)
      toast.success('Photo updated')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const initials = (data?.name?.trim()?.[0] ?? data?.email?.[0] ?? '?').toUpperCase()

  return (
    <section className="rounded-lg border border-border bg-card/30 p-5">
      <h2 className="mb-3 text-sm font-medium">Profile</h2>
      <p className="mb-5 text-xs text-muted-foreground">
        How you appear to teammates across all your workspaces.
      </p>

      {/* Avatar */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-full border border-border bg-primary/10">
          {data?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatar_url} alt="Your avatar" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xl font-medium text-primary">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0">
          {data?.avatar_editable === false ? (
            <p className="text-xs text-muted-foreground">
              Your photo is synced from your Google account and can&apos;t be changed here.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED.join(',')}
                onChange={onPickFile}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || setAvatar.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {data?.avatar_url ? 'Change photo' : 'Upload photo'}
              </button>
              {data?.avatar_url ? (
                <button
                  onClick={() => setAvatar.mutate(null)}
                  disabled={uploading || setAvatar.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  Remove
                </button>
              ) : null}
              <p className="w-full text-[11px] text-muted-foreground">
                JPG, PNG, GIF, or WebP. Max 5MB. Square images look best.
              </p>
            </div>
          )}
        </div>
      </div>

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
        <button
          onClick={() => save.mutate({ name: name || null, tagline: tagline || null })}
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
