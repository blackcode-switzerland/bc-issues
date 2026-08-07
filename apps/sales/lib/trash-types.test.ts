// The binnable types are declared TWICE — once in Go, once in TypeScript — and
// this holds the two together.
//
// ---------------------------------------------------------------------------
// WHY TWO DECLARATIONS, AND WHY THAT IS NOT FIXABLE BY MOVING ONE
// ---------------------------------------------------------------------------
// `bk sales trash restore prospect:12` validates the type LOCALLY, before any
// HTTP call, so a typo costs nothing instead of a round trip — that is what
// `appverbs.Config.TrashTypes` is for, and the shared package cannot invent
// another app's nouns. The server's list is the one that decides what a bin can
// actually hold. Neither can be derived from the other at build time: the CLI
// ships as a binary that must work offline against any deployment.
//
// So they are two lists, and the failure modes are asymmetric and both bad:
//
//   in Go, not on the server   the binary accepts a `--type` the server rejects,
//                              and the caller learns it from a 400 halfway
//                              through a script
//   on the server, not in Go   a capability nobody can reach: the type exists,
//                              the bin holds it, and `bk` refuses to name it
//
// This test reads the Go source rather than shelling out to `bk`, because the
// question is about the DECLARATION and not about a running binary. It is the
// same direction `lib/cli-parity.test.ts` already reads in.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRASH_TYPES } from './db/queries/trash'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const GO_FILE = join(APP_ROOT, '..', '..', 'cli', 'internal', 'commands', 'sales', 'appverbs.go')

/** `var trashTypes = []string{"prospect", …}` — anchored to the declaration. */
const DECLARATION = /var\s+trashTypes\s*=\s*\[\]string\{([^}]*)\}/

function goTrashTypes(): string[] {
  const src = readFileSync(GO_FILE, 'utf8')
  const m = DECLARATION.exec(src)
  // A parse failure must be a FAILURE, not an empty list: an empty list compares
  // equal to nothing and would make this test pass by finding nothing to check.
  expect(m, `no \`var trashTypes = []string{…}\` in ${GO_FILE} — did it move or get renamed?`).not.toBeNull()
  return [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)
}

describe('trash types: the CLI and the server agree', () => {
  const fromGo = goTrashTypes()

  it('THE PREMISE: both lists were actually read', () => {
    expect(fromGo.length, 'parsed no types out of the Go declaration').toBeGreaterThan(0)
    expect(TRASH_TYPES.length, 'the server declares no binnable types').toBeGreaterThan(0)
  })

  it('declares the same set, in the same order', () => {
    // Order too, not just membership: the first entry is what `appverbs` uses in
    // its `e.g. prospect:42` help text, so a reordering silently changes what
    // every trash command's help suggests.
    expect(fromGo).toEqual([...TRASH_TYPES])
  })

  it('excludes `contact`, which has no #number to be addressed by', () => {
    // Not a restatement of the list — an assertion about the RULE that produced
    // it. A contact is binned and restored with its prospect and is never
    // addressed alone, so `contact:12` is not a ref anybody could type.
    expect(fromGo).not.toContain('contact')
    expect([...TRASH_TYPES]).not.toContain('contact')
  })
})
