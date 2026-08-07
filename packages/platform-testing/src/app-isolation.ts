// Does this app reach into another app? Two ways to ask, because there are two
// ways to do it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT AN ESLINT RULE
// ---------------------------------------------------------------------------
// It was, and the rule did not work. `apps/issues/.eslintrc.json` forbade the
// patterns `**/apps/*/**`, `../../apps/*` and `../../apps/*/**` — and none of
// them match the import that actually reaches another app:
//
//     // in apps/_template/lib/foo.ts
//     import { APP_SLUG } from '../../issues/lib/app'   // ← allowed by all three
//
// Because the climb out of an app directory has no fixed depth (`../../` from
// `lib/`, `../../../` from `lib/db/queries/`), and because the segment `apps`
// does not appear in the specifier at all, a glob over the import STRING cannot
// express "resolves outside my own app". Only resolving it can. The eslint rule
// was watched to pass against exactly the import it exists to forbid, which is
// the most dangerous kind of guardrail: one that reports green.
//
// So this resolves each relative specifier against the importing file and asks
// where it lands. Depth-proof, alias-proof, and it cannot be satisfied by a
// clever path.
//
// The second check is the schema one: an app may hold a connection that could
// technically read another app's tables (a shared migrator credential, a local
// superuser), so the grant is not the only line of defence during development.
// A literal `issues.` in a SQL string inside `apps/sales` is a bug whether or
// not production would refuse it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

// `.sql` is here and `migrations` is NOT skipped, both since 2026-08-07.
//
// They used to be the other way round, and the pair of them meant an app's
// migrations directory was unscanned TWICE OVER — by extension and by directory.
// That is the worst possible place for a blind spot: a new app's blob-reference
// migration is written by copying `apps/issues/lib/db/migrations/0037`, which
// names `issues.issues`, `issues.tasks`, `issues.projects`,
// `issues.project_updates` and `issues.attachments` in eight places. A missed
// rename in that copy points a trigger at another app's table, and until this
// change nothing in the repo could see the file it was in.
//
// Skipping `migrations` cost nothing to give up, because the scan only ever
// looks for OTHER apps' schemas: an app's own migrations naming its own schema,
// or `platform.*`, produce no hit by construction.
const SOURCE_EXT = /\.(ts|tsx|sql)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist'])

/** Every source file under `dir`, recursively. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...sourceFiles(join(dir, entry.name)))
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

// `import x from 'y'`, `import 'y'`, `export … from 'y'`, `await import('y')`.
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

/**
 * Strip comments, so prose is not mistaken for code.
 *
 * Found the moment this was first run: the comment in THIS file explaining which
 * import the old eslint rule missed contains the words `import
 * '../../issues/lib/app'`, and the scanner dutifully reported the documentation
 * as a violation. A detector that flags its own explanation is a detector people
 * learn to override.
 *
 * Crude but adequate: a `//` or `/* *\/` sequence inside a string literal would
 * be over-stripped, which can only ever HIDE an import — and an import written
 * inside a string is not an import.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Every module specifier a file imports. */
export function importsOf(src: string): string[] {
  const out: string[] = []
  for (const m of stripComments(src).matchAll(IMPORT_RE)) out.push(m[1])
  return out
}

export interface CrossAppImport {
  file: string
  specifier: string
  /** The app directory it resolves into. */
  otherApp: string
}

/**
 * Relative imports that resolve into a sibling app.
 *
 * `appsRoot` is the directory holding every app (`<repo>/apps`). Any specifier
 * that resolves under a sibling of `appRoot` is a violation, whatever it looks
 * like as a string.
 */
export function findCrossAppImports(appRoot: string, appsRoot: string): CrossAppImport[] {
  const me = resolve(appRoot)
  const siblings = readdirSync(appsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && resolve(join(appsRoot, e.name)) !== me)
    .map((e) => ({ name: e.name, path: resolve(join(appsRoot, e.name)) }))

  const out: CrossAppImport[] = []
  for (const file of sourceFiles(me)) {
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue
      const target = resolve(dirname(file), spec)
      for (const sib of siblings) {
        if (target === sib.path || target.startsWith(sib.path + sep)) {
          out.push({ file, specifier: spec, otherApp: sib.name })
        }
      }
    }
  }
  return out
}

