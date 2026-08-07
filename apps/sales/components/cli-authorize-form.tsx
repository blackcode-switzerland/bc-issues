'use client'

// The Authorize button on `/cli/authorize`.
//
// It POSTs through `apiSend` rather than calling `fetch` — the same rule every
// write in this app follows, and the reason is `lib/read-only.test.ts`: there is
// exactly one `fetch(` in this surface, so "no mutation reaches the network
// except through the module that documents them" is checkable rather than
// believed. **Not** through `lib/mutations.ts`, because this is not a sales
// record and must not move behind `ui_mode` (see the page's header).

import { useState } from 'react'
import { apiSend, ApiClientError } from '@/lib/client'

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

  async function approve() {
    setError(null)
    setSubmitting(true)
    try {
      const body = await apiSend<{ redirect_url?: string }>('POST', '/api/cli/authorize', {
        callback,
        state,
        name,
      })
      if (!body.redirect_url) {
        // The route answered 200 with no redirect. Saying so beats a button that
        // stops spinning and does nothing, which reads as the click not landing.
        setError('The server authorized the request but returned no callback URL.')
        return
      }
      window.location.replace(body.redirect_url)
    } catch (e) {
      const suggestion = e instanceof ApiClientError ? e.suggestion : undefined
      setError(
        [e instanceof Error ? e.message : 'Failed to authorize', suggestion]
          .filter(Boolean)
          .join(' — ')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="token-name" className="mb-1.5 block text-sm font-medium">
          Token name
        </label>
        <input
          id="token-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // No `maxLength`. The cap is `TOKEN_NAME_MAX`, declared once in
          // `@blackcode/platform-api` and enforced by the route, and importing
          // it here would pull that package's barrel — handler, drizzle,
          // storage — into the browser bundle for one integer. A long name gets
          // the route's own 400, which carries the number and a suggestion.
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          You can revoke it later from Settings → API tokens.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={submitting || !name.trim()}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Authorizing…' : 'Authorize'}
        </button>
        <a
          href="/dashboard"
          className="rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary/80"
        >
          Cancel
        </a>
      </div>
    </div>
  )
}
