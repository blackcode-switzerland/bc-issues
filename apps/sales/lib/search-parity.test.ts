// ⌘K and `/dashboard/{ws}/search` answer with the SAME rows, and this is why.
//
// ===========================================================================
// THE PROPERTY, AND WHY IT IS ASSERTED ABOUT THE TREE AND NOT ABOUT RESULTS
// ===========================================================================
// The obvious test — "run both over the same term and compare" — needs a
// database, a seeded workspace and a rendered React tree, and it would still
// only prove they agreed for THAT term on THAT data. What actually has to be
// true is structural: **there is one call site for `…/sales-search` in this app,
// and both surfaces go through it.** Then they cannot rank differently, cannot
// hit different endpoints, and cannot drift when one is edited.
//
// So this file asserts the shape of the module graph. It is the same kind of
// check as `lib/app-isolation.test.ts`, for the same reason: a property you can
// grep for is a property that stays true after everyone who agreed to it has
// left.
//
// ===========================================================================
// AND THE OTHER HALF: THIS APP DOES NOT SERVE THE PLATFORM SEARCH
// ===========================================================================
// D-9's two layers are two PATHS. `…/search` reads `platform.entities` (titles,
// every app, URNs out) and `…/sales-search` reads `sales.*` full text. Serving
// both from this host would make which one an agent got depend on which
// deployment it was pointed at — the ambiguity D-11 removes from the verbs. The
// last case asserts the route file does not exist, so mounting it becomes a
// deliberate act with a failing test attached rather than a three-line accident.
//
// Watched fail 2026-08-07, three ways:
//   - `wsPath(ws, '/sales-search')` pasted back into `command-palette.tsx`
//     → RED naming the file
//   - the same in `components/search/search-page.tsx` → RED
//   - `useSalesSearch` renamed in `lib/hooks.ts` and left uncalled → the INPUT
//     assertion fires, not the others. That is the case worth having: without
//     it, deleting the hook would make every "no component names the path"
//     assertion pass by there being no search at all.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Every `.ts`/`.tsx` under a directory, recursively. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

const SOURCES = [...walk(join(APP_ROOT, 'app')), ...walk(join(APP_ROOT, 'components')), ...walk(join(APP_ROOT, 'lib'))]

const rel = (p: string) => p.slice(APP_ROOT.length + 1)

/**
 * The one module allowed to name the endpoint. `lib/hooks.ts` builds the
 * request; `app/api/**` is the SERVER side and is not a call site at all.
 */
const ENDPOINT_OWNER = 'lib/hooks.ts'

/**
 * The endpoint as CODE, not as prose — D-38, and finding #4 the other way round.
 *
 * The first version of this check was `src.includes('sales-search')`, and it
 * failed on both files it was written to protect: each one's header EXPLAINS
 * which endpoint it goes through, in a sentence containing the word. A detector
 * that fires on the documentation of its own rule is the shape of CLAUDE.md's
 * finding #4, and the outcome there is that somebody weakens or deletes it
 * (D-37).
 *
 * The needle is therefore the value inside a single- or double-quoted string —
 * `'/sales-search'` — which is how the path is written when it is BUILT, and
 * never how it is written in prose. Backticks are excluded deliberately: every
 * mention in a comment in this app uses them for `…/sales-search`, and a
 * template literal that assembled the path would still have to open a quote for
 * the segment before it.
 */
