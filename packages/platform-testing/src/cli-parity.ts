// The shared half of the CLI↔routes parity guard, so that every app runs the
// SAME check rather than a copy that drifts.
//
// ---------------------------------------------------------------------------
// WHY PARITY BECAME A PER-APP QUESTION IN PHASE 8
// ---------------------------------------------------------------------------
// With one app, "does the CLI claim a route that does not exist?" could be
// answered against one `app/api/**` tree. With two, `bk scaffold note list`
// legitimately claims a route that exists only in `apps/_scaffold`, and checking
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
//   DRIFT     "every route bk claims exists" considers commands from app X, plus
//             the `platform` commands whose route THIS APP ACTUALLY MOUNTS.
//
// ---------------------------------------------------------------------------
// THE PROPERTY, AND WHY IT IS TWO SENTENCES AND NOT ONE (2026-08-07)
// ---------------------------------------------------------------------------
//     A platform ROUTE is answered by the apps that mount it.
//     A platform COMMAND must be answerable by at least ONE app.
//
// The first is per-app and lives in `ownDriftScope` below. The second is
// repo-wide and lives in `collectPlatformMountCoverage`, asserted once in this
// package's own suite. **Neither is sufficient alone**, and the second is the
// one that keeps the first from being a hole: scope drift to what an app mounts
// and "nobody mounts it" becomes indistinguishable from "somebody else does".
//
// ── WHAT THIS REPLACED, AND WHY BOTH EARLIER MECHANISMS FAILED ───────────────
// There was a hand-set `hostsPlatformRoutes` boolean per app, meaning "put every
// platform command's claim into my drift check". It was retired here on
// 2026-08-07, along with the plan's ruling that an unmounted platform route
// should get a documented `EXCLUDED_PATHS` entry. Both were designed around the
// assumption that an app serving only PART of the platform surface is a
// temporary build-out state. **It is not.** Sales has no reason ever to serve
// `bk super-admin errors` (platform-wide data, any host answers), `bk inbox`
// (per-user, cross-workspace) or `bk storage list` (D-28: one ledger, one quota,
// same rows from any deployment). A permanent, legitimate subset is what the
// mechanism has to express, and neither of those could:
//
//   - an EXCLUSION pushes on COVERAGE (`real`), and an unmounted route is a
//     DRIFT failure. Excluding the path makes it worse: it removes the path from
//     the very set drift compares against.
//   - a BOOLEAN cannot express a subset. It is all of the platform surface or
//     none of it, and `mountedPlatformRoutes` is filesystem-derived, so mounting
//     one route (`/api/meta` is Class C and per-app, D-20) forced the flag true
//     and pulled in every platform claim at once.
//
// `mountedPlatformRoutes` survives the flag it used to police, because it is the
// derivation the new scope is built on rather than a check on a declaration.
// Read agent10's reasoning above before touching it: the hole the flag's
// self-check closed was "a declaration that quietly stops matching reality", and
// the answer here is to have no declaration at all.
//
// ── AND ONE FORM OF EXPORT THIS GUARD CANNOT SEE ────────────────────────────
// `methodsOf` reads a route's verbs with a regex over `export const GET = …`.
// A DESTRUCTURED or RE-EXPORTED method — `export const { GET } = handlers()`,
// `export { GET } from './x'` — serves traffic identically and matches nothing,
// so the route drops out of the coverage check while `next build` happily lists
// it. Verified on 2026-08-07 with a real route in `apps/sales`.
//
// The fix is not a better parser. It is `invisibleExports` below: the form is
// DETECTED and the app's suite fails naming the file, so an invisible hole
// becomes a stated rule — the trade this repo makes everywhere else.

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
}

/**
 * Every `route.ts` under a directory, recursively.
 *
 * ── A MISSING DIRECTORY IS AN ANSWER, NOT AN EXCEPTION ─────────────────────
 * This used to call `readdirSync` on a path that may not exist, so a BRAND-NEW
 * app — one copied from the scaffold before it has any routes, which is the
 * state every app is in for its first hour — got an ENOENT stack trace out of
 * `node:fs` instead of the assertion message written to teach it what was
 * wrong. The reader's first encounter with this repo's central guardrail was a
 * crash inside a dependency.
 *
 * Returning `[]` is safe here precisely BECAUSE the caller asserts its inputs:
 * `cli-parity.test.ts`'s first case fails on `real.size === 0` with a message
 * naming the directory it looked in. Swallowing the error would be dangerous in
 * a scan that had no such assertion — which is the general rule, and the reason
 * this comment exists rather than a bare `existsSync`.
 */
