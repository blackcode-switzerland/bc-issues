'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Key, Loader2, Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface TokenSummary {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  created_at: string | null
}

interface MintedToken {
  id: number
  plaintext: string
  prefix: string
  name: string
  scopes: string[]
  expires_at: string | null
  created_at: string | null
}

function formatDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ApiTokensSettings() {
  const [tokens, setTokens] = useState<TokenSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const { confirm } = useConfirm()

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/tokens')
      if (!r.ok) throw new Error(await r.text())
      setTokens(await r.json())
    } catch (e) {
      console.error(e)
      toast.error('Failed to load tokens')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Token needs a name')
      return
    }
    setCreating(true)
    try {
      const r = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || 'Failed')
      setMinted(body)
      setName('')
      setShowCreate(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mint token')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: number) {
    if (!(await confirm({ title: 'Revoke this token?', description: 'Any client using it will stop working immediately.', destructive: true, confirmLabel: 'Revoke' }))) return
    try {
      const r = await fetch(`/api/tokens/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(await r.text())
      toast.success('Token revoked')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to revoke')
    }
  }

  async function copyMinted() {
    if (!minted) return
    await navigator.clipboard.writeText(minted.plaintext)
    toast.success('Copied to clipboard')
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-lg font-semibold">API Tokens</h2>
            <p className="text-sm text-muted-foreground">
              Personal access tokens for the <code className="px-1 py-0.5 rounded bg-secondary text-xs">bk</code> CLI and other API clients.
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreate(true)
              setMinted(null)
            }}
            className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            New token
          </button>
        </div>

        {minted && (
          <div className="mt-6 border border-primary/40 bg-primary/5 rounded-lg p-4">
            <p className="text-sm font-medium mb-2">
              Token created — copy it now. It will not be shown again.
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 break-all text-xs bg-background border border-border rounded px-3 py-2 font-mono">
                {minted.plaintext}
              </code>
              <button
                onClick={copyMinted}
                className="inline-flex items-center gap-2 px-3 py-2 bg-secondary rounded-lg text-sm hover:bg-secondary/80 transition-colors"
              >
                <Copy size={14} />
                Copy
              </button>
            </div>
            <button
              onClick={() => setMinted(null)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        )}

        {showCreate && (
          <div className="mt-6 border border-border rounded-lg p-4 bg-secondary/30">
            <label className="block text-sm font-medium mb-1.5">Token name</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
              placeholder="e.g. macbook-cli"
              maxLength={100}
              className="w-full px-3 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                Mint token
              </button>
              <button
                onClick={() => {
                  setShowCreate(false)
                  setName('')
                }}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Active tokens</h3>
        </div>

        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : tokens.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            No tokens yet. Create one to start using the CLI.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-6 py-2 font-medium">Name</th>
                <th className="px-6 py-2 font-medium">Prefix</th>
                <th className="px-6 py-2 font-medium">Created</th>
                <th className="px-6 py-2 font-medium">Last used</th>
                <th className="px-6 py-2 font-medium">Expires</th>
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0">
                  <td className="px-6 py-3 font-medium">{t.name}</td>
                  <td className="px-6 py-3">
                    <code className="text-xs font-mono text-muted-foreground">
                      bk_live_{t.token_prefix}…
                    </code>
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">{formatDate(t.created_at)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{formatDate(t.last_used_at)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{formatDate(t.expires_at)}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(t.id)}
                      className="inline-flex items-center gap-1.5 text-xs text-destructive hover:underline"
                    >
                      <Trash2 size={14} />
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
