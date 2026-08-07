// Does every address this app HANDS OUT point at a page this app HAS?
//
// ---------------------------------------------------------------------------
// WHAT THE TYPE SYSTEM ALREADY DOES, SO THIS DOES NOT
// ---------------------------------------------------------------------------
// `LISTING_SEGMENT`'s key type is `Exclude<SalesEntityType, 'prospect'>`, so a
// type added to `ENTITY_TYPES` without a listing entry is TS2741 and a prospect
// given one is TS2353. Both were watched fail on 2026-08-07. Nothing here
// re-checks that; a test that duplicates a compile error only ever fails after
// the build already has.
//
// ---------------------------------------------------------------------------
// WHAT IT DOES INSTEAD, AND WHY IT IS THE FILESYSTEM
// ---------------------------------------------------------------------------
// `meeting: 'meeting'` is perfectly well-typed and 404s. The map is a set of
// STRINGS naming App Router directories, and nothing connects a string to a
// directory but this test. That is the whole gap: the defect this file was
// written for shipped as five well-typed segments pointing at detail pages
// nobody built, and it survived typecheck, lint, tests and a build.
//
// It matters more than the usual dead-link test because `entityPath`'s output is
// STORED, in `platform.entities.url`, at write time — a wrong segment is not a
// bad render, it is a wrong row in a shared table that another deployment reads
// and nothing recomputes.
//
// ---------------------------------------------------------------------------
// WHAT IT WOULD STILL PASS ON (D-26 step 2), STATED SO NOBODY HAS TO GUESS
// ---------------------------------------------------------------------------
//   1. A listing that exists but ignores `?focus=`. The link resolves, the page
//      renders, and the reader lands on an unhighlighted list of thirty rows.
//      REAL — `DocumentsPage` did exactly this until 2026-08-07. Now checked
//      below, and that check is the weakest thing in this file: it asks whether
//      the component CALLS something that reads the parameter, so a component
//      that reads it and drops it still passes.
//   2. A prospect detail page that exists as a directory and throws at runtime.
//      A route file is not a working page and this cannot tell the difference.
//   3. A listing that reads `?focus=` by some route other than `useFocus()` or
//      `params.get('focus')` — the two spellings the assertion knows. A third
//      spelling reads as "does not handle focus" and fails loudly, which is the
//      right way round for a check that cannot see everything.
//   4. The reverse direction — a page this app has that nothing addresses. That
//      is not a broken link, so it is deliberately not an error here.
//
// D-26 step 3, each injected on the FIXED tree and watched go red on 2026-08-07:
//   - `meeting: 'meeting'` in `LISTING_SEGMENT`      → "no such directory"
//   - the `useFocus()` call deleted from DocumentsPage → "/documents → <DocumentsPage/>"
//   - `const focus = null as number | null` in its place, i.e. the variable kept
//     and the READ removed → same failure. This third one is why the assertion
//     matches a call and not the word `focus`: the word-matching version passed.
//
// ---------------------------------------------------------------------------
// D-42 — THIS GUARD MATCHES TEXT, AND SO DOES THE TEXT THAT EXPLAINS IT
// ---------------------------------------------------------------------------
// A guard that matches text will match the text that explains it. Four instances
// in one week, by four different agents. The focus assertion below reads
// component sources for `focus`, and this comment block contains that word
// repeatedly — it is safe only because it lives in a *test* file that is never
// one of the scanned inputs. Do not "improve" it by scanning the whole app
// directory, and do not add an allowance covering this paragraph: an allowance
// that keeps itself alive can never go stale.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENTITY_TYPES, LISTING_SEGMENT, entityPath } from './dashboard-paths'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DASHBOARD = join(APP_ROOT, 'app', 'dashboard', '[ws]')

/** Every route segment the App Router actually serves under /dashboard/[ws]. */
function routeSegments(): string[] {
  return readdirSync(DASHBOARD, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('['))
    .filter((e) => existsSync(join(DASHBOARD, e.name, 'page.tsx')))
    .map((e) => e.name)
}

/**
 * The body of the ONE component a listing page renders.
 *
 * ---------------------------------------------------------------------------
 * WHY A COMPONENT BODY AND NOT THE FILE — THE FIRST VERSION OF THIS WAS INERT
 * ---------------------------------------------------------------------------
 * Written first as "read page.tsx, read every component file it imports, look
 * for the word". It passed on 2026-08-07 against a `DocumentsPage` that ignored
 * `?focus=` entirely — because `ProductsPage` and `TemplatesPage` live in the
 * SAME FILE and do read it. Three listings share `catalog-pages.tsx`, so one
 * file-level match vouched for all three.
 *
 * That is CLAUDE.md finding #8's shape, reproduced by the agent whose whole
 * phase is finding it: a guard written an hour after re-reading the rule, green
 * against the defect it was written for. **The granularity of a text scan is
 * part of what it checks.**
 *
 * So: `page.tsx` names its component in JSX (`<DocumentsPage ws={ws} />`); slice
 * that component's body out of the file it is exported from, and scan only that.
 */
