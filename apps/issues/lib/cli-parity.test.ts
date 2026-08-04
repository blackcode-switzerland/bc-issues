// Parity guard: every API route must be reachable from the `bk` CLI.
//
// This replaces lib/openapi/parity.test.ts. The old test asked "does a
// hand-written document describe every route?" — which protected a copy of the
// truth. Now that the CLI is the only supported interface, the question that
// actually matters is "can an agent DO this?" A route with no command is a
// capability nobody can use; a command claiming a route that doesn't exist is a
// broken command waiting to be called.
//
// Both halves are asserted here. The third half — that every leaf command
// declares SOMETHING — lives in Go (cli/internal/commands/routes_test.go),
// because that's where the command tree is.
//
// The CLI's claims come from `bk __routes`, which walks the cobra tree and
// prints each leaf's `routes` annotation. We prefer running it via `go run`; if
// Go isn't available (some CI images run only the JS suite) we fall back to
// cli/routes.json, which `make routes` emits as a build artifact.
//
// ---------------------------------------------------------------------------
// KNOWN BLIND SPOT — read this before trusting a green run
// ---------------------------------------------------------------------------
// This guard sees routes a COMMAND annotates. It does not see the client layer.
// A method in cli/internal/client/ that names a route which does not exist is
// invisible here as long as no command calls it.
//
// That is not hypothetical. `client.UpdateWorkspaceMemberRole` sent PATCH to
// /api/workspaces/{ws}/members/{userId} — a DELETE-only route — from the day it
// was written until Phase 5 deleted it, through every green run of this file.
// It is the second guardrail hole of the same shape (the first: `routes`
// annotations were optional until routes_test.go made them mandatory), and the
// shape is what matters: a guard that reads declarations cannot see code that
// declares nothing.
//
// Left open on purpose. Closing it means extracting routes a second way — by
// parsing c.get/c.postJSON/... call sites and their format strings — which is a
// weaker route-extractor to keep honest alongside the authoritative one. The
// annotations are the contract; an unreferenced client method is dead code, and
// dead code is a review concern. State the scope honestly instead: this file
// proves every route is reachable from `bk`, and every route a command CLAIMS
// exists. It proves nothing about code no command reaches.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

// This app lives at apps/issues; the CLI stays at the monorepo root. Resolve the
// root from this file rather than from cwd, so the test gives the same answer
// whether it is run by `npm test` at the root, by turbo, or by vitest inside the
// app directory. Getting this wrong makes the guard silently unable to find the
// CLI — which reads as "the CLI claims nothing", not as an error.
const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')
const CLI_DIR = join(REPO_ROOT, 'cli')

// Routes deliberately NOT reachable from the CLI. Each needs a reason — an
// unexplained entry here is how coverage quietly rots.
const EXCLUDED_PATHS = new Map<string, string>([
  // --- browser/session machinery ---
  ['/api/auth/{nextauth}', 'NextAuth handler — browser session machinery'],
  ['/api/auth/register', 'browser sign-up flow'],
  ['/api/auth/password-reset/request', 'browser password recovery'],
  ['/api/auth/password-reset/confirm', 'browser password recovery'],
  ['/api/me/password/request-otp', 'in-app password change; session-only by design'],
  ['/api/me/password/confirm', 'in-app password change; session-only by design'],
  ['/api/cli/authorize', 'the browser half of `bk login` — rendered for the user, not called by the binary'],

  // --- telemetry / status page ---
  ['/api/errors/client', 'client-error beacon (telemetry)'],
  ['/api/status', 'public health probe'],
  ['/api/status/errors', 'public status-page feed; triage is `bk super-admin errors`'],
  ['/api/status/errors/{id}', 'public status-page feed; triage is `bk super-admin errors`'],

  // --- retired surfaces (delete these entries when the 410 stubs go) ---
  ['/api/openapi.json', 'retired: 410 Gone deprecation stub'],
  ['/api/docs', 'retired: 410 Gone deprecation stub'],
])