export interface CrossSchemaQuery {
  /** Basename, for a message about one app's own tree. */
  file: string
  /**
   * Absolute path.
   *
   * Added when this scanner was pointed at `packages/platform-*` as well as at
   * an app (2026-08-06): seven packages contain a `client.ts`, and a failure
   * naming only the basename tells you a rule was broken but not by whom.
   */
  path: string
  schema: string
  /** 1-indexed, so the failure message is somewhere you can jump to. */
  lineNumber: number
  line: string
}

/** One deliberate exception to the cross-schema scan. */
export interface SchemaQueryAllowance {
  /** Path relative to the scanned root, e.g. `lib/db/queries/qualified-type.test.ts`. */
  file: string
  /** The exact text that trips the scanner. Must still be present, or it is stale. */
  match: string
  /** Why this is not a cross-schema query. Required — an unexplained exclusion rots. */
  reason: string
}

export interface CrossSchemaScanInput {
  /** Directory to scan. */
  root: string
  /** Schemas belonging to OTHER apps. Never `platform`, never your own. */
  otherSchemas: readonly string[]
  /** Deliberate exceptions. Each is checked for staleness — see `stale`. */
  allow?: readonly SchemaQueryAllowance[]
}

export interface CrossSchemaScan {
  /** Real violations. */
  hits: CrossSchemaQuery[]
  /**
   * Allowances whose `match` no longer appears in `file`.
   *
   * ASSERT THIS IS EMPTY. A stale exclusion is coverage that was dropped and
   * then silently kept off — the file moved, the line was rewritten, and an
   * entry that once described something real now suppresses nothing while still
   * reading as a considered decision.
   */
  stale: SchemaQueryAllowance[]
  /** ASSERT THIS IS NON-ZERO. A scan over no files reports a confident green. */
  filesScanned: number
  /** ASSERT THIS IS NON-EMPTY. So does a scan for no schema names. */
  schemas: readonly string[]
}

/**
 * File extensions that make `<name>.<ext>` a FILENAME rather than a table.
 *
 * Deliberately omits `log`, `env`, `csv`, `key` and `data`: those are plausible
 * table names, and excluding a real table to catch a hypothetical filename is
 * the wrong side of this trade. See the header of `scanCrossSchemaQueries`.
 */
const FILE_EXT =
  /^(md|txt|ts|tsx|js|jsx|mjs|cjs|json|css|scss|sql|sh|go|ya?ml|toml|lock|png|jpe?g|svg|ico|html?|pdf)$/

/**
 * SQL that can introduce a schema-qualified table name. Used ONLY as a positive
 * override — see the header.
 */
const SQL_LEAD =
  'from|join|into|update|table|delete\\s+from|exists|only|truncate|analyze|references|copy'

/**
 * References to another app's Postgres schema, in SQL strings or anywhere else.
 *
 * The failure it catches is the nastiest shape available: an app reading another
 * app's tables WORKS locally against a shared superuser and 42501s in
 * production, where each app connects as its own bounded role. It works where
 * you wrote it and breaks where you did not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A BROAD MATCH MINUS TWO SHAPES, RATHER THAN A NARROW MATCH
 * ---------------------------------------------------------------------------
 * The original rule was `<schema>\.[a-z_]+` anywhere outside a comment. It is
 * blunt, and its own header said false positives were "cheap to whitelist by
 * renaming a variable".
 *
 * **That stopped being true on app #2, by construction.** Adding `sales` to
 * `apps/issues`' schema list produced four hits, and three of them were a
 * HOSTNAME or a FILE PATH — `sales.blackcode.ch`, `https://sales.blackcode.test/…`,
 * `docs/changelog/sales.md`. You cannot rename a hostname or a documented path.
 * A guard that has to be switched off to add an app is not a guard, and every
 * future app's slug will appear in a host and a path on day one.
 *
 * The obvious alternative — require a SQL keyword before the match — was
 * measured and REJECTED. It reaches zero false positives, but injecting the
 * regressions it would still pass on (D-26 step 3) found five real shapes it
 * loses:
 *
 *     const t = 'issues.issues'                     variable holding a table name
 *     sql.raw(`SELECT * FROM ${'issues.issues'}`)   interpolated
 *     `  issues.issues i`                           FROM wrapped to the line above
 *     pgTable('issues.attachments')                 not SQL text at all
 *     COPY issues.issues TO STDOUT                  keyword not in any sane list
 *
 * Neither form is a superset of the other, so this is the union: the broad match
 * decides, two GENERIC shapes are subtracted, a reasoned allowlist covers the
 * rest, **and a SQL keyword immediately before the match overrides every
 * exclusion** — because at that point it is unambiguously a query.
 *
 * The two generic subtractions, generic because they recur for every future app
 * and an allowlist entry per occurrence would be a tax:
 *
 *   HOSTNAME — the qualified name is followed by another `.` segment
 *              (`issues.blackcode.ch`). A schema-qualified table is not.
 *   PATH     — preceded by `/` or `\`, or the identifier is a file extension
 *              (`docs/changelog/sales.md`).
 *
 * **What that still passes on, stated rather than discovered later:** a
 * three-part reference `schema.table.column` reads as a hostname, and a table
 * whose name is a file extension (`issues.json`) reads as a filename. Both are
 * rescued whenever a SQL keyword precedes them, which is every ordinary query;
 * what is genuinely lost is a bare `'issues.json'` string with no keyword on its
 * line. That is the residual, and it is smaller than the four false positives
 * the previous rule produced on its second app.
 */
