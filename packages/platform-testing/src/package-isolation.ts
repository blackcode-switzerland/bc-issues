// Does SHARED code reach into one app? The other half of the boundary.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT DID NOT UNTIL 2026-08-06
// ---------------------------------------------------------------------------
// `app-isolation.ts` asks whether an app escapes into another app. Both of its
// checks are pointed at an APP's tree, by that app's own test. Nothing was ever
// pointed at `packages/`, and no package had a test runner at all — so the most
// widely imported code in the repo was the only code with no boundary check on
// it.
//
// A TypeScript import cannot cross the line: `packages/platform-db/src/schema.ts`
// is the platform schema, so a shared file that reaches for `issues` or
// `issueWatchers` fails to compile on the import. That was verified by moving a
// sixth fan-out handler into `platform-db` and watching `tsc` reject it.
//
// **Raw SQL is not covered by that, and is the shape shared code already uses.**
//
//     await tx.execute(sql`SELECT reporter_id FROM issues.issues WHERE id = ${id}`)
//
// compiles, lints and tests clean. And the way it fails is the exact failure the
// whole per-app boundary exists to make impossible: the issues deployment's
// Postgres role CAN read `issues.*`, so it works where it was written, and the
// sales role cannot, so it 42501s where it was not. It works for the author and
// breaks for everyone else, in production, in the app nobody was testing.
//
// ---------------------------------------------------------------------------
// THE SLUG LIST IS DERIVED, NOT TYPED OUT
// ---------------------------------------------------------------------------
// A hand-maintained `['issues', 'template', 'sales']` is a list that is wrong on
// the day app four lands, and its failure is silence: the new app's schema is
// simply never looked for. So the names come from each app's own `APP_SLUG`,
// which is already the single source of truth for that string and says so in its
// own header.
//
// It cannot be inferred from the directory name, and `apps/_template` is the
// standing proof — directory `_template`, slug `template`, because npm refuses a
// package name starting with an underscore.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isDir } from './app-isolation'

/** One app's directory and the slug it declares. */
export interface AppSlug {
  /** Directory name under `apps/` — `_template`, not `template`. */
  dir: string
  /** `APP_SLUG`, which is also the app's Postgres schema name. */
  slug: string
}

// `export const APP_SLUG = 'issues'`. Anchored to the declaration rather than
// matched loosely, so a mention of APP_SLUG in prose cannot be read as one.
const APP_SLUG_RE = /^\s*export\s+const\s+APP_SLUG\s*=\s*['"]([^'"]+)['"]/m

/**
 * Every app's slug, read from `apps/*​/lib/app.ts`.
 *
 * An app directory with no `lib/app.ts`, or one whose `app.ts` declares no
 * `APP_SLUG`, is simply absent from the result — which is why the caller must
 * assert the list is non-empty rather than trusting it. A scan for zero schema
 * names finds zero violations and reports success.
 */
export function appSlugs(appsRoot: string): AppSlug[] {
  const out: AppSlug[] = []
  for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const appFile = join(appsRoot, entry.name, 'lib', 'app.ts')
    let src: string
    try {
      src = readFileSync(appFile, 'utf8')
    } catch {
      continue
    }
    const m = APP_SLUG_RE.exec(src)
    if (m && m[1]) out.push({ dir: entry.name, slug: m[1] })
  }
  return out
}

/**
 * The `src` directory of every `packages/platform-*` package.
 *
 * `src` rather than the package root on purpose: a package's `test/` directory
 * names app schemas as DATA — the fixture this guard's own test injects is a
 * literal `issues.issues` — and a scanner that flagged its own test would be a
 * scanner people learn to switch off. Restricting the scan by PATH rather than
 * by a filename filter keeps that boundary stated instead of hidden in a regex.
 */
export function platformPackageSources(packagesRoot: string): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('platform-'))
    .map((e) => resolve(join(packagesRoot, e.name, 'src')))
    .filter(isDir)
}
