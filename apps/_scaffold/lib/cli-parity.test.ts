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
  // There is no `hostsPlatformRoutes` to set, and that is one less thing to get
  // wrong when you copy this app (it was retired on 2026-08-07). Drift for a
  // PLATFORM command's route is scoped to the routes this app actually has a
  // file for, derived from the filesystem — so mounting `/api/me` puts that
  // route in your check and nothing else does, and forgetting to declare
  // anything is not a state you can be in.
  //
  // The other half — "is every platform command answerable by SOMEBODY?" — is
  // asserted once, for the whole repo, in packages/platform-testing's own suite.
  // Do not add a copy here: the failure "nobody serves GET /api/inbox" is not
  // your app's, and N copies of it tempt whoever hits it to fix their own.
  const { real, claimed, ownClaims, appOwnClaims, invisibleExports, cli } = collectAppRoutes(
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
      appOwnClaims.length,
      `no bk command is ATTRIBUTED to "${APP_SLUG}" — is the command group registered in cli/internal/commands/root.go, ` +
        'and does cli/internal/guide/topics/ have a directory named for this app? ' +
        'Route attribution comes from the guide section list.\n' +
        'This asserts on `appOwnClaims`, NOT `ownClaims`: the latter also counts every ' +
        'PLATFORM route this app mounts, which kept it non-empty with attribution ' +
        'totally broken. Watched fail 2026-08-07 — see the field\'s header.'
    ).toBeGreaterThan(0)
  })

  // A route can serve traffic and be INVISIBLE to the coverage check above:
  // `export const { GET } = handlers()` and `export { GET } from './x'` both
  // work and match none of the patterns `methodsOf` reads, so the route drops
  // out of the check while the app still serves it. Found on 2026-08-07 by
  // injecting one and watching `next build` list a route parity had stopped
  // seeing. Detected rather than parsed, deliberately — a second, weaker route
  // extractor beside the authoritative one is a worse trade than a stated rule.
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
