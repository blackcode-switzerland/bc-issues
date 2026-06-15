'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null)

  async function accept() {
    setLoading('accept')
    const res = await fetch('/api/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? 'Failed to accept')
      setLoading(null)
      return
    }
    const data = await res.json()
    // Switch to the newly-joined workspace
    await fetch('/api/me/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: data.workspace_id }),
    })
    toast.success('Joined workspace')
    router.push('/dashboard')
    router.refresh()
  }

  async function decline() {
    setLoading('decline')
    await fetch('/api/invitations/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    toast.info('Invitation declined')
    router.push('/dashboard')
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button
        onClick={accept}
        disabled={!!loading}
        className="w-48 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading === 'accept' ? 'Joining…' : 'Accept invitation'}
      </button>
      <button
        onClick={decline}
        disabled={!!loading}
        className="w-48 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
      >
        {loading === 'decline' ? 'Declining…' : 'Decline'}
      </button>
    </div>
  )
}