export function walkRoutes(dir: string): string[] {
  if (!existsSync(dir)) return []
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

// An export list — `export const { GET, POST } = …`, `export { GET } from …`,
// `export { handler as GET }`. All three are legal, all three serve traffic, and
// `methodsOf` sees none of them.
//
// **Anchored to the start of a line**, and that is not tidiness. The first
// version was not, and it flagged three route files in `apps/issues` whose only
// offence was a COMMENT explaining why they do not use the destructured form —
// the detector caught the documentation of its own rule. Stripping comments
// properly needs a tokenizer that understands quotes and template literals;
// anchoring needs nothing, because a route's exports are always top-level and a
// comment line never begins with `export`.
const EXPORT_LIST_RE = /^[ \t]*export\s+(?:const|let|var)?\s*\{([^}]*)\}/gm

/**
 * The HTTP methods a route file exports in a form this guard CANNOT SEE.
 *
 * Non-empty means the file is serving verbs that will not appear in `real`, so
 * the coverage check silently stops asking about them. That is not a
 * hypothetical: `packages/platform-api/src/routes/index.ts` has warned about the
 * destructured form for factories since it was written, and on 2026-08-07 a
 * hand-written route in `apps/sales` proved the hole is any route file at all —
 * `next build` listed the route, parity stayed green.
 *
 * **Deliberately a detector, not a parser.** Teaching `methodsOf` to follow a
 * destructuring means a second, weaker route-extractor to keep honest beside the
 * authoritative one. Naming the form and refusing it costs one line at each call
 * site and cannot itself drift.
 */
export function invisibleMethodExports(src: string): string[] {
  const found = new Set<string>()
  for (const m of src.matchAll(EXPORT_LIST_RE)) {
    const inside = m[1] ?? ''
    for (const method of HTTP_METHODS) {
      // Word-boundary match, so `export { GETTERS }` is not a finding and
      // `export { GET as POST }` reports both — either name could be the served
      // verb and the point is to refuse the form, not to resolve it.
      if (new RegExp(`\\b${method}\\b`).test(inside)) found.add(method)
    }
  }
  return [...found].sort()
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
  /**
   * Routes claimed by a command attributed to THIS APP — nothing else.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS SEPARATE FROM `ownClaims`, AND WHY IT IS THE INPUT ASSERTION
   * ---------------------------------------------------------------------------
   * `ownClaims` is a drift SCOPE: this app's own claims **plus** every platform
   * claim whose path this app happens to mount. That union is right for "what
   * must this app prove exists", and WRONG for "did route attribution work at
   * all" — because the platform half alone keeps it non-empty.
   *
   * That is not hypothetical. `apps/sales`' vacuous-pass assertion read
   * `ownClaims.length > 0` and was described in `docs/sales-app-plan.md` §10.2
   * row 4 as "the assertion that caught the `__routes` dedup bug — confirm it
   * still fires". On 2026-08-07 it was confirmed NOT to: deleting
   * `cli/internal/guide/topics/sales/` drops `bk __routes`' sales attribution
   * from 68 routes to 0, and the suite stayed green, because the seven PLATFORM
   * routes sales mounts kept the union non-empty.
   *
   * The widening that broke it was the same commit that retired
   * `hostsPlatformRoutes` (D-36). Nothing was wrong with that change except that
   * an assertion phrased in terms of the old, narrower set was left reading the
   * new, wider one — which is how a guard survives the edit that guts it.
   */
  appOwnClaims: CliRouteEntry[]
  /** Every route claimed by a `platform` command, whoever serves it. */
  platformClaims: CliRouteEntry[]
  /**
   * The platform-claimed paths this app actually has a route file for.
   *
   * Derived from the filesystem, never from a declaration. It used to exist to
   * CHECK a declaration (`hostsPlatformRoutes`); since 2026-08-07 there is no
   * declaration and this IS the drift scope — which is the stronger arrangement,
   * because a derivation cannot quietly stop matching reality.
   */
  mountedPlatformRoutes: string[]
  /**
   * Route files that export an HTTP method in a form `methodsOf` cannot see.
   *
   * `file` is repo-relative-ish (relative to `appRoot`) so the failure names
   * something a reader can open. Non-empty is a failure in the app's own suite —
   * see `invisibleMethodExports`.
   */
  invisibleExports: Array<{ file: string; url: string; methods: string[] }>
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
  const real = new Map<string, Set<string>>()
  const allPaths = new Set<string>()
  const invisibleExports: AppRoutes['invisibleExports'] = []
  for (const file of walkRoutes(join(inputs.appRoot, 'app', 'api'))) {
    const url = routeUrl(inputs.appRoot, file)
    const src = readFileSync(file, 'utf8')
    allPaths.add(url)
    // Excluded FIRST. An excluded route is one the caller has stated, with a
    // reason, is not reachable from the CLI — its methods are never compared
    // against anything, so how it exports them cannot hide a capability. The
    // real instance is `apps/issues`' NextAuth catch-all, which necessarily
    // writes `export { handler as GET, handler as POST }`.
    if (excludedPaths.has(url)) continue
    const hidden = invisibleMethodExports(src)
    if (hidden.length > 0) {
      invisibleExports.push({ file: relative(inputs.appRoot, file), url, methods: hidden })
    }
    real.set(url, new Set(methodsOf(src)))
  }

  const platformClaims = cli.routes.filter((r) => (r.app ?? inputs.appSlug) === PLATFORM)
  const mountedPlatformRoutes = [
    ...new Set(platformClaims.map((r) => r.path).filter((p) => allPaths.has(p))),
  ].sort()
  const mountedHere = new Set(mountedPlatformRoutes)

  // DRIFT SCOPE. An app answers for its own claims unconditionally, and for a
  // PLATFORM claim only where it actually serves that path.
  //
  // The conditional half is what lets an app serve a legitimate SUBSET of the
  // platform surface — the permanent state, not a build-out one, since sales has
  // no reason ever to serve `bk inbox` or `bk super-admin errors`. What it gives
  // up is the ability to notice a route NO app mounts, and that is picked up by
  // `collectPlatformMountCoverage` in this package's own suite. Removing either
  // one leaves a hole; they are one property in two halves.
  const ownDriftScope = (r: CliRouteEntry) => {
    const app = r.app ?? inputs.appSlug
    if (app === inputs.appSlug) return true
    return app === PLATFORM && mountedHere.has(r.path)
  }

  return {
    real,
    allPaths,
    claimed: new Set(cli.routes.filter(mine).map((r) => `${r.method} ${r.path}`)),
    ownClaims: cli.routes.filter(ownDriftScope),
    appOwnClaims: cli.routes.filter((r) => (r.app ?? inputs.appSlug) === inputs.appSlug),
    platformClaims,
    mountedPlatformRoutes,
    invisibleExports,
    cli,
  }
}