// Individual METHOD+path pairs excluded where the rest of the path IS covered.
const EXCLUDED_OPERATIONS = new Map<string, string>([
  [
    'DELETE /api/me',
    'account deletion is irreversible and deliberately human-only (web UI, with confirmation)',
  ],
  [
    'PATCH /api/workspaces/{ws}/issues/reorder',
    'manual drag-and-drop ordering; meaningless outside the board UI',
  ],
  [
    'PATCH /api/workspaces/{ws}/projects/reorder',
    'manual drag-and-drop ordering; meaningless outside the board UI',
  ],
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

// `walk` yields absolute paths (it is anchored at APP_ROOT, not at cwd), so make
// the path app-relative before turning it into a URL. Doing this with
// path.relative rather than a `^app` regex means the result no longer depends on
// where the process was started from.
function routeUrl(file: string): string {
  return relative(APP_ROOT, file)
    .split(sep)
    .join('/')
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

interface CliRoutes {
  routes: Array<{ method: string; path: string; command: string }>
  commands_unannotated: string[]
}

// `go run` in a cold module cache can take a few seconds; the cached artifact is
// there for environments without a Go toolchain at all.
function loadCliRoutes(): CliRoutes {
  try {
    const raw = execFileSync('go', ['run', './cmd/bk', '__routes'], {
      cwd: CLI_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    return JSON.parse(raw)
  } catch {
    const artifact = join(CLI_DIR, 'routes.json')
    if (existsSync(artifact)) return JSON.parse(readFileSync(artifact, 'utf8'))
    throw new Error(
      'Cannot determine CLI route coverage: `go run ./cmd/bk __routes` failed and ' +
        'cli/routes.json is absent. Install Go, or run `make -C cli routes` to emit the artifact.'
    )
  }
}

describe('CLI ↔ routes parity', () => {
  const cli = loadCliRoutes()
  const covered = new Set(cli.routes.map((r) => `${r.method} ${r.path}`))

  // Every real route+method, minus the documented exclusions.
  const real = new Map<string, Set<string>>()
  for (const file of walk(join(APP_ROOT, 'app', 'api'))) {
    const url = routeUrl(file)
    if (EXCLUDED_PATHS.has(url)) continue
    real.set(url, new Set(methodsOf(readFileSync(file, 'utf8'))))
  }

  // Both sides of this guard are discovered by walking the filesystem, and both
  // paths are now computed from this file's location rather than from cwd. That
  // makes "found nothing" a real failure mode — and an empty set would make the
  // two coverage assertions below pass vacuously, reporting green while checking
  // nothing. Assert the inputs are non-empty before trusting any conclusion.
  it('discovers both sides (guards against a vacuous pass)', () => {
    expect(real.size, `no API routes found under ${join(APP_ROOT, 'app', 'api')}`).toBeGreaterThan(0)
    expect(
      cli.routes.length,
      `the CLI claims no routes at all — is ${CLI_DIR} the right directory?`
    ).toBeGreaterThan(0)
  })

  it('every leaf command declares its routes', () => {
    expect(
      cli.commands_unannotated,
      `these bk commands have no \`routes\` annotation:\n${cli.commands_unannotated.join('\n')}`
    ).toEqual([])
  })

  it('every API route is reachable from bk (no uncovered capability)', () => {
    const uncovered: string[] = []
    for (const [url, methods] of real) {
      for (const m of methods) {
        const op = `${m} ${url}`
        if (EXCLUDED_OPERATIONS.has(op)) continue
        if (!covered.has(op)) uncovered.push(op)
      }
    }
    expect(
      uncovered,
      'routes with no bk command — add one, or add a documented entry to ' +
        `EXCLUDED_PATHS / EXCLUDED_OPERATIONS in this file:\n${uncovered.join('\n')}`
    ).toEqual([])
  })

  it('every route the CLI claims actually exists (no drift)', () => {
    const drift: string[] = []
    for (const r of cli.routes) {
      const methods = real.get(r.path)
      if (!methods) {
        // Could be an excluded path the CLI legitimately touches (e.g. the blob
        // handshake inside `bk upload`) — check the raw filesystem before failing.
        if (!EXCLUDED_PATHS.has(r.path) && !pathExists(r.path)) {
          drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
        }
        continue
      }
      if (!methods.has(r.method)) {
        drift.push(`${r.method} ${r.path}  (claimed by ${r.command})`)
      }
    }
    expect(
      drift,
      `bk claims routes that do not exist — fix the \`routes\` annotation:\n${drift.join('\n')}`
    ).toEqual([])
  })

  it('every exclusion names a route that still exists', () => {
    const stale: string[] = []
    for (const [path, reason] of EXCLUDED_PATHS) {
      if (!pathExists(path)) stale.push(`${path} — "${reason}"`)
    }
    for (const [op, reason] of EXCLUDED_OPERATIONS) {
      const path = op.slice(op.indexOf(' ') + 1)
      if (!pathExists(path)) stale.push(`${op} — "${reason}"`)
    }
    expect(
      stale,
      `these exclusions point at routes that no longer exist — delete them:\n${stale.join('\n')}`
    ).toEqual([])
  })
})

// All route paths on disk, including the ones excluded above.
//
// Anchored at APP_ROOT like every other path in this file. It used to walk the
// relative 'app/api', which resolved only because vitest happens to run with
// cwd set to the app directory — the exact cwd dependence the header comment
// above claims to have removed. Run from the repo root it would have thrown
// ENOENT at import time; run from anywhere else that happened to have an
// app/api it would have compared against the wrong tree.
const allPaths = new Set(walk(join(APP_ROOT, 'app', 'api')).map(routeUrl))
function pathExists(p: string): boolean {
  return allPaths.has(p)
}
