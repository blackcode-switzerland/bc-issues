'use client'

import { useState } from 'react'

export function CliAuthorizeForm({
  callback,
  state,
  defaultName,
}: {
  callback: string
  state: string
  defaultName: string
}) {
  const [name, setName] = useState(defaultName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch('/api/cli/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback, state, name }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok || !body.redirect_url) {
        setError(body.error ?? 'Failed to authorize')
        return
      }
      window.location.replace(body.redirect_url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to authorize')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1.5">Token name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full px-3 py-2 bg-background border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          You can revoke this later from Settings → API Tokens.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={submitting || !name.trim()}
          className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Authorizing…' : 'Authorize'}
        </button>
        <a
          href="/dashboard"
          className="px-4 py-2.5 bg-secondary rounded-lg font-medium hover:bg-secondary/80 transition-colors"
        >
          Cancel
        </a>
      </div>
    </div>
  )
}
