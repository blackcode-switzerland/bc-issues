// One palette. Colour is decided in `lib/pipeline.ts` and nowhere else.
//
// ---------------------------------------------------------------------------
// WHY THIS IS WORTH A CHECK AND WHY IT IS WORTH IT *NOW*
// ---------------------------------------------------------------------------
// D-4: sales must not feel like issues. The whole of that decision is a table of
// hex values in `lib/pipeline.ts`, reached through six `*Color` helpers, and it
// holds for exactly as long as nobody types `#e08658` into a component. Nothing
// catches that — not tsc, not eslint, not any test — and agent6 flagged it while
// noting the useful fact underneath: **`components/chips.tsx` is the only caller
// of the six helpers, so "no hex outside pipeline.ts" is true today.**
//
// It is true today and gets less true with every page. A check that is cheap
// while a codebase has zero violations is expensive once it has nine, because
// then somebody has to decide which nine were fine.
//
// ---------------------------------------------------------------------------
// WHAT IT CATCHES, AND WHAT IT WOULD STILL PASS ON (D-26 step 2)
// ---------------------------------------------------------------------------
// CATCHES: a literal `#rrggbb` written into any module under `components/` or
// `lib/`, which is the shape the defect takes — a chip, dot or badge coloured by
// hand instead of by the vocabulary.
//
// STILL PASSES ON, stated so nobody mistakes this for more than it is:
//   1. `text-emerald-500` — a Tailwind class is a colour too, and this sees
//      none of them. Deliberate: the design system IS Tailwind tokens, so
//      banning them would fire on every correct line in the app.
//   2. `rgb(224 134 88)` and `hsl(...)`. Same hex, different spelling. Not
//      matched because nothing in this repo writes colour that way, so a
//      pattern for it would be a pattern with no coverage — it would go stale
//      unnoticed, which is worse than a stated gap.
//   3. **The WRONG helper.** `stageColor(c.channel)` type-checks, returns the
//      neutral fallback, and is exactly as wrong as a typed hex. This cannot
//      see it. It is the largest hole and there is no cheap check for it.
//   4. `app/api/**`, out of scope by construction — see below.
//
// ---------------------------------------------------------------------------
// D-42 — THIS GUARD MATCHES TEXT, AND THE TEXT THAT EXPLAINS IT IS A HEX
// ---------------------------------------------------------------------------
// A guard that matches text will match the text that explains it. Four instances
// in one week by four different agents, and this file is a fifth candidate:
// `components/chips.tsx` line 15 contains `bg-[#e08658]` inside a COMMENT
// explaining why Tailwind cannot generate it. Scanning raw source reports the
// documentation.
//
// The escape used here is the first one D-42 recommends — **strip comments
// before matching** — and NOT an allowance naming chips.tsx, which would be an
// entry that keeps itself alive and can never go stale.
//
// The second text problem was solved by ANCHORING TO A LOCATION rather than by
// an allowance list: `app/api/**` holds two `'e.g. --color "#10a37f"'` strings
// in error suggestions, which are genuine example values for a caller-supplied
// colour and not rendering at all. Scoping to `components/` and `lib/` excludes
// them structurally. An allowance would have had to be maintained; a scope does
// not.
//
// D-26 step 3, injected on the real tree 2026-08-07:
//   - `#ff00ff` into components/chips.tsx      → red, naming file and line
//   - the same string inside a `//` comment    → GREEN, which is the point
//   - stripComments removed from this file     → red on chips.tsx line 15, i.e.
//     on the documentation, which is the failure this design avoids

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Where colour is allowed to be decided. One file, and that is the rule. */
const PALETTE = join(APP_ROOT, 'lib', 'pipeline.ts')

/** Rendering code only. `app/api/**` is excluded by scope — see the header. */
const SCANNED = [join(APP_ROOT, 'components'), join(APP_ROOT, 'lib')]

const HEX = /#[0-9a-fA-F]{6}\b/

/**
 * Strip block and line comments. The header explains why this is load-bearing
 * rather than tidy: without it this guard reports the comment that explains it.
 *
 * Crude, and the crudeness is safe in this direction: over-stripping can only
 * ever HIDE a hex, and a hex inside a string that looks like a comment is not a
 * colour anyone is rendering.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('one palette (D-4)', () => {
  const files = SCANNED.flatMap((d) => walk(d)).filter((f) => f !== PALETTE)

  // Assert the input. A walk that found nothing passes every assertion below.
  it('found files to scan (guards against a vacuous pass)', () => {
    expect(files.length, `no .ts/.tsx found under ${SCANNED.join(', ')}`).toBeGreaterThan(30)
    expect(
      HEX.test(stripComments(readFileSync(PALETTE, 'utf8'))),
      `${PALETTE} declares no hex colours — is this still the palette?`
    ).toBe(true)
  })

  it('no colour is decided outside lib/pipeline.ts', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      src.split('\n').forEach((line, i) => {
        const m = HEX.exec(line)
        if (m) offenders.push(`${file.slice(APP_ROOT.length + 1)}:${i + 1}  ${m[0]}`)
      })
    }
    expect(
      offenders,
      'these files decide a colour themselves. Colour belongs to lib/pipeline.ts, ' +
        'reached through its six *Color helpers — D-4 is that sales must not feel ' +
        `like issues, and it is only a table of hex values in one file:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