// ---------------------------------------------------------------------------
// The repo-wide half: is every platform command answerable by SOMEBODY?
// ---------------------------------------------------------------------------

/** One platform command's claim, and which app directories serve its path. */
export interface PlatformMount {
  method: string
  path: string
  command: string
  /** App DIRECTORIES (`issues`, `_scaffold`) with a route file at that path. */
  mountedBy: string[]
}

export interface PlatformMountCoverage {
  /** Every app directory that has an `app/api` tree, in listing order. */
  apps: string[]
  /** Every distinct route path across every app. The input, for assertion. */
  allRoutePaths: Set<string>
  /** One entry per distinct platform METHOD+PATH claim. */
  claims: PlatformMount[]
  /** The subset of `claims` no app serves. Non-empty is the failure. */
  unmounted: PlatformMount[]
}

/**
 * Which apps mount each route a `platform` command claims.
 *
 * This is the second half of the property in this file's header, and the reason
 * per-app drift can safely be scoped to what an app mounts: without it, "no app
 * serves `GET /api/inbox`" and "another app serves it" produce identical green.
 *
 * It walks `apps/*​/app/api` rather than taking a list, for the same reason
 * `package-isolation.ts` derives its slug list: a hand-maintained set of app
 * directories is wrong on the day app four lands, and its failure is silence.
 *
 * An app directory with no `app/api` is skipped rather than fatal — not every
 * directory under `apps/` has to be a Next.js app — which is why `apps` and
 * `allRoutePaths` are returned: the caller must assert they are non-empty before
 * trusting `unmounted`. A scan that found no apps reports perfect coverage.
 */
export function collectPlatformMountCoverage(inputs: {
  /** Absolute path to `apps/`. */
  appsRoot: string
  /** Absolute path to `cli/`. */
  cliDir: string
}): PlatformMountCoverage {
  const cli = loadCliRoutes(inputs.cliDir)

  const apps: string[] = []
  const allRoutePaths = new Set<string>()
  const byPath = new Map<string, string[]>()

  for (const entry of readdirSync(inputs.appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const appRoot = join(inputs.appsRoot, entry.name)
    if (!existsSync(join(appRoot, 'app', 'api'))) continue
    apps.push(entry.name)
    for (const file of walkRoutes(join(appRoot, 'app', 'api'))) {
      const url = routeUrl(appRoot, file)
      allRoutePaths.add(url)
      const list = byPath.get(url) ?? []
      if (!list.includes(entry.name)) list.push(entry.name)
      byPath.set(url, list)
    }
  }

  // Deduped by METHOD+PATH: two commands claiming the same route is one route to
  // mount, and reporting it twice would make the failure list read as worse than
  // it is.
  const seen = new Map<string, PlatformMount>()
  for (const r of cli.routes) {
    if (r.app !== PLATFORM) continue
    const key = `${r.method} ${r.path}`
    if (seen.has(key)) continue
    seen.set(key, {
      method: r.method,
      path: r.path,
      command: r.command,
      mountedBy: byPath.get(r.path) ?? [],
    })
  }
  const claims = [...seen.values()].sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)
  )

  return {
    apps,
    allRoutePaths,
    claims,
    unmounted: claims.filter((c) => c.mountedBy.length === 0),
  }
}
