// Every app must have its OWN Drizzle migration ledger.
//
// ---------------------------------------------------------------------------
// THE FAILURE THIS EXISTS TO STOP, WHICH IS THE WORST SHAPE THIS PLATFORM HAS
// ---------------------------------------------------------------------------
// Every app on this platform shares ONE database (docs/adding-an-app.md step 8:
// one Neon project, one Blob store, per-app schemas). Drizzle's migrator decides
// what to apply like this — `drizzle-orm/pg-core/dialect.js`:
//
//     select id, hash, created_at from <schema>.<table> order by created_at desc limit 1
//     for (const m of migrations)
//       if (!lastDbMigration || Number(lastDbMigration.created_at) < m.folderMillis)
//         apply(m)
//
// A single high-water mark over the WHOLE table, with **no notion of which app
// wrote a row**. Two apps on one ledger therefore means: whichever migrated last
// raises the mark for both, and the other app's next migration is skipped. No
// error. No ledger row. **Exit 0.** And the same comparison skips it again on
// every subsequent run, so it never self-heals — it surfaces as missing tables
// in production, not as a red build.
//
// Reproduced on 2026-08-07 rather than inferred: two throwaway migration folders
// against one ledger, the earlier-stamped one ran, reported success, and created
// nothing.
//
// It nearly landed for real. `apps/sales` 0002 carries twenty-two blob-reference
// triggers and the `maintains_blob_index` flag; silently skipping it would have
// left the app registered and claiming an index it does not maintain.
//
// ---------------------------------------------------------------------------
// WHY A GUARD RATHER THAN A LINE IN THE CHECKLIST
// ---------------------------------------------------------------------------
// The fix in `apps/sales/drizzle.config.ts` protects sales and nobody else. App
// #3 copies a config, keeps a table name it did not think about, and collides —
// and the person who most needs the checklist line is the person who did not
// read it. This runs in `npm test`.
//
// ---------------------------------------------------------------------------
// WHY THIS READS THE CONFIG AS TEXT, WHICH IS NORMALLY THE WRONG ANSWER HERE
// ---------------------------------------------------------------------------
// `app-isolation.ts`'s header is a long argument against matching strings when
// you could resolve something instead, and it is right. This case genuinely
// cannot: `drizzle.config.ts` calls `defineConfig({...})` and THROWS at import
// time when `DATABASE_URL` is unset, which is every CI run and every developer
// who has not set one up. Importing it is not available.
//
// So the extraction is textual, and the honesty is in the failure mode:
//
//   - comments are stripped first, or this file's own explanation of
//     `__drizzle_migrations` would be read as a declaration;
//   - a config with NO `migrations` block resolves to drizzle's defaults, which
//     is the SAFE direction — it makes a collision more likely to be reported,
//     never less;
//   - a config WITH a `migrations` block whose `table`/`schema` is not a plain
//     string literal is reported as UNREADABLE and fails, rather than being
//     quietly treated as the default. Guessing there could hide a real
//     collision, and that is the one thing this must never do.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS GUARD MATCHES TEXT. READ THIS BEFORE YOU CHANGE A PATTERN IN IT. (D-42)
// ═══════════════════════════════════════════════════════════════════════════
// **The granularity of a text scan is part of what it checks**, and this repo
// has found five guards inert for exactly that reason — every one of them
// looking like working protection:
//
//   #4  three globs that matched none of the imports that actually escape an
//       app, and that SURVIVED THEIR OWN DIAGNOSIS, still green on the real
//       shape four days later, sitting beside the working replacement
//   #9  a substring match over six hand-written strings, which passed a topic
//       containing an entire stale vocabulary and banned the CORRECT spelling
//   #11 a scan of whole FILES, so one component vouched for two others; then
//       rewritten to match the WORD `focus`, which `const focus = null`
//       satisfies. Two inert versions in one sitting
//   #13 an import regex that knew `import` and `from` but not `require` — the
//       one spelling of "reach into another app" that does not say *import*
//
// And a sixth mechanism that is not about patterns at all: **a correct change
// can silently retarget an assertion** (#10). When you widen or rename a value,
// grep for what asserts on it; the diff that breaks a guard rarely touches the
// guard.
//
// TWO RULES FOR CHANGING ANYTHING BELOW:
//   1. Break the thing this guards, watch it go red, restore. A pattern you have
//      not watched fail is not a pattern.
//   2. Keep the input assertion. A scan that finds nothing must FAIL, not pass —
//      every "did we find anything to check?" case in this repo exists because a
//      guard that found nothing would otherwise report success.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Drizzle's defaults, from `drizzle-orm/pg-core/dialect.js`. */
export const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations'
export const DEFAULT_MIGRATIONS_SCHEMA = 'drizzle'

