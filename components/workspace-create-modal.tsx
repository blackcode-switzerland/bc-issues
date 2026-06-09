'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from './ui/modal'
import { ImageUploadField } from './image-upload-field'

interface Props {
  open: boolean
  onClose: () => void
  /** Prefill the name (e.g. "Bala's Workspace"). */
  defaultName?: string
  /** Called with the created workspace after it's set active. */
  onCreated?: (ws: { id: number; slug: string; key: string; name: string }) => void
  /** When false, hides Cancel/close (e.g. onboarding where a workspace is required). */
  dismissible?: boolean
}

// Reusable "create workspace" modal — name + square logo. Used by the sidebar
// switcher and the onboarding screen for consistency.
export function WorkspaceCreateModal({
  open,
  onClose,
  defaultName = '',
  onCreated,
  dismissible = true,
}: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState(defaultName)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Keep the field seeded if defaultName changes while closed.
  if (!open && name !== defaultName && name === '') {
    setName(defaultName)
  }

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
      setName('')
      setLogoUrl(null)
      onCreated?.(ws)
      onClose()
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      title="Create workspace"
      description="A workspace holds your projects, milestones, issues, and team."
    >
      <form onSubmit={create} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium">Logo</label>
          <ImageUploadField
            value={logoUrl}
            onChange={setLogoUrl}
            fallbackText={name || 'W'}
          />
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
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
            >
              Cancel
            </button>
          ) : null}
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
    </Modal>
  )
}