function focusReadingBody(segment: string): { component: string; body: string } {
  const page = readFileSync(join(DASHBOARD, segment, 'page.tsx'), 'utf8')
  const rendered = /<([A-Z][A-Za-z0-9]*)\b/.exec(page)
  if (!rendered) throw new Error(`${segment}/page.tsx renders no component`)
  const component = rendered[1]

  for (const m of page.matchAll(/from\s+'@\/(components\/[^']+)'/g)) {
    const file = join(APP_ROOT, m[1] + '.tsx')
    if (!existsSync(file)) continue
    const src = readFileSync(file, 'utf8')
    // Anchored to the declaration, and bounded by the NEXT top-level export —
    // a component's body, not its file and not its neighbours.
    const start = src.search(new RegExp(`^export function ${component}\\b`, 'm'))
    if (start < 0) continue
    const rest = src.slice(start + 1)
    const end = rest.search(/^export /m)
    return { component, body: end < 0 ? rest : rest.slice(0, end) }
  }
  throw new Error(`could not find the body of <${component}/> for /${segment}`)
}

describe('dashboard-paths', () => {
  // Both sides are read off disk, so "found nothing" is a real failure mode and
  // an empty set would make every assertion below pass while checking nothing.
  // This is the assertion that caught the `__routes` dedup bug (CLAUDE.md #5).
  it('discovers both sides (guards against a vacuous pass)', () => {
    expect(ENTITY_TYPES.length, 'no entity types declared').toBeGreaterThan(0)
    expect(Object.keys(LISTING_SEGMENT).length, 'the listing map is empty').toBeGreaterThan(0)
    expect(routeSegments().length, `no page.tsx found under ${DASHBOARD}`).toBeGreaterThan(0)
  })

  it('every listing segment names a route that exists', () => {
    const served = new Set(routeSegments())
    const dead = Object.entries(LISTING_SEGMENT)
      .filter(([, segment]) => !served.has(segment))
      .map(([type, segment]) => `${type} → /dashboard/{ws}/${segment} (no such directory)`)
    expect(
      dead,
      'these entity types are projected at a page this app does not serve. ' +
        'The value is STORED in platform.entities.url, so a cross-app link to one ' +
        'is a 404 nothing recomputes:\n' + dead.join('\n')
    ).toEqual([])
  })

  it('a prospect resolves to its own detail page, not a listing', () => {
    expect(existsSync(join(DASHBOARD, 'prospects', '[n]', 'page.tsx'))).toBe(true)
    expect(entityPath('acme', 'prospect', 12)).toBe('/dashboard/acme/prospects/12')
  })

  it('every other type resolves to its listing with the row focused', () => {
    expect(entityPath('acme', 'meeting', 3)).toBe('/dashboard/acme/meetings?focus=3')
    expect(entityPath('acme', 'document', 9)).toBe('/dashboard/acme/documents?focus=9')
  })

  // The weak one — see the D-42 note in the header. It asks only whether the
  // component CALLS something that reads the parameter; it cannot tell a real
  // highlight from a value that is read and dropped.
  //
  // Anchored to a CALL, not to the word. The first version tested `/\bfocus\b/`
  // and passed against a body whose only mention was `const focus = null` — the
  // variable name vouched for the behaviour. Watched on 2026-08-07, which is the
  // second time this file's own guard was found inert by breaking it.
  const READS_THE_PARAM = /useFocus\s*\(|\.get\(\s*['"]focus['"]\s*\)/
  it('every listing page reads the focus parameter it is sent to', () => {
    const ignored: string[] = []
    for (const segment of Object.values(LISTING_SEGMENT)) {
      const { component, body } = focusReadingBody(segment)
      if (!READS_THE_PARAM.test(body)) ignored.push(`/${segment} → <${component}/>`)
    }
    expect(
      ignored,
      'entityPath sends readers to these listings with ?focus=<n>, and the ' +
        'component the page renders never reads it — the link resolves and the ' +
        `row is not highlighted:\n${ignored.join('\n')}`
    ).toEqual([])
  })
})
