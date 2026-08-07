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
// ── THE FULL SEARCH PAGE IS NOT THIS, AND IT IS THE SAME ANSWER ─────────────
// `/dashboard/{ws}/search` — ranked, grouped, faceted — landed with Phase 8.
// This is the jump-to-record affordance that lives in the shell and shows a
// short list rather than pretending to be that page. **Both go through
// `useSalesSearch`**, so the top of this list is the top of that page for the
// same term, by construction: neither component names the endpoint, and
// `lib/search-parity.test.ts` asserts that neither can start to.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft, Loader2 } from 'lucide-react'
import { useSalesSearch, type SearchHit } from '@/lib/hooks'
import { recordHref } from '@/lib/record-href'

const RESULT_LIMIT = 12

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
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 150ms: below it every keystroke is a query, above it the list visibly lags
  // the cursor. Only the DEBOUNCE lives here — the request, the cache and the
  // race are `useSalesSearch`'s, where the search page gets the identical
  // treatment. The race used to be a hand-rolled sequence counter; the term is
  // now part of the query key, so a slow "ro" landing after a fast "roches" can
  // only write into its own cache entry and there is nothing left to get wrong.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 150)
    return () => clearTimeout(t)
  }, [q])

  const search = useSalesSearch(ws, term, { limit: RESULT_LIMIT })
  const hits = search.data ?? []

  useEffect(() => {
    if (open) {
      setQ('')
      setTerm('')
      setActive(0)
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => setActive(0), [term])

  const go = useCallback(
    (hit: SearchHit) => {
      const href = recordHref(ws, hit)
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
          {search.isFetching && (
            <Loader2 size={15} className="shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {search.error ? (
            // Shown, not swallowed. An empty list on a failed request reads as
            // "nothing matches", which is the wrong answer and the reassuring one.
            <p role="alert" className="px-3 py-6 text-center text-sm text-destructive">
              {search.error instanceof Error ? search.error.message : 'Search failed'}
            </p>
          ) : !q.trim() ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Search inside prospects, contacts, meeting outcomes, call notes,
              objections and the catalog.
            </p>
          ) : term && !search.isPending && hits.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing matches &ldquo;{term}&rdquo;
              </p>
              {/*
                A dead end names its own exit, the same rule the CLI's `hintFor`
                follows. The full page can narrow by type and by deal where this
                cannot, so "nothing here" is a reason to offer it rather than to
                stop.
              */}
              <Link
                href={`/dashboard/${ws}/search?q=${encodeURIComponent(term)}`}
                onClick={onClose}
                className="mt-2 inline-block text-xs text-primary hover:underline"
              >
                Open the full search for “{term}”
              </Link>
            </div>
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

        {hits.length > 0 && (
          <div className="border-t border-border px-4 py-2">
            <Link
              href={`/dashboard/${ws}/search?q=${encodeURIComponent(term)}`}
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {/*
                `RESULT_LIMIT` is this palette's, not the server's cap, so a
                twelfth hit does not mean there are exactly twelve. The line is
                offered whenever there is anything at all rather than only when
                the list looks full — it is a route to the facets, not a "more"
                button, and guessing at truncation would be the same class of
                wrong answer as a quietly short list.
              */}
              See all results for “{term}” — group and filter by type and by deal
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
