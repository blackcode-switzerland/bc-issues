// Every platform command's route is served by at least ONE app.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT HAD TO ARRIVE IN THE SAME CHANGE
// ---------------------------------------------------------------------------
// The per-app parity guard used to put EVERY platform command's claim into the
// drift check of every app that set `hostsPlatformRoutes`. That was workable
// with one app hosting the whole shared surface and stopped being workable the
// moment a second app served a legitimate SUBSET of it — which is permanent, not
// transitional: `apps/sales` has no reason ever to serve `bk inbox` (per-user,
// cross-workspace), `bk super-admin errors` (platform-wide data, any host
// answers) or `bk storage list` (D-28: one ledger, one quota, same rows from
// every deployment).
//
// So per-app drift is now scoped to the platform routes an app ACTUALLY MOUNTS
// (`collectAppRoutes`'s `ownDriftScope`). On its own that is a hole with a nicer
// name than the one it replaced: scope drift to what an app mounts and "no app
// mounts this" becomes indistinguishable from "another app mounts it". Both
// produce green everywhere.
//
// This file is the other half. The property, in two sentences:
//
//     A platform ROUTE is answered by the apps that mount it.   ← per-app
//     A platform COMMAND must be answerable by at least ONE app. ← here
//
// It lives in this package rather than in an app because it is not any app's
// question: the failure "nobody serves `GET /api/inbox`" belongs to the repo.
// Putting it in each app would produce N copies of one failure and tempt whoever
// hits it to fix their copy.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectPlatformMountCoverage } from '../src/cli-parity'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS_ROOT = join(REPO_ROOT, 'apps')
const CLI_DIR = join(REPO_ROOT, 'cli')

const coverage = collectPlatformMountCoverage({ appsRoot: APPS_ROOT, cliDir: CLI_DIR })

describe('platform route coverage', () => {
  // Every number below is derived by walking the filesystem, and a walk that
  // finds nothing produces PERFECT coverage — zero claims unmounted, because
  // there are no claims. Assert the inputs before trusting the conclusion; this
  // is CLAUDE.md finding #5's shape, and it is the assertion that caught it.
  it('discovers apps, their routes, and the CLI claims (guards a vacuous pass)', () => {
    expect(
      coverage.apps.length,
      `no app directory under ${APPS_ROOT} has an app/api tree`
    ).toBeGreaterThan(1)
    expect(
      coverage.allRoutePaths.size,
      'no route files found across any app — the scan is pointed at the wrong place'
    ).toBeGreaterThan(0)
    expect(
      coverage.claims.length,
      `the CLI claims no platform routes — is ${CLI_DIR} right, and does \`bk __routes\` ` +
        'still tag bare verbs with "platform"?'
    ).toBeGreaterThan(0)
  })

  it('every platform command has a route somebody serves', () => {
    const orphans = coverage.unmounted.map((c) => `${c.method} ${c.path}  (claimed by ${c.command})`)
    expect(
      orphans,
      'these platform commands claim a route NO app mounts, so calling them 404s wherever ' +
        'they are pointed:\n' +
        orphans.join('\n') +
        '\n\nMount the route in an app that should answer for it, or delete the command. ' +
        `Apps scanned: ${coverage.apps.join(', ')}.`
    ).toEqual([])
  })

  // Not a correctness property — a route two apps both serve is normal and often
  // right (`/api/meta` is Class C and per-app by design, D-20). It is here so a
  // reader of a failing run can see the shape of the surface without going and
  // deriving it, and so a change that quietly moves every platform route into one
  // app is visible in the diff of this file's output rather than invisible.
  it('reports which apps answer for the platform surface', () => {
    const byApp = new Map<string, number>()
    for (const c of coverage.claims) {
      for (const app of c.mountedBy) byApp.set(app, (byApp.get(app) ?? 0) + 1)
    }
    const summary = [...byApp.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([app, n]) => `${app}=${n}`)
      .join(' ')
    console.info(
      `[platform-route-coverage] ${coverage.claims.length} platform claims; mounted by: ` +
        (summary || '(nobody)')
    )
    expect(byApp.size, 'no app mounts any platform route at all').toBeGreaterThan(0)
  })
})
