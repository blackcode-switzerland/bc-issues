// Parity guard for THIS app: every route reachable from `bk`, every route `bk`
// claims real.
//
// The check itself lives in `@blackcode/platform-testing` so every app runs the
// same one. What belongs here is only what is specific to this app: its slug and
// its exclusions.
//
// COPY THIS FILE when you copy the app. It is the guardrail that makes "the CLI
// is the only supported interface" true rather than aspirational — a route with
// no command is a capability agents cannot reach, and a command naming a route
// that does not exist is a broken command waiting to be called.
//
// Note there are no exclusions below. Reach for one LAST: writing the `routes`
// annotations is what surfaces the holes, and in `apps/issues` only two
// exclusions turned out to be genuine product decisions. An unexplained
// exclusion is how coverage quietly rots, so every entry must carry a reason.
//
// ---------------------------------------------------------------------------
// THIS FILE IS RED ON PURPOSE UNTIL PHASE 4/5. DO NOT WEAKEN IT.
// ---------------------------------------------------------------------------
// Phase 2 scaffolds the app; Phase 4 adds the `bk sales` command group and
// Phase 5 adds the HTTP routes. Until both exist, the FIRST assertion below —
// "discovers both sides" — fails with `no API routes found under
// apps/sales/app/api` and `no bk command belongs to "sales"`.
//
// That assertion exists precisely so an app cannot pass this guard by having
// nothing to check (CLAUDE.md finding #5: `bk __routes` deduped two apps into
// one, and only this assertion made it visible). Turning it off, adding a
// "skip if empty" branch, or deleting the file until the routes land would
// re-open the hole it was written to close — and would do so in the one window
// where nobody would notice, because there is nothing to check yet.
//
// It goes green when agent5 lands the routes and the command group. Nothing
// else about this file should change.

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAppRoutes } from '@blackcode/platform-testing'
import { APP_SLUG } from './app'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

/** Routes deliberately not reachable from the CLI. Each needs a reason. */
const EXCLUDED_PATHS = new Map<string, string>()

describe('CLI ↔ routes parity', () => {
  // There is no `hostsPlatformRoutes`, retired on 2026-08-07 — and this app is
  // why. It could not express "serves SOME of the platform surface", which is
  // this app's permanent state rather than a build-out one: sales will never
  // serve `bk inbox` (per-user, cross-workspace), `bk super-admin errors`
  // (platform-wide data, any host answers) or `bk storage list` (D-28: one
  // ledger, one quota, same rows from every deployment).
  //
  // Drift for a PLATFORM claim is now scoped to the routes this app actually has
  // a file for. Mount `/api/meta` and that route joins this check; nothing else
  // does. The other half — "is every platform command answerable by SOMEBODY?" —
  // is asserted once for the whole repo in packages/platform-testing's suite.
  const { real, claimed, ownClaims, invisibleExports, cli } = collectAppRoutes(
    { appRoot: APP_ROOT, cliDir: CLI_DIR, appSlug: APP_SLUG },
    new Set(EXCLUDED_PATHS.keys())
  )

  // Both sides are discovered by walking the filesystem, so "found nothing" is a
  // real failure mode — and an empty set makes the two assertions below pass
  // while checking nothing. Assert the inputs before trusting the conclusions.
  it('discovers both sides (guards against a vacuous pass)', () => {
    expect(real.size, `no API routes found under ${join(APP_ROOT, 'app', 'api')}`).toBeGreaterThan(0)
    expect(cli.routes.length, `the CLI claims no routes — is ${CLI_DIR} right?`).toBeGreaterThan(0)
    expect(
      ownClaims.length,
      `no bk command belongs to "${APP_SLUG}" — is the command group registered in cli/internal/commands/root.go, ` +
        'and does cli/internal/guide/topics/ have a directory named for this app? ' +
        'Route attribution comes from the guide section list.'
    ).toBeGreaterThan(0)
  })

  // A route can serve traffic and be INVISIBLE to the coverage check above:
  // `export const { GET } = handlers()` and `export { GET } from './x'` both
  // work and match none of the patterns `methodsOf` reads, so the route drops
  // out of the check while the app still serves it. Found on 2026-08-07 by
  // injecting one INTO THIS APP — `next build` listed the route and parity
  // stayed green. Detected rather than parsed, deliberately: a second, weaker
  // route extractor beside the authoritative one is a worse trade than a rule.
  it('exports every handler in a form the guard can see', () => {
    const found = invisibleExports.map(
      (e) => `${e.file} exports ${e.methods.join(', ')} via an export list`
    )
    expect(
      found,
      'these route files export an HTTP method in a form this guard CANNOT SEE. ' +
        'Write `export const GET = …`, one line per method:\n' + found.join('\n')
    ).toEqual([])
  })

  it('every leaf command declares its routes', () => {
    expect(
      cli.commands_unannotated,
      `these bk commands have no \`routes\` annotation:\n${cli.commands_unannotated.join('\n')}`
    ).toEqual([])
  })

  it('every API route is reachable from bk (no uncovered capability)', () => {
    const uncovered: string[] = []
    for (const [url, methods] of real) {
      for (const m of methods) {
        if (!claimed.has(`${m} ${url}`)) uncovered.push(`${m} ${url}`)
      }
    }
    expect(
      uncovered,
      `routes with no bk command — add one, or add a documented EXCLUDED_PATHS entry:\n${uncovered.join('\n')}`
    ).toEqual([])
  })

  it('every route this app claims actually exists (no drift)', () => {
    const drift: string[] = []
    for (const r of ownClaims) {
      const methods = real.get(r.path)
      if (!methods || !methods.has(r.method)) {
        drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
      }
    }
    expect(
      drift,
      `bk claims routes that do not exist — fix the \`routes\` annotation:\n${drift.join('\n')}`
    ).toEqual([])
  })
})
