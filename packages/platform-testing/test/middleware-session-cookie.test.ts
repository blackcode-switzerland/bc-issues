// Every app's browser gate must look for THIS PLATFORM'S session cookie.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS GUARD MATCHES TEXT. READ THIS BEFORE YOU CHANGE THE PATTERNS. (D-42)
// ═══════════════════════════════════════════════════════════════════════════
// A guard that greps source is a guard whose granularity is part of what it
// checks, and this repo has found five of them inert for exactly that reason:
//
//   * #4  — three globs that matched none of the imports that actually escape
//           an app, and survived its own diagnosis for four days
//   * #9  — a substring match over six hand-written strings, which passed a
//           topic containing an entire stale vocabulary
//   * #11 — a scan of whole FILES, so one component vouched for two others; then
//           rewritten to match the WORD `focus`, which `const focus = null`
//           satisfies
//   * #13 — an import regex that knew `import` and `from` but not `require`
//
// The trap specific to a file like this one: **its own text contains the
// pattern it looks for.** Every string this guard searches for is written below
// in a comment, and a scanner pointed at its own directory would find them and
// report a clean pass over a repo where nothing is wired. Four such
// self-reference traps have been hit on this project. The mitigations here are
// that the scan is anchored to `apps/*/middleware.ts` — a fixed path that
// cannot include this file — and that `it('has apps to check')` fails when the
// list is empty, so a scan that finds nothing cannot report success.
//
// When you change a pattern below: break a real app's middleware, watch this go
// red, then restore. A pattern you have not watched fail is not a pattern.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// ═══════════════════════════════════════════════════════════════════════════
// `withAuth` verifies a session with `getToken`, which looks for a cookie named
// `next-auth.session-token` unless it is told otherwise. D-16 renamed this
// platform's cookie to `blackcode.session-token`. A middleware that omits
// `cookies` therefore looks for a cookie no deployment sets.
//
// It does not error. A user signs in successfully and is bounced back to
// `/login`, forever, with a 200 on every request and nothing in the logs. It was
// caught in `apps/sales` on 2026-08-07, before release, by signing in by hand —
// and it got there because `apps/_scaffold` had no middleware to copy, so the
// second app's was modelled on the app that had it wrong.
//
// The scaffold now has one. This is the half that does not depend on anyone
// noticing it.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const APPS_ROOT = join(REPO_ROOT, 'apps')

interface AppMiddleware {
  dir: string
  path: string
  source: string
}

/** Every `apps/*​/middleware.ts` that exists. Apps without one are not listed. */
function appMiddlewares(): AppMiddleware[] {
  const out: AppMiddleware[] = []
  for (const entry of readdirSync(APPS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    for (const name of ['middleware.ts', 'middleware.js', 'src/middleware.ts']) {
      const p = join(APPS_ROOT, entry.name, name)
      if (existsSync(p)) {
        out.push({ dir: entry.name, path: p, source: readFileSync(p, 'utf8') })
        break
      }
    }
  }
  return out
}

/** Source with `//` and block comments removed — so a MENTION is not a use. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const MIDDLEWARES = appMiddlewares()

describe("every app's browser gate reads this platform's session cookie", () => {
  // Assert the input. A scan that found no middleware would otherwise pass every
  // case below by iterating an empty list — the failure mode CLAUDE.md's second
  // corollary is about, and the one that makes `it.each([])` dangerous.
  it('has apps to check', () => {
    expect(
      MIDDLEWARES.map((m) => m.dir),
      `no apps/*/middleware.ts found under ${APPS_ROOT}. Either every app lost its ` +
        'middleware, or this scan is looking in the wrong place — both mean the ' +
        'cases below checked nothing.'
    ).not.toEqual([])
  })

  it.each(MIDDLEWARES)('apps/$dir passes cookies: sessionCookieConfig()', (mw) => {
    const code = stripComments(mw.source)

    // Only middleware that actually gates with `withAuth` is in scope. An app
    // may legitimately have middleware doing something else entirely, and this
    // guard has no opinion about that — but it says so out loud rather than
    // passing quietly, because "not applicable" and "correct" must not look the
    // same.
    if (!/\bwithAuth\s*\(/.test(code)) {
      process.stderr.write(
        `[middleware-session-cookie] apps/${mw.dir}/middleware.ts does not call ` +
          `withAuth — no browser session gate to check.\n`
      )
      return
    }

    expect(
      /\bsessionCookieConfig\s*\(/.test(code),
      `apps/${mw.dir}/middleware.ts calls withAuth() but never calls ` +
        'sessionCookieConfig(). Without `cookies: sessionCookieConfig()`, getToken ' +
        'looks for `next-auth.session-token` — a cookie no deployment on this ' +
        'platform sets since D-16 renamed it. Every sign-in will succeed and bounce ' +
        'straight back to /login, with a 200 on every request and nothing in the ' +
        'logs.\n' +
        'Copy the shape from apps/_scaffold/middleware.ts.'
    ).toBe(true)

    expect(
      /cookies\s*:\s*sessionCookieConfig\s*\(/.test(code),
      `apps/${mw.dir}/middleware.ts calls sessionCookieConfig() but does not pass ` +
        'it as withAuth\'s `cookies` option. Computing the config and not handing ' +
        'it to withAuth leaves the gate looking for the wrong cookie name, which ' +
        'is the same silent redirect loop as omitting it entirely.'
    ).toBe(true)
  })

  it.each(MIDDLEWARES)('apps/$dir imports it from the Edge-safe subpath', (mw) => {
    const code = stripComments(mw.source)
    if (!/\bsessionCookieConfig\s*\(/.test(code)) return

    // The barrel pulls in `tokens.ts` (node `crypto`) and, through
    // `password-reset.ts`, the whole of platform-db. Middleware runs on the Edge
    // runtime and cannot load any of it — so this fails the BUILD rather than
    // silently, which is why it is the weaker of the two checks here. It is
    // asserted anyway because the fix is non-obvious under time pressure, and
    // the error Next prints names a transitive module rather than this line.
    expect(
      /from\s+['"]@blackcode\/platform-auth\/session-cookie['"]/.test(code),
      `apps/${mw.dir}/middleware.ts must import sessionCookieConfig from ` +
        "'@blackcode/platform-auth/session-cookie' — the subpath, not the barrel. " +
        'The barrel reaches node:crypto through tokens.ts and password-reset.ts, ' +
        'which the Edge runtime cannot load.'
    ).toBe(true)
  })
})
