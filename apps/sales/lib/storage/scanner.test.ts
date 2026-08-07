// `SURFACES` and migration 0002's triggers are ONE list. This asserts it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FILE WAS CITED BEFORE IT EXISTED
// ═══════════════════════════════════════════════════════════════════════════
// `scanner.ts` said, in the header of the constant that decides which columns
// this app accounts for:
//
//     `scanner.test.ts` asserts the migration's `CREATE TRIGGER` statements
//     match it exactly.
//
// There was no such file, and no test anywhere asserted that property. The claim
// was written in the file CLAUDE.md names as sitting on the path between a code
// change and unrecoverable data loss, where a reader deciding whether a change
// is safe would take it at face value. Found on 2026-08-07 by
// `packages/platform-testing/test/cited-tests-exist.test.ts`, which was written
// because the same thing had already happened once with
// `entities.projection.test.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE PROPERTY MATTERS
// ═══════════════════════════════════════════════════════════════════════════
// Two things must agree about which columns can hold a file URL:
//
//   THE TRIGGERS  maintain `platform.blob_references` on every write. They are
//                 what makes the index impossible for a write path to forget.
//   THE SCANNER   re-derives the same answer for `bk super-admin blob-drift`,
//                 the reconciler that decides whether the index is trustworthy.
//
// Disagreement is silent and it is asymmetric:
//
//   column triggered, NOT scanned  -> blob-drift reports references it cannot
//                                     account for. Noisy, and safe.
//   column scanned, NOT triggered  -> a file embedded there is referenced by
//                                     nobody as far as the index is concerned,
//                                     so the delete gate permits deletion, and
//                                     blob-drift reports a clean index. **The
//                                     file is gone and nothing said so.**
//
// The second direction is why this is a test and not a code review note.
//
// ── IT MATCHES TEXT (D-42) ─────────────────────────────────────────────────
// It parses SQL with a regex, which is the family of guard this repo has found
// inert five times over — the granularity of the match is part of what it
// checks. Two mitigations: the parse asserts it found a non-zero number of
// triggers before comparing anything (a regex that stops matching would
// otherwise report a perfect match over an empty set), and the comparison is
// two-way, so neither side can quietly grow an entry the other lacks.
//
// Break it before you trust it: delete a column from one side, watch this go
// red, restore.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SURFACES } from './scanner'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const MIGRATION = join(APP_ROOT, 'lib', 'db', 'migrations', '0002_blob_reference_index.sql')

interface TriggerSpec {
  type: string
  mode: string
  columns: string[]
}

/**
 * Every `platform.blob_refs_sync(...)` call in the migration, as
 * (source_type, mode, columns).
 *
 * The function's arguments are ('<app>', '<type>', '<workspace column>',
 * '<mode>', '<column>'...) — the app and workspace column are not compared here
 * because `SURFACES` does not carry them; what this file is about is the set of
 * CONTENT COLUMNS, which is the half that can silently diverge.
 */
function triggersFromMigration(sql: string): TriggerSpec[] {
  const out: TriggerSpec[] = []
  const re = /platform\.blob_refs_sync\s*\(([^)]*)\)/g
  for (const m of sql.matchAll(re)) {
    const args = m[1]
      .split(',')
      .map((a) => a.trim().replace(/^'|'$/g, ''))
      .filter((a) => a.length > 0)
    if (args.length < 5) continue
    const [, type, , mode, ...columns] = args
    out.push({ type, mode, columns })
  }
  return out
}

const SQL = readFileSync(MIGRATION, 'utf8')
const TRIGGERS = triggersFromMigration(SQL)

const key = (t: { type: string; mode: string; columns: readonly string[] }) =>
  `${t.type} [${t.mode}] ${[...t.columns].sort().join(',')}`

describe('the scanner and migration 0002 are two renderings of one list', () => {
  // Assert the input. A regex that stopped matching would leave TRIGGERS empty,
  // and an empty set compared two ways round reports one difference per surface
  // — which looks like a real failure — but a future "fix" that made the
  // comparison one-way would then pass over nothing at all.
  it('parsed triggers out of the migration', () => {
    expect(
      TRIGGERS.length,
      `no platform.blob_refs_sync(...) calls found in ${MIGRATION}. Either the ` +
        'migration moved, or this regex stopped matching — both mean the ' +
        'comparison below is meaningless.'
    ).toBeGreaterThan(0)
  })

  it('has surfaces to compare against', () => {
    expect(SURFACES.length, 'SURFACES is empty').toBeGreaterThan(0)
  })

  it('every scanned surface has a trigger with the same columns', () => {
    const triggered = new Set(TRIGGERS.map(key))
    const missing = SURFACES.filter((s) => !triggered.has(key(s))).map(key)
    expect(
      missing,
      'these surfaces are SCANNED but have no matching trigger in 0002. This is ' +
        'the dangerous direction: a file embedded in one of these columns is ' +
        'referenced by nobody as far as platform.blob_references is concerned, so ' +
        'the delete gate permits deleting it and blob-drift reports a clean ' +
        'index.\n' +
        'Add the trigger in a NEW migration (0002 is already applied):\n' +
        missing.join('\n')
    ).toEqual([])
  })

  it('every trigger has a scanned surface with the same columns', () => {
    const scanned = new Set(SURFACES.map(key))
    const extra = TRIGGERS.filter((t) => !scanned.has(key(t))).map(key)
    expect(
      extra,
      'the migration installs triggers for these, and SURFACES does not list ' +
        'them. Safe but wrong: blob-drift will report references it cannot ' +
        'account for, on every run, until somebody stops believing the ' +
        'reconciler.\n' + extra.join('\n')
    ).toEqual([])
  })
})
