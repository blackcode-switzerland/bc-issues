// This app stays inside its own boundary — enforced by resolution, not by a
// glob over import strings.
//
// COPY THIS FILE when you copy the app, and change `OTHER_SCHEMAS`.
//
// The eslint rule that used to cover the first half did not work: relative
// climbs out of an app have no fixed depth and the segment `apps` never appears
// in the specifier, so `import '../../issues/lib/app'` slipped through every
// pattern. See the header of platform-testing's app-isolation.ts.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCrossAppImports, findCrossSchemaQueries } from '@blackcode/platform-testing'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const APPS_ROOT = join(APP_ROOT, '..')

/** Postgres schemas belonging to OTHER apps. Never `platform`, never our own. */
const OTHER_SCHEMAS = ['issues']

describe('app isolation', () => {
  it('imports nothing from another app', () => {
    const found = findCrossAppImports(APP_ROOT, APPS_ROOT)
    expect(
      found.map((f) => `${f.file} → ${f.specifier} (apps/${f.otherApp})`),
      'an app may never import from another app. Only packages/platform-* is shared — ' +
        'if two apps need this code, extract it there. See PLATFORM-ARCHITECTURE.md §7.6.'
    ).toEqual([])
  })

  it('queries no other app schema', () => {
    const found = findCrossSchemaQueries(APP_ROOT, OTHER_SCHEMAS)
    expect(
      found.map((f) => `${f.file}: ${f.line}`),
      'an app may read and write `platform.*` and its own schema, nothing else. ' +
        'In production the per-app Postgres role refuses it outright (docs/sql/app-role.sql); ' +
        'this catches it before a shared local credential lets it work by accident.'
    ).toEqual([])
  })
})
