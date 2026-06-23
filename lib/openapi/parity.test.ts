// Parity guard: the hand-authored OpenAPI spec must document every real route.
//
// Walks app/api/** for route handlers and asserts that every (path, method) is
// present in openApiSpec.paths, and that the spec contains no path/method that
// doesn't exist in code (drift). If you add or remove a route, update
// lib/openapi/spec.ts or this test fails.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openApiSpec } from './spec'

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

// True internals that are intentionally NOT in the public spec.
const EXCLUDED_PATHS = new Set([
  '/api/auth/{nextauth}', // NextAuth handler
  '/api/errors/client', // client-error beacon (telemetry)
  '/api/docs', // the docs viewer itself
  '/api/openapi.json', // the spec itself
  '/api/status/errors', // super-admin error triage is exposed via /api/super-admin/errors
  '/api/status/errors/{id}',
  '/api/upload/blob', // internal Vercel Blob client-upload token handshake (not a REST resource)
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name === 'route.ts') out.push(p)
  }
  return out
}

function routeUrl(file: string): string {
  return file
    .replace(/^app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[\.\.\.(\w+)\]/g, '{$1}')
    .replace(/\[(\w+)\]/g, '{$1}')
}

function methodsOf(src: string): string[] {
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(src)
  )
}

describe('OpenAPI spec ↔ routes parity', () => {
  const actual = new Map<string, Set<string>>()
  for (const file of walk('app/api')) {
    const url = routeUrl(file)
    if (EXCLUDED_PATHS.has(url)) continue
    actual.set(url, new Set(methodsOf(readFileSync(file, 'utf8'))))
  }

  const spec = new Map<string, Set<string>>()
  for (const [path, ops] of Object.entries(openApiSpec.paths)) {
    spec.set(
      path,
      new Set(Object.keys(ops as object).filter((k) => HTTP_METHODS.includes(k.toUpperCase() as never)).map((m) => m.toUpperCase()))
    )
  }

  it('documents every route + method (no missing coverage)', () => {
    const missing: string[] = []
    for (const [url, methods] of actual) {
      const specMethods = spec.get(url)
      if (!specMethods) {
        missing.push(`PATH ${url}`)
        continue
      }
      for (const m of methods) if (!specMethods.has(m)) missing.push(`${m} ${url}`)
    }
    expect(missing, `routes missing from lib/openapi/spec.ts:\n${missing.join('\n')}`).toEqual([])
  })

  it('describes only real routes (no drift)', () => {
    const extra: string[] = []
    for (const [url, methods] of spec) {
      const actualMethods = actual.get(url)
      if (!actualMethods) {
        extra.push(`PATH ${url}`)
        continue
      }
      for (const m of methods) if (!actualMethods.has(m)) extra.push(`${m} ${url}`)
    }
    expect(extra, `spec paths/methods with no matching route:\n${extra.join('\n')}`).toEqual([])
  })
})
