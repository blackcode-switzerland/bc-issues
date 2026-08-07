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
  // `hostsPlatformRoutes` means "I mount the platform route factories from
  // @blackcode/platform-api/routes" — since 2026-08-06 it is a property of what
  // an app SERVES, not of where the files happen to sit, and several apps may
  // set it (docs/sales-app-plan.md Phase 1b).
  //
  // Sales mounts none of them YET — it has no routes at all at Phase 2. It will:
  // `/api/me` is the first one the web foundation needs, and `/api/upload`,
  // `/api/tokens` and `/api/cli/authorize` follow. **Flip this to true in the
  // same change that mounts the first one**; the second assertion below is what
  // catches you if you don't, and it names the route you mounted.
  const HOSTS_PLATFORM_ROUTES = false
  const { real, claimed, ownClaims, mountedPlatformRoutes, cli } = collectAppRoutes(
    {
      appRoot: APP_ROOT,
      cliDir: CLI_DIR,
      appSlug: APP_SLUG,
      hostsPlatformRoutes: HOSTS_PLATFORM_ROUTES,
    },
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

  // The flag above decides whether platform commands' routes are checked here at
  // all, and a hand-set boolean that switches a check off is how a guard reads
  // green while examining nothing (CLAUDE.md's table of nine). So it is checked
  // against the filesystem rather than trusted: mount a platform route without
  // setting the flag and this fails, naming the route you mounted.
  it('sets hostsPlatformRoutes iff it actually mounts platform routes', () => {
    expect(
      HOSTS_PLATFORM_ROUTES,
      mountedPlatformRoutes.length > 0
        ? `this app mounts platform route(s):\n${mountedPlatformRoutes.join('\n')}\n` +
          'so set hostsPlatformRoutes to true — otherwise every platform command\'s claimed ' +
          'route goes unchecked here.'
        : 'this app mounts no platform routes, so hostsPlatformRoutes must be false — ' +
          'setting it would make this app report every platform route as drift.'
    ).toBe(mountedPlatformRoutes.length > 0)
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
