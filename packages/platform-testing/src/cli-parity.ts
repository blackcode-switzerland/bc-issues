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
//             — plus `platform` for each app that MOUNTS the shared platform
//             routes (`hostsPlatformRoutes`). Without that flag set anywhere,
//             every platform command's route would go unchecked by everybody,
//             which is the failure mode this whole file exists to prevent: a
//             guard that reads green because it checked nothing.
//
// ── WHAT `hostsPlatformRoutes` MEANS, AND WHAT IT USED TO MEAN ───────────────
// Until 2026-08-06 it meant "the shared routes physically live in MY app/api
// tree", and exactly one app could set it — `apps/issues`, because that is where
// they happened to sit. Phase 1b of docs/sales-app-plan.md moved them into
// `@blackcode/platform-api/routes` as factories, and every app now mounts the
// ones it serves. So the flag means **"I mount the platform route factories"**,
// and SEVERAL APPS MAY SET IT. Each checks the platform claims against its own
// tree, which is what makes an app that forgot a mount file go red on its own
// test instead of on somebody else's.
//
// The flag is not free-floating: `mountedPlatformRoutes` below derives, from the
// filesystem, whether an app actually serves any platform route. An app that
// does and says it does not is a test that has quietly stopped checking, so it
// is a failure — see the "sets hostsPlatformRoutes iff it mounts them" case in
// each app's cli-parity.test.ts. That is the only thing standing between this
// flag and the row in CLAUDE.md's table it would otherwise join.
//
// KNOWN GAP, and it belongs to whoever adds the second app rather than to this
// file: an app that mounts only SOME platform routes (docs/sales-app-plan.md
// splits them into Tier 1 before launch and Tier 2 after) will report the ones
// it has not mounted yet as drift. Sound, but it will be loud on the day sales
// lands, and the fix is a decision — mount the rest, or teach the flag about
// tiers — not something to guess at here.

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
   * True when this app MOUNTS the platform route factories from
   * `@blackcode/platform-api/routes`. Several apps may set it — see the header.
   *
   * Setting it puts every `platform` command's claimed route into this app's
   * drift check. Leaving it off when the app does serve platform routes is
   * itself a failure; `mountedPlatformRoutes` is how a test proves that.
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
  /** Every route claimed by a `platform` command, whoever serves it. */
  platformClaims: CliRouteEntry[]
  /**
   * The platform-claimed paths this app actually has a route file for.
   *
   * Derived from the filesystem, never from a declaration, because it exists to
   * check a declaration: an app with entries here that leaves
   * `hostsPlatformRoutes` off has silently excused every platform command's
   * route from its drift check, and nothing else would say so.
   */
  mountedPlatformRoutes: string[]
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

  const platformClaims = cli.routes.filter((r) => (r.app ?? inputs.appSlug) === PLATFORM)
  const mountedPlatformRoutes = [
    ...new Set(platformClaims.map((r) => r.path).filter((p) => allPaths.has(p))),
  ].sort()

  return {
    real,
    allPaths,
    claimed: new Set(cli.routes.filter(mine).map((r) => `${r.method} ${r.path}`)),
    ownClaims: cli.routes.filter(ownDriftScope),
    platformClaims,
    mountedPlatformRoutes,
    cli,
  }
}
