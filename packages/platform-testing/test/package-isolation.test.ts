// Shared code may not name one app's Postgres schema.
//
// ---------------------------------------------------------------------------
// THE HOLE THIS CLOSES
// ---------------------------------------------------------------------------
// Every boundary check in this repo was pointed at an APP's tree, by that app's
// own test. `packages/platform-*` — the code every app imports — had none, and
// no package had a test runner at all.
//
// TypeScript already stops the import: `platform-db/src/schema.ts` holds the
// platform tables and nothing else, so shared code reaching for `issues` or
// `issueWatchers` does not compile. Watched: moving a sixth fan-out handler into
// `platform-db` produced `TS2305: Module './schema' has no exported member
// 'issueWatchers'`.
//
// Raw SQL walks straight past that, and raw SQL is a shape shared code already
// uses — `fanout-platform.ts` has one `tx.execute(sql\`…\`)` statement today.
// The failure mode is the worst one available: the issues role CAN read
// `issues.*`, so it works in the deployment where it was written, and the sales
// role cannot, so it 42501s in the one where it was not.
//
// ---------------------------------------------------------------------------
// TWO WAYS FOR THIS FILE TO BE VACUOUS, AND BOTH ARE ASSERTED
// ---------------------------------------------------------------------------
// A scan for zero schema names over zero files finds zero violations and reports
// a confident green. So the inputs are assertions, not assumptions: the derived
// slug list must be non-empty and must account for every app, and the file scan
// must have read something. CLAUDE.md names this as a corollary of the standing
// rule, and finding #5 — `bk __routes` silently dropping a claim — was caught by
// exactly such an assertion.

import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appSlugs,
  findCrossSchemaQueries,
  platformPackageSources,
  sourceFiles,
} from '../src/index'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS_ROOT = join(REPO_ROOT, 'apps')
const PACKAGES_ROOT = join(REPO_ROOT, 'packages')

const APPS = appSlugs(APPS_ROOT)
const SOURCES = platformPackageSources(PACKAGES_ROOT)

describe('the inputs — assert these first, or the check below is theatre', () => {
  it('derived an app slug for every app directory', () => {
    // Directories under apps/ that are real workspaces. An app without a
    // lib/app.ts would be missing from APPS and its schema would never be
    // looked for — silently, which is the failure this asserts away.
    const appDirs = readdirSync(APPS_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)

    expect(appDirs.length, 'no app directories found — is APPS_ROOT wrong?').toBeGreaterThan(0)
    expect(
      APPS.map((a) => a.dir).sort(),
      'every app must declare APP_SLUG in lib/app.ts. An app missing from this ' +
        'list has its Postgres schema excluded from the scan below, and nothing ' +
        'else would report that.'
    ).toEqual(appDirs.sort())
    for (const app of APPS) {
      expect(app.slug, `apps/${app.dir} declared an empty APP_SLUG`).not.toBe('')
    }
  })

  it('reads the slug rather than the directory name', () => {
    // The standing proof that the two differ, and the reason this cannot be a
    // directory listing: npm refuses a package name starting with `_`.
    const scaffold = APPS.find((a) => a.dir === '_scaffold')
    if (!scaffold) {
      // Not a silent skip: if the scaffold is ever removed, this premise has to
      // be replaced rather than quietly stop being checked.
      throw new Error(
        'apps/_scaffold is gone. It was the only app whose directory name and ' +
          'APP_SLUG differ, which is what proved this list is derived from the ' +
          'constant. Point this case at whatever now demonstrates that, or delete ' +
          'it deliberately.'
      )
    }
    expect(scaffold.slug).toBe('scaffold')
  })

  it('found platform packages, and read files in them', () => {
    expect(SOURCES.length, 'no packages/platform-*/src directories found').toBeGreaterThan(0)
    const files = SOURCES.flatMap((dir) => sourceFiles(dir))
    expect(
      files.length,
      'the scan read zero source files, so it could not have found a violation ' +
        'if one existed'
    ).toBeGreaterThan(0)
  })
})

describe('packages/platform-* names no app schema', () => {
  it.each(SOURCES)('%s', (src) => {
    const found = findCrossSchemaQueries(
      src,
      APPS.map((a) => a.slug)
    )
    expect(
      found.map((f) => `${relative(REPO_ROOT, f.path)}:${f.lineNumber} (${f.schema}) ${f.line}`),
      'shared code may name `platform.*` and nothing else. A package that reads ' +
        "one app's schema WORKS in that app's deployment — its Postgres role can " +
        'read it — and fails with 42501 in every other one. It works where you ' +
        'wrote it and breaks where you did not. If two apps need this data, it ' +
        'belongs in a platform table; see docs/platform-architecture.md §4.3.'
    ).toEqual([])
  })
})
