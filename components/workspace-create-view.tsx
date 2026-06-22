'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { ImageUploadField } from './image-upload-field'

// Full-page "create workspace" form. Mirrors the workspaces listing layout for a
// consistent feel; on success it switches to the new workspace and opens it.
export function WorkspaceCreateView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Enter a workspace name')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, logo_url: logoUrl }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Could not create workspace')
      }
      const ws = await res.json()
      await fetch('/api/me/active-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws.id }),
      })
      toast.success(`Created ${ws.name}`)
      await queryClient.invalidateQueries()
      router.push(`/dashboard/${ws.slug}`)
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <Link
          href="/dashboard/workspaces"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Workspaces
        </Link>
        <h1 className="text-2xl font-semibold">Create workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A workspace holds your projects, tasks, issues, and team.
        </p>
      </header>

      <form onSubmit={create} className="space-y-5 rounded-lg border border-border p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium">Logo</label>
          <ImageUploadField value={logoUrl} onChange={setLogoUrl} fallbackText={name || 'W'} />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Square image works best. Optional — we&apos;ll use the first letter otherwise.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Acme Inc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Link
            href="/dashboard/workspaces"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Create workspace
          </button>
        </div>
      </form>
    </div>
  )
}
