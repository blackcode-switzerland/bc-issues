'use client'

// ⌘K — search inside this app's records.
//
// ── WHICH SEARCH THIS IS, BECAUSE THERE ARE TWO AND THEY ARE NOT THE SAME ───
// This calls **`GET …/sales-search`**, the app-owned half of D-9: it reads
// `sales.*` full text and reaches into columns the URN projection never sees —
// a phrase in a call summary, a name in a meeting outcome, the body of a
// template. The platform half (`…/search`, over `platform.entities`, every app,
// URNs out) is a different path on purpose and this app does not mount it.
//
// A reader in b/sales looking for "Roches" wants the record, not a URN, so this
// is the right half to put behind ⌘K.
//
// ── IT NAVIGATES; IT DOES NOT ACT ───────────────────────────────────────────
// Every result is a link to a record. There are no commands in this command
// palette — no "create prospect", no "log a call" — because those would be
// mutation affordances, and D-7 renders none in `read_only`. If Phase 9 adds
// actions here they belong behind the same switch as every other write.
//
// ── THE FULL SEARCH PAGE IS NOT THIS ────────────────────────────────────────
// `/dashboard/{ws}/search` — ranked, grouped, faceted — is Phase 8. This is the
// jump-to-record affordance that lives in the shell, and it deliberately shows a
// short list rather than pretending to be that page.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft, Loader2 } from 'lucide-react'
import { apiGet, query, wsPath, type ListPage } from '@/lib/client'

/** One hit, in the shape `searchSales` serves. */
interface SearchHit {
  type: string
  number: number | null
  prospect_number: number | null
  title: string
  snippet: string | null
  rank: number
  urn: string | null
}

const RESULT_LIMIT = 12

/**
 * Where a hit lives in the web app.
 *
 * The four types with no #number (`contact`, `objection`, `match`, and a
 * `stage entry`) have no page of their own — `lib/views.ts` says so from the
 * other side: a child with no independent identity has no URN. They open their
 * PARENT prospect, which is where they are displayed. Returning null for them
 * instead would mean showing a result nobody can click.
 */
function hrefFor(ws: string, hit: SearchHit): string | null {
  const base = `/dashboard/${ws}`
  switch (hit.type) {
    case 'prospect':
      return hit.number != null ? `${base}/prospects/${hit.number}` : null
    case 'meeting':
      return hit.number != null ? `${base}/meetings?focus=${hit.number}` : null
    case 'communication':
      return hit.number != null ? `${base}/communications?focus=${hit.number}` : null
    case 'product':
      return hit.number != null ? `${base}/products?focus=${hit.number}` : null
    case 'template':
      return hit.number != null ? `${base}/templates?focus=${hit.number}` : null
    case 'document':
      return hit.number != null ? `${base}/documents?focus=${hit.number}` : null
    default:
      // contact / objection / match — no page of their own, so the prospect.
      return hit.prospect_number != null ? `${base}/prospects/${hit.prospect_number}` : null
  }
}

export function CommandPalette({
  ws,
  open,
  onClose,
}: {
  ws: string
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Every in-flight request carries a sequence number and only the newest one is
  // allowed to write state. Without it a slow "ro" landing after a fast "roches"
  // repaints the older answer over the newer one — the classic search race, and
  // it looks like the index being wrong rather than the client being wrong.
  const seq = useRef(0)

  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setActive(0)
      setError(null)
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setHits([])
      setError(null)
      setBusy(false)
      return
    }
    const mine = ++seq.current
    setBusy(true)
    // 150ms: below it every keystroke is a query, above it the list visibly
    // lags the cursor.
    const t = setTimeout(async () => {
      try {
        const page = await apiGet<ListPage<SearchHit>>(
          wsPath(ws, '/sales-search') + query({ q: term, limit: RESULT_LIMIT })
        )
        if (mine !== seq.current) return
        setHits(page.data)
        setActive(0)
        setError(null)
      } catch (e) {
        if (mine !== seq.current) return
        setHits([])
        // Shown, not swallowed. An empty list on a failed request reads as
        // "nothing matches", which is the wrong answer and the reassuring one.
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 150)
    return () => clearTimeout(t)
  }, [q, ws])

  const go = useCallback(
    (hit: SearchHit) => {
      const href = hrefFor(ws, hit)
      if (!href) return
      onClose()
      router.push(href)
    },
    [onClose, router, ws]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search b/sales"
    >
      <button aria-label="Close search" className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, hits.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              }
              if (e.key === 'Enter' && hits[active]) {
                e.preventDefault()
                go(hits[active])
              }
            }}
            placeholder="Search prospects, meetings, calls, templates…"
            className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {busy && <Loader2 size={15} className="shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {error ? (
            <p role="alert" className="px-3 py-6 text-center text-sm text-destructive">
              {error}
            </p>
          ) : q.trim() && !busy && hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches &ldquo;{q.trim()}&rdquo;
            </p>
          ) : !q.trim() ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Search inside prospects, contacts, meeting outcomes, call notes,
              objections and the catalog.
            </p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.type}-${hit.number ?? 'x'}-${i}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ' +
                  (i === active ? 'bg-accent' : '')
                }
              >
                <span className="w-[86px] shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {hit.type}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{hit.title}</span>
                  {hit.snippet && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {hit.snippet}
                    </span>
                  )}
                </span>
                {i === active && (
                  <CornerDownLeft size={14} className="shrink-0 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
