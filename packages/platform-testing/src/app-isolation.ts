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
import { basename, dirname, join, resolve, sep } from 'node:path'

const SOURCE_EXT = /\.(ts|tsx)$/
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'migrations'])

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
  file: string
  schema: string
  line: string
}

/**
 * References to another app's Postgres schema in SQL strings.
 *
 * Matches `<schema>.` inside a template literal or string — `FROM issues.issues`,
 * `issues.attachments`. Deliberately crude: false positives are cheap to
 * whitelist by renaming a variable, and the failure it catches (an app reading
 * another app's tables) is one the per-app Postgres role would refuse in
 * production but a shared local credential would happily allow.
 *
 * `ownSchemas` are the schema names this app legitimately uses — its own, plus
 * `platform`.
 */
export function findCrossSchemaQueries(
  appRoot: string,
  otherSchemas: readonly string[]
): CrossSchemaQuery[] {
  const out: CrossSchemaQuery[] = []
  for (const file of sourceFiles(resolve(appRoot))) {
    const src = readFileSync(file, 'utf8')
    for (const schema of otherSchemas) {
      // Word boundary before, so `myissues.foo` does not match `issues.`.
      const re = new RegExp(`(^|[^\\w.])${schema}\\.[a-z_]+`, 'g')
      for (const line of src.split('\n')) {
        // Comments are prose about other apps, which is normal and useful.
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
        if (re.test(line)) out.push({ file: basename(file), schema, line: trimmed })
        re.lastIndex = 0
      }
    }
  }
  return out
}

/** True when `p` exists and is a directory. */
export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
