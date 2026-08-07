'use client'

// API tokens — `platform.api_tokens`, one list across every blackcode app.
//
// A token minted here works against issues too, and one revoked here stops
// working there. That is D-16/§6 and it is the thing a reader is most likely to
// assume otherwise, so the page says it rather than leaving it to be discovered
// by a command failing somewhere else.
//
// Not behind `ui_mode`, for the same reason as the profile page: a token is how
// an agent reaches this product at all, and a browser display preference that
// could take it away would be a permission over the account. See
// `lib/read-only.test.ts`, which allows this file by name and asserts the paths
// it sends to are not `/api/workspaces/…` ones.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Trash2 } from 'lucide-react'
import { apiGet, apiSend } from '@/lib/client'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { Section } from './profile-settings'

interface TokenSummary {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  created_at: string | null
}

interface MintedToken extends TokenSummary {
  /** Returned ONCE, at creation. Nothing can show it again. */
  plaintext: string
}

export function TokenSettings() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const [pending, setPending] = useState<number | null>(null)

  const tokens = useQuery({
    queryKey: ['tokens'],
    queryFn: () => apiGet<TokenSummary[]>('/api/tokens'),
  })

  const create = useMutation({
    mutationFn: () => apiSend<MintedToken>('POST', '/api/tokens', { name: name.trim() }),
    onSuccess: (token) => {
      setMinted(token)
      setName('')
      qc.invalidateQueries({ queryKey: ['tokens'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revoke = useMutation({
    mutationFn: (id: number) => apiSend<{ deleted: true }>('DELETE', `/api/tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tokens'] })
      toast.success('Token revoked')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      {minted && (
        <Section
          title="Copy it now"
          note="This is the only time the token is shown. Nothing — not this page, not the database — can display it again."
        >
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs">
              {minted.plaintext}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(minted.plaintext).then(
                  () => toast.success('Copied'),
                  // A clipboard write can be refused by the browser, and a
                  // silent failure here means somebody navigates away believing
                  // they have a credential they do not.
                  () => toast.error('Could not copy — select the token and copy it by hand')
                )
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
            >
              <Copy size={14} />
              Copy
            </button>
          </div>
          <button
            onClick={() => setMinted(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            I have it — hide this
          </button>
        </Section>
      )}

      <Section
        title="New token"
        note="Tokens are how agents reach blackcode. This one will work against every app you have access to, not only b/sales."
      >
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is it for? e.g. companion-laptop"
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          From a terminal, <code className="rounded bg-muted px-1 py-0.5">bk login</code> does this
          for you and stores the result.
        </p>
      </Section>

      <Section title="Your tokens">
        {tokens.isPending ? (
          <BlockSkeleton rows={2} />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} />
        ) : tokens.data.length === 0 ? (
          <EmptyState title="No tokens" hint="Create one above, or run `bk login` from a terminal." />
        ) : (
          <ul className="divide-y divide-border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <code>bk_live_{t.token_prefix}…</code>
                    {' · '}
                    {t.last_used_at ? `last used ${short(t.last_used_at)}` : 'never used'}
                    {t.expires_at ? ` · expires ${short(t.expires_at)}` : ''}
                  </span>
                </span>
                {/*
                  Two steps, because one click cannot be taken back and the
                  thing it breaks is somewhere else: an agent mid-run losing its
                  credential does not look like "somebody clicked a bin icon",
                  it looks like the API being down. The second step names the
                  token, which is the same reason the CLI's irreversible verbs
                  make the caller repeat the target back.
                */}
                {pending === t.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => {
                        setPending(null)
                        revoke.mutate(t.id)
                      }}
                      disabled={revoke.isPending}
                      className="rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                    >
                      Revoke “{t.name}”
                    </button>
                    <button
                      onClick={() => setPending(null)}
                      className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setPending(t.id)}
                    aria-label={`Revoke ${t.name}`}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function short(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