export function scanCrossSchemaQueries({
  root,
  otherSchemas,
  allow = [],
}: CrossSchemaScanInput): CrossSchemaScan {
  const base = resolve(root)
  const files = sourceFiles(base)
  const hits: CrossSchemaQuery[] = []

  for (const file of files) {
    const rel = relative(base, file)
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')

    for (const schema of otherSchemas) {
      // The capture is the qualified name itself; the leading class is a word
      // boundary that also refuses a preceding dot, so `myissues.foo` and
      // `a.issues.foo` do not match.
      const re = new RegExp(`(?:^|[^\\w.])(${schema}\\.([a-z_][a-z0-9_]*))`, 'g')
      const anchored = new RegExp(
        `\\b(?:${SQL_LEAD})\\s+(?:only\\s+)?"?${schema}"?\\s*\\.\\s*"?[a-z_][a-z0-9_]*"?`,
        'i'
      )

      lines.forEach((line, i) => {
        // Comments are prose about other apps, which is normal and useful. `--`
        // arrived with `.sql`: a migration's header legitimately explains which
        // issues table the shape was copied from.
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('--')) return

        const record = () =>
          hits.push({ file: basename(file), path: file, schema, lineNumber: i + 1, line: trimmed })

        // ── HALF ONE: a SQL keyword adjacent to the schema ──────────────────
        // Unconditional, and it is a real half of the union rather than only an
        // override: this is the ONLY half that sees `FROM "issues"."issues"`,
        // the quoted spelling `pg_dump` emits and Drizzle's logger prints. The
        // broad match below cannot — it requires a literal `issues.`, and the
        // quotes sit between.
        if (anchored.test(line)) {
          record()
          return
        }

        // ── HALF TWO: the broad match, minus the shapes that are not queries ─
        re.lastIndex = 0
        for (let m = re.exec(line); m; m = re.exec(line)) {
          const qualified = m[1]
          const ident = m[2]
          const start = m.index + m[0].length - qualified.length
          const end = start + qualified.length

          if (line[end] === '.') continue // hostname:  issues.blackcode.ch
          const before = start > 0 ? line[start - 1] : ''
          if (before === '/' || before === '\\') continue // path: docs/…/sales.md
          if (FILE_EXT.test(ident)) continue // filename: sales.md
          if (allow.some((a) => a.file === rel && line.includes(a.match))) continue

          record()
          break // one hit per line per schema is enough to fail
        }
      })
    }
  }

  // An allowance that no longer matches anything is coverage that was quietly
  // dropped. Reported rather than thrown, so it surfaces as a named test.
  const stale = allow.filter((a) => {
    try {
      return !readFileSync(join(base, a.file), 'utf8').includes(a.match)
    } catch {
      return true // the file is gone — the entry certainly is stale
    }
  })

  return { hits, stale, filesScanned: files.length, schemas: otherSchemas }
}

/**
 * Back-compatible shape: just the violations.
 *
 * Prefer `scanCrossSchemaQueries`, whose result carries the two things this one
 * cannot express — the input counts you must assert, and stale allowances.
 */
export function findCrossSchemaQueries(
  appRoot: string,
  otherSchemas: readonly string[],
  allow: readonly SchemaQueryAllowance[] = []
): CrossSchemaQuery[] {
  return scanCrossSchemaQueries({ root: appRoot, otherSchemas, allow }).hits
}

/** True when `p` exists and is a directory. */
export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