const CONFIG_NAMES = ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs']

export interface AppLedger {
  /** App directory name under `apps/`. */
  dir: string
  /** Repo-relative path to the config that was read. */
  config: string
  schema: string
  table: string
  /** True when the value came from drizzle's default rather than the config. */
  defaulted: boolean
  /**
   * Set when the config declares a `migrations` block this cannot read — a
   * variable, a template literal, a spread. NEVER guessed around: an unreadable
   * declaration is a failure, because assuming the default could hide a real
   * collision.
   */
  unreadable?: string
}

/** Strip `//` and block comments, so prose about ledgers is not read as one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The body of the `migrations: { … }` object, or null.
 *
 * Brace-matched rather than regex-terminated, so a nested object inside the
 * block cannot truncate it and leave a key looking absent.
 */
function migrationsBlock(src: string): string | null {
  const m = /\bmigrations\s*:\s*\{/.exec(src)
  if (!m) return null
  let depth = 0
  const start = m.index + m[0].length - 1
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start + 1, i)
    }
  }
  return null
}

/** A quoted string literal for `key`, `undefined` if absent, `null` if unreadable. */
function literal(block: string, key: string): string | undefined | null {
  const present = new RegExp(`\\b${key}\\s*:`).test(block)
  if (!present) return undefined
  const m = new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`).exec(block)
  return m ? m[2] : null
}

/**
 * Which ledger each app under `appsRoot` will migrate into.
 *
 * Apps with no drizzle config are skipped — they have no migrations to collide.
 * `apps/_scaffold` is in that state today.
 */
export function appLedgers(appsRoot: string): AppLedger[] {
  const out: AppLedger[] = []
  for (const entry of readdirSync(appsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const found = CONFIG_NAMES.map((n) => join(appsRoot, entry.name, n)).find(existsSync)
    if (!found) continue

    const src = stripComments(readFileSync(found, 'utf8'))
    const block = migrationsBlock(src)
    const rel = `apps/${entry.name}/${found.slice(found.lastIndexOf('/') + 1)}`

    if (block === null) {
      out.push({
        dir: entry.name,
        config: rel,
        schema: DEFAULT_MIGRATIONS_SCHEMA,
        table: DEFAULT_MIGRATIONS_TABLE,
        defaulted: true,
      })
      continue
    }

    const table = literal(block, 'table')
    const schema = literal(block, 'schema')
    const bad = [
      table === null ? 'table' : null,
      schema === null ? 'schema' : null,
    ].filter(Boolean)

    out.push({
      dir: entry.name,
      config: rel,
      schema: schema ?? DEFAULT_MIGRATIONS_SCHEMA,
      table: table ?? DEFAULT_MIGRATIONS_TABLE,
      defaulted: table === undefined && schema === undefined,
      unreadable: bad.length
        ? `migrations.${bad.join(' and migrations.')} is not a plain string literal`
        : undefined,
    })
  }
  return out
}

/** `schema.table`, the thing that has to be unique across apps. */
export function ledgerKey(l: AppLedger): string {
  return `${l.schema}.${l.table}`
}

/** Apps sharing a ledger, keyed by `schema.table`. Empty when all are distinct. */
export function ledgerCollisions(ledgers: readonly AppLedger[]): Map<string, AppLedger[]> {
  const byKey = new Map<string, AppLedger[]>()
  for (const l of ledgers) {
    const k = ledgerKey(l)
    byKey.set(k, [...(byKey.get(k) ?? []), l])
  }
  return new Map([...byKey].filter(([, apps]) => apps.length > 1))
}
