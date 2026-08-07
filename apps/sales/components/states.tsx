'use client'

// Loading, empty and error — the three states every block on every page has, in
// one place so they are answered the same way everywhere.
//
// ── AN ERROR IS SHOWN, NOT SWALLOWED ────────────────────────────────────────
// A failed fetch renders the server's own message and its `suggestion` when
// there is one — the same string `bk` prints as a `hint:` line. The alternative
// everyone reaches for is rendering the empty state on error, which turns "the
// API is down" into "you have no prospects": the most reassuring wrong answer
// this app could give, and the same failure the blob-drift reconciler's
// `unreconciled_count` exists to prevent one layer down.

import { AlertCircle } from 'lucide-react'
import { ApiClientError } from '@/lib/client'

export function BlockSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong'
  const suggestion = error instanceof ApiClientError ? error.suggestion : undefined
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
      <span>
        <span className="block text-foreground">{message}</span>
        {suggestion && <span className="mt-0.5 block text-muted-foreground">{suggestion}</span>}
      </span>
    </div>
  )
}

/**
 * An empty block.
 *
 * `hint` is where the honest half goes: this app is a ledger, so "nothing here"
 * almost always means the agent has not written anything yet rather than that
 * the reader has something to do. Saying which keeps a read-only surface from
 * reading like a broken one.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
