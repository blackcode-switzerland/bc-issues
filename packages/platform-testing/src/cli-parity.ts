// The shared half of the CLI↔routes parity guard, so that every app runs the
// SAME check rather than a copy that drifts.
//
// ---------------------------------------------------------------------------
// WHY PARITY BECAME A PER-APP QUESTION IN PHASE 8
// ---------------------------------------------------------------------------
// With one app, "does the CLI claim a route that does not exist?" could be
// answered against one `app/api/**` tree. With two, `bk _template note list`
// legitimately claims a route that exists only in `apps/_template`, and checking
// it against `apps/issues` reports drift that is not drift. The tempting fix —
// add an exclusion — would silence the check for that route forever, which is
// how coverage rots.
//
// So `bk __routes` now tags every claimed route with the app whose surface it
// belongs to, and each app checks its own half.
//
// ── THE ASYMMETRY, AND WHY IT IS DELIBERATE ──────────────────────────────────
// The two directions do not use the same set of commands:
//
//   COVERAGE  "every route in apps/<X> is reachable from bk" considers commands
//             from app X *and* from `platform`. A workspace or label route lives
//             in an app's tree but is reached by a bare verb.
//
//   DRIFT     "every route bk claims exists" considers commands from app X only
//             — plus `platform` for the ONE app that physically hosts the shared
//             routes (`hostsPlatformRoutes`). Without that flag on exactly one
//             app, every platform command's route would go unchecked by
//             everybody, which is the failure mode this whole file exists to
//             prevent: a guard that reads green because it checked nothing.
//
// When shared routes eventually move out of `apps/issues`, move the flag with
// them. If it is ever set on two apps, each will report the other's platform
// routes as drift — noisy, but loud, which is the right way for that mistake to
// surface.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'

export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

/** The platform's own section name, as `bk __routes` reports it. */
export const PLATFORM = 'platform'

export interface CliRouteEntry {
  method: string
  path: string
  command: string
  /** App slug, or `platform`. Absent from a pre-Phase-8 routes.json. */
  app?: string
}

export interface CliRoutes {
  routes: CliRouteEntry[]
  commands_unannotated: string[]
}

export interface ParityInputs {
  /** Absolute path to the app directory (the one containing `app/api`). */
  appRoot: string
  /** Absolute path to `cli/`. */
  cliDir: string
  /** This app's slug, matching `bk __routes`' `app` field. */
  appSlug: string
  /**
   * True for the app whose `app/api` tree physically holds the shared platform
   * routes. Exactly one app may set it — see the header.
   */
  hostsPlatformRoutes?: boolean
}

/** Every `route.ts` under a directory, recursively. */
export function walkRoutes(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkRoutes(p))
    else if (entry.name === 'route.ts') out.push(p)
  }
  return out
}

/**
 * The URL a route file serves.
 *
 * Anchored on `appRoot` rather than cwd, so the answer does not depend on
 * whether the suite was started by turbo, by npm at the root, or by vitest
 * inside the app directory. Getting this wrong makes the guard silently find
 * nothing — which reads as "the CLI claims nothing", not as an error.
 */
export function routeUrl(appRoot: string, file: string): string {
  return relative(appRoot, file)
    .split(sep)
    .join('/')
    .replace(/^app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[\.\.\.(\w+)\]/g, '{$1}')
    .replace(/\[(\w+)\]/g, '{$1}')
}

/** Which HTTP verbs a route file exports. */
export function methodsOf(src: string): string[] {
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(src)
  )
}

/**
 * Ask the CLI what it claims.
 *
 * Prefers `go run`; falls back to the `cli/routes.json` artifact for
 * environments with no Go toolchain. Never returns an empty result silently —
 * an empty claim set would make every assertion pass vacuously.
 */
export function loadCliRoutes(cliDir: string): CliRoutes {
  try {
    const raw = execFileSync('go', ['run', './cmd/bk', '__routes'], {
      cwd: cliDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    return JSON.parse(raw)
  } catch {
    const artifact = join(cliDir, 'routes.json')
    if (existsSync(artifact)) return JSON.parse(readFileSync(artifact, 'utf8'))
    throw new Error(
      'Cannot determine CLI route coverage: `go run ./cmd/bk __routes` failed and ' +
        'cli/routes.json is absent. Install Go, or run `make -C cli routes` to emit the artifact.'
    )
  }
}

export interface AppRoutes {
  /** url → the HTTP methods it exports, for every route under `app/api`. */
  real: Map<string, Set<string>>
  /** Every url on disk, INCLUDING ones the caller excludes. */
  allPaths: Set<string>
  /** Routes claimed by commands that may serve this app: app X + platform. */
  claimed: Set<string>
  /** Routes this app is responsible for proving exist. See the header. */
  ownClaims: CliRouteEntry[]
  cli: CliRoutes
}

/**
 * Read both sides of the comparison for one app.
 *
 * `excludedPaths` are dropped from `real` (they stay in `allPaths`, so an
 * exclusion pointing at a deleted route can still be detected as stale).
 */
export function collectAppRoutes(
  inputs: ParityInputs,
  excludedPaths: ReadonlySet<string> = new Set()
): AppRoutes {
  const cli = loadCliRoutes(inputs.cliDir)

  const mine = (r: CliRouteEntry) => {
    // A routes.json from before Phase 8 has no `app` field. Treating that as
    // "belongs to me" keeps an old artifact behaving exactly as it used to
    // rather than silently checking nothing.
    const app = r.app ?? inputs.appSlug
    return app === inputs.appSlug || app === PLATFORM
  }
  const ownDriftScope = (r: CliRouteEntry) => {
    const app = r.app ?? inputs.appSlug
    if (app === inputs.appSlug) return true
    return app === PLATFORM && Boolean(inputs.hostsPlatformRoutes)
  }

  const real = new Map<string, Set<string>>()
  const allPaths = new Set<string>()
  for (const file of walkRoutes(join(inputs.appRoot, 'app', 'api'))) {
    const url = routeUrl(inputs.appRoot, file)
    allPaths.add(url)
    if (excludedPaths.has(url)) continue
    real.set(url, new Set(methodsOf(readFileSync(file, 'utf8'))))
  }

  return {
    real,
    allPaths,
    claimed: new Set(cli.routes.filter(mine).map((r) => `${r.method} ${r.path}`)),
    ownClaims: cli.routes.filter(ownDriftScope),
    cli,
  }
}
