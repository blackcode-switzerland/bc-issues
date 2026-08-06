// The chart kit renders exactly what it rendered before it moved packages.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// D-12 moved `components/analytics/charts.tsx` to
// `packages/platform-ui/src/charts/` and re-themed its palette from CSS
// variables so a second app's colours can drive it. The requirement on that move
// was "the issues analytics page must look identical", and **nothing in this
// repo could have told you otherwise**: the charts are hand-rolled SVG with no
// snapshot, no story and no visual-regression suite. A themed-from-variables
// rewrite that shifts one colour, drops a gridline or rounds a coordinate
// differently is invisible to `npm test`, `tsc` and `eslint` alike.
//
// A screenshot diff would need a running app, a login and seeded data, and would
// be flaky on font rendering. This is the deterministic equivalent: render every
// component to static markup with frozen inputs and compare it, character for
// character, with markup captured from the pre-move implementation.
//
// ---------------------------------------------------------------------------
// HOW THE BASELINE WAS TAKEN, AND WHY THAT MATTERS
// ---------------------------------------------------------------------------
// `charts.baseline.json` was produced by running the `render()` below against
// the OLD `components/analytics/charts.tsx`, before a line of it changed, and
// committed alongside the move. It is a RECORDING, not a re-derivation —
// regenerating it from the new implementation would turn this file into an
// elaborate way of asserting that the code equals itself, which is the shape of
// half the inert guards in CLAUDE.md's table.
//
// **If you change a chart on purpose, this fails, and it is supposed to.**
// Regenerate with `npx tsx lib/charts-baseline.ts` from `apps/issues`, read the
// diff before committing it, and say in the message what moved.
//
// ---------------------------------------------------------------------------
// WHAT IT CANNOT SEE
// ---------------------------------------------------------------------------
// It compares MARKUP. A class name that no longer has a CSS rule behind it — the
// exact failure the `@source` fix in `app/globals.css` was about — produces
// identical markup and a different page. That gap is covered by
// `packages/platform-testing/test/ui-package-styling.test.ts`, and the two
// together are what make "identical" a checked claim rather than a careful look.
//
// It is written with `createElement` rather than JSX because the vitest configs
// in this repo include `**/*.test.ts` only. Widening that to `.tsx` for one file
// would change what every app's suite collects; this does not.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as charts from '@blackcode/platform-ui/charts'
import { render } from './charts-cases'

const baseline = JSON.parse(
  readFileSync(join(__dirname, 'charts.baseline.json'), 'utf8')
) as Record<string, string>

// ---------------------------------------------------------------------------
// THE ONE THING THAT LEGITIMATELY CHANGED, AND HOW IT IS STILL CHECKED
// ---------------------------------------------------------------------------
// The move replaced four hardcoded colours with four CSS variables, so the raw
// markup CANNOT be identical — `#22c55e` became `var(--chart-series-completed)`.
// The tempting move is to re-record the baseline and call it done, which throws
// away the only evidence of what the page used to look like.
//
// Instead the test resolves each token back through `app/globals.css` — the
// browser's job, done here — and compares the RESOLVED markup to the untouched
// recording. So the claim being checked is the real one: *with this app's token
// values, the kit renders exactly what it rendered before.* Change a value in
// globals.css and this goes red, which is precisely the regression a
// "themed-from-variables" rewrite is prone to and nothing else here would catch.
const GLOBALS = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8')

function tokenValues(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of GLOBALS.matchAll(/(--chart-series-[a-z]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim()
  }
  return out
}

const TOKENS = tokenValues()

function resolve(markup: string): string {
  return markup.replace(/var\((--chart-series-[a-z]+)\)/g, (whole, name: string) =>
    TOKENS[name] ?? whole
  )
}

describe('the chart kit is byte-identical to its pre-move rendering', () => {
  const actual = Object.fromEntries(
    Object.entries(render(charts)).map(([k, v]) => [k, resolve(v)])
  )

  // Assert the input, twice over. An empty token map would make `resolve()` a
  // no-op and every colour comparison fail loudly — that direction is safe. The
  // dangerous direction is a token map that resolves everything to the same
  // value, so the count is pinned to the kit's four series roles.
  it('read this app’s series tokens out of globals.css', () => {
    expect(Object.keys(TOKENS).sort()).toEqual([
      '--chart-series-activity',
      '--chart-series-completed',
      '--chart-series-created',
      '--chart-series-ideal',
    ])
    expect(new Set(Object.values(TOKENS)).size, 'two series roles share a colour').toBe(4)
  })

  // Assert the input. A baseline that lost its contents, or a `render()` that
  // stopped producing cases, would compare {} with {} and report a confident
  // green — the vacuous pass this repo keeps finding.
  it('the baseline and the render both have cases, and the same ones', () => {
    expect(Object.keys(baseline).length).toBeGreaterThan(20)
    expect(Object.keys(actual).sort()).toEqual(Object.keys(baseline).sort())
  })

  it.each(Object.keys(baseline))('%s', (key) => {
    expect(actual[key]).toBe(baseline[key])
  })
})
