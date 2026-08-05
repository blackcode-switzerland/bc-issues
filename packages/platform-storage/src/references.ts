// The reference engine — the safety core of storage cleanup, made app-aware.
//
// A file uploaded through our pipeline is referenced by its URL appearing inside
// content: a description, a summary, a comment, an update body, an attachment
// row. Nothing tracks those references at write time — they live inside the text
// — so knowing whether a file is still in use means scanning the content.
//
// Before Phase 7 that scan was six hardcoded `issues.*` tables. It cannot stay
// that way: with more than one app, "still in use" is a question only every app
// can answer together, and `platform-storage` must never know what tables
// `apps/sales` defines. So the shape inverts — **each app registers a scanner**,
// and a file is deletable only when NO registered scanner claims it.
//
// ── THE THING TO UNDERSTAND BEFORE CHANGING ANY OF THIS ───────────────────────
//
// The old code's safety came from a property nobody had to maintain: it scanned
// everything, because everything was one app's tables. A registry breaks that
// property. "No scanner registered" now looks exactly like "no references
// found", and the caller of that answer calls Vercel Blob `del()`, which has no
// undo. A registry that fails open is a silent path to deleting a file somebody
// is still using.
//
// So this module FAILS CLOSED, in three specific ways:
//
//   1. Coverage is asserted against `platform.apps`, not against the registry.
//      Every enabled app must have a registered scanner or the answer is an
//      ERROR, never `false`. The authority for "which apps exist" is the
//      database, so an app that is deployed but whose scanner was never
//      registered cannot be silently skipped.
//   2. A scanner that throws propagates. It is never caught and downgraded to
//      "no references from that app" — an unreachable table must stop a delete,
//      not permit one.
//   3. An unknown URL counts as referenced.
//
// The consequence is deliberate and worth stating plainly: **once a second app
// is registered in `platform.apps`, blob deletion stops working in this
// deployment until that app's scanner is registered in this process.** That is
// the correct failure. One app's deployment cannot read another app's schema —
// its Postgres role has no grant (§4.3) — so it genuinely cannot prove a file is
// unreferenced, and a delete it cannot justify is a delete it must refuse.
// Making that work across deployments is a cross-app protocol, not a scan; it is
// out of Phase 7's scope and recorded as a carry-forward.

import { type SQL } from 'drizzle-orm'
import { listAppSlugs } from './apps'

/**
 * The narrow slice of a Drizzle client this module needs. Both `db` and a
 * transaction handle satisfy it, for either driver — the same shape
 * `platform-db`'s query helpers take.
 */
export interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>
}

/** One thing that references a stored file. */
export interface Reference {
  /** The app that owns the referencing row. */
  app: string
  /** App-defined kind: 'issue', 'comment', 'attachment', … */
  type: string
  /** Internal row id of the referencing entity. */
  id: number
  /** Workspace #number where one exists; null otherwise. */
  seq: number | null
  /** A short human label (title/name) where cheaply available. */
  label: string | null
  /** True when the referencing row is in the recycle bin (still restorable). */
  trashed: boolean
}

/** A reference as an app's scanner reports it — the app is filled in by us. */
export type ScannedReference = Omit<Reference, 'app'>

/**
 * What an app must provide to take part in storage cleanup.
 *
 * Both methods MUST include soft-deleted (trashed) rows: an item in the recycle
 * bin can be restored, so its files are still in use. Both MUST throw rather
 * than return an empty/false answer if they cannot complete — see the header.
 */
export interface ReferenceScanner {
  /** The app's slug, matching `platform.apps.slug`. */
  app: string
  /** url → references, for every content surface in one workspace. */
  scanWorkspace(db: Executor, workspaceId: number): Promise<Map<string, ScannedReference[]>>
  /** Does anything in this app, in ANY workspace, reference this url? */
  isUrlReferenced(db: Executor, url: string): Promise<boolean>
}

/** Raised when the registry cannot prove an answer. Never a "no references". */
export class ReferenceCoverageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceCoverageError'
  }
}

const scanners = new Map<string, ReferenceScanner>()

/**
 * Register an app's scanner. Idempotent per app slug — re-registering replaces,
 * so Next's dev-mode module reloading cannot accumulate duplicates.
 *
 * Registration must happen as an import side effect of any module that can
 * reach a delete path. In `apps/issues` that is `lib/storage.ts`, which every
 * caller imports instead of reaching into this package directly.
 */
export function registerReferenceScanner(scanner: ReferenceScanner): void {
  scanners.set(scanner.app, scanner)
}

/** Slugs with a scanner registered in this process. */
export function registeredScannerApps(): string[] {
  return [...scanners.keys()].sort()
}

/** Test-only: drop every registration. Never call this from app code. */
export function clearReferenceScanners(): void {
  scanners.clear()
}

/**
 * Throw unless every enabled app in `platform.apps` has a registered scanner.
 *
 * This is the gate that turns "nobody claimed it" into a fact rather than an
 * assumption. It runs before every reference answer — both the delete-time one
 * and the one the Storage page shows, because a count of 0 on that page is the
 * signal a human acts on.
 */
export async function assertScannerCoverage(db: Executor): Promise<void> {
  const enabled = await listAppSlugs(db, { enabledOnly: true })

  if (enabled.length === 0) {
    throw new ReferenceCoverageError(
      'no enabled app in platform.apps — refusing to answer a reference question with an empty registry'
    )
  }
  const missing = enabled.filter((slug) => !scanners.has(slug))
  if (missing.length > 0) {
    throw new ReferenceCoverageError(
      `no reference scanner registered for enabled app(s): ${missing.join(', ')}. ` +
        'Refusing to report references, because an unscanned app may still be using the file.'
    )
  }
}

/**
 * url → references[] for one workspace, across every registered app.
 *
 * Used by the Storage page and `bk storage list`. O(total content size) per app.
 * Scanners run concurrently; if any rejects, so does this.
 */
export async function computeWorkspaceReferences(
  db: Executor,
  workspaceId: number
): Promise<Map<string, Reference[]>> {
  await assertScannerCoverage(db)

  const map = new Map<string, Reference[]>()
  const results = await Promise.all(
    [...scanners.values()].map(async (scanner) => ({
      app: scanner.app,
      found: await scanner.scanWorkspace(db, workspaceId),
    }))
  )

  for (const { app, found } of results) {
    for (const [url, refs] of found) {
      const list = map.get(url) ?? []
      for (const ref of refs) list.push({ app, ...ref })
      map.set(url, list)
    }
  }
  return map
}

/**
 * The delete-time safety gate: does ANY app reference this url right now?
 *
 * Deliberately cross-workspace as well as cross-app — the same uploaded URL can
 * be copy-pasted between workspaces, and a blob anything still points at must
 * never be deleted. Every caller of `del()` goes through here first.
 */
export async function isUrlReferencedAnywhere(db: Executor, url: string): Promise<boolean> {
  if (!url) return true // unknown → treat as referenced (fail safe)
  await assertScannerCoverage(db)

  // Every scanner runs, and a rejection is not swallowed: Promise.all rejects on
  // the first failure and the caller must treat that as "cannot delete".
  const answers = await Promise.all(
    [...scanners.values()].map((scanner) => scanner.isUrlReferenced(db, url))
  )
  return answers.some(Boolean)
}