const ENDPOINT_LITERAL = /(['"])\/?sales-search\1/

describe('search: one endpoint, one call site (D-9)', () => {
  it('found something to check', () => {
    // Without this, a walk that returned nothing would make every assertion
    // below pass while checking no files at all — CLAUDE.md's finding #5.
    expect(SOURCES.length, `no sources found under ${APP_ROOT}`).toBeGreaterThan(20)
    expect(
      SOURCES.some((f) => rel(f) === ENDPOINT_OWNER),
      `${ENDPOINT_OWNER} was not walked — the paths in this file are wrong`
    ).toBe(true)
  })

  it('the shared hook exists and both surfaces import it', () => {
    const hooks = readFileSync(join(APP_ROOT, ENDPOINT_OWNER), 'utf8')
    // `\b` on the END of the name, not `toContain`. The first version of this
    // line was `toContain('export function useSalesSearch')`, and renaming the
    // hook to `useSalesSearchRENAMED` left it GREEN — the old name is a prefix
    // of the new one. Found on 2026-08-07 by running exactly that regression
    // (D-26 step 3) and watching the suite pass 4/4. Same failure as CLAUDE.md's
    // finding #9: a substring match is not a match.
    expect(hooks, `${ENDPOINT_OWNER} no longer exports useSalesSearch`).toMatch(
      /export function useSalesSearch\b/
    )

    for (const f of ['components/command-palette.tsx', 'components/search/search-page.tsx']) {
      const src = readFileSync(join(APP_ROOT, f), 'utf8')
      expect(src, `${f} does not use useSalesSearch — it is searching by some other means`).toMatch(
        /\buseSalesSearch\b/
      )
    }
  })

  it('no component names the sales-search path', () => {
    const offenders = SOURCES.filter((f) => {
      const r = rel(f)
      if (r === ENDPOINT_OWNER || r.startsWith('app/api/')) return false
      return ENDPOINT_LITERAL.test(readFileSync(f, 'utf8'))
    }).map(rel)

    expect(
      offenders,
      'these files reach the search endpoint directly instead of through ' +
        `useSalesSearch in ${ENDPOINT_OWNER}. Two call sites can rank, paginate ` +
        'and fail differently for the same term, with nothing to say which is ' +
        `right:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  // -------------------------------------------------------------------------
  // REVERSED 2026-08-07. THIS APP NOW MOUNTS BOTH, AND MUST.
  // -------------------------------------------------------------------------
  // This case used to assert that `app/api/workspaces/[ws]/search/route.ts` did
  // NOT exist, reasoning that "serving both from this host makes which one an
  // agent gets depend on which deployment it was pointed at."
  //
  // That reasoning does not survive contact, and the rewrite rather than an
  // appended note is deliberate — a check that prescribes a rejected design is
  // worse than no check.
  //
  // **The deployment never decided which search you got. The VERB does.**
  // `bk search` calls `…/search`; `bk sales search` calls `…/sales-search`. Two
  // paths, two commands, no ambiguity — which is D-11 working, not D-11 at risk.
  // What NOT mounting the platform route actually bought was `bk search`
  // returning a 404 page to anyone homed on sales, and `bk search` is a
  // north-star step. Phase 10 ran it and it failed.
  //
  // So the property worth asserting is the opposite one, and it is the same
  // property in both directions: **both paths exist and stay distinct.** A
  // single host serving one path under the other's semantics is the real
  // failure, and it is what the call-site assertions above already prevent for
  // the web surfaces.

  it('this app mounts BOTH search paths, and they stay distinct (D-9)', () => {
    const platformSearch = join(APP_ROOT, 'app/api/workspaces/[ws]/search/route.ts')
    const salesSearch = join(APP_ROOT, 'app/api/workspaces/[ws]/sales-search/route.ts')

    expect(
      existsSync(salesSearch),
      'app/api/workspaces/[ws]/sales-search/route.ts is gone. That is this app\'s ' +
        'OWN full-text search over sales.*, and ⌘K and the search page both go ' +
        'through it.'
    ).toBe(true)

    expect(
      existsSync(platformSearch),
      'app/api/workspaces/[ws]/search/route.ts is missing. That is the PLATFORM ' +
        'search (platform.entities, every app, URNs out) and `bk search` is a ' +
        'north-star step: without this file it answers 404 for anyone homed on ' +
        'sales. Mounting it is three lines — searchRoute(appContext).'
    ).toBe(true)

    // Distinct implementations, not one re-exporting the other. If they ever
    // collapse into one, the two-layer model in D-9 is gone and only this says so.
    const platformSrc = readFileSync(platformSearch, 'utf8')
    expect(
      /sales-search/.test(platformSrc),
      'the platform search route mentions /sales-search. These are two layers: ' +
        'titles across every app, and full text within this one. Serving either ' +
        'under the other\'s path is the collapse D-9 exists to prevent.'
    ).toBe(false)
  })
})
