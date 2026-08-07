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
// ── PHASE 8: THE SECOND WAY AN APP CAN BE ANSWERED FOR ───────────────────────
//
// As Phase 7 shipped it, the only way to cover an app was to register its
// scanner in this process — which a *different deployment* can never do. One
// app's deployment cannot read another app's schema (its Postgres role has no
// grant, §4.3), so the moment a second row landed in `platform.apps`, blob
// deletion here would have stopped working entirely. Correctly, and uselessly.
//
// Phase 8 adds the missing half: `platform.blob_references`, an index each app
// maintains **from Postgres triggers on its own content tables**, which any
// deployment may read. So an enabled app is answerable when EITHER
//
//   (a) its scanner is registered here — authoritative, a live scan of the
//       real tables, and still what we use whenever it is available; or
//   (b) `platform.apps.maintains_blob_index` is true — its migration installed
//       the triggers, so the index speaks for it.
//
// Neither → still an ERROR, never a `false`. The gate did not loosen; it grew a
// second admissible proof. See `packages/platform-db/src/schema.ts` at
// `blobReferences` for why the index is maintained by triggers rather than by
// application code, which is the part that actually makes (b) safe.

import { type SQL } from 'drizzle-orm'
import { listEnabledAppCoverage } from './apps'
import { isUrlReferencedByIndex, listIndexedWorkspaceReferences } from './index-refs'

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

/** How each enabled app will be answered for, once coverage has been proven. */
export interface Coverage {
  /** Enabled apps whose scanner is registered here — scanned live. */
  scanned: string[]
  /** Enabled apps answered for through `platform.blob_references`. */
  indexed: string[]
}

/**
 * Throw unless every enabled app in `platform.apps` can be answered for, and
 * return how each one will be.
 *
 * This is the gate that turns "nobody claimed it" into a fact rather than an
 * assumption. It runs before every reference answer — both the delete-time one
 * and the one the Storage page shows, because a count of 0 on that page is the
 * signal a human acts on.
 *
 * A registered scanner WINS over the index even when both are available. The
 * scanner reads the live tables; the index is a projection, and a projection is
 * only ever consulted when the real thing is out of reach. That ordering is also
 * what makes `bk super-admin blob-drift` meaningful: the app that can do both
 * continuously proves the index right for the apps that cannot.
 */
export async function assertScannerCoverage(db: Executor): Promise<Coverage> {
  const enabled = await listEnabledAppCoverage(db)

  if (enabled.length === 0) {
    throw new ReferenceCoverageError(
      'no enabled app in platform.apps — refusing to answer a reference question with an empty registry'
    )
  }

  const scanned: string[] = []
  const indexed: string[] = []
  const missing: string[] = []
  for (const app of enabled) {
    if (scanners.has(app.slug)) scanned.push(app.slug)
    else if (app.maintains_blob_index) indexed.push(app.slug)
    else missing.push(app.slug)
  }

  if (missing.length > 0) {
    throw new ReferenceCoverageError(
      `no reference scanner registered, and no blob-reference index declared, for enabled app(s): ${missing.join(', ')}. ` +
        'Refusing to report references, because an unscanned app may still be using the file. ' +
        "Either register that app's scanner in this process, or run its migration that installs " +
        'the platform.blob_references triggers and sets platform.apps.maintains_blob_index.'
    )
  }
  return { scanned, indexed }
}

/**
 * url → references[] for one workspace, across every app.
 *
 * Used by the Storage page and `bk storage list`. O(total content size) per
 * locally-scanned app, one indexed query for all the rest. Scanners run
 * concurrently; if any rejects, so does this.
 *
 * Platform-owned content (comments) always comes from the index — see
 * `PLATFORM_REF_APP` — so it is accounted for even when a locally-registered
 * scanner also covers it. The duplicate is harmless: both say "referenced".
 */
export async function computeWorkspaceReferences(
  db: Executor,
  workspaceId: number
): Promise<Map<string, Reference[]>> {
  const coverage = await assertScannerCoverage(db)

  const map = new Map<string, Reference[]>()
  const add = (url: string, refs: Reference[]) => {
    const list = map.get(url) ?? []
    list.push(...refs)
    map.set(url, list)
  }

  const [scanned, indexed] = await Promise.all([
    Promise.all(
      coverage.scanned.map(async (app) => ({
        app,
        found: await scanners.get(app)!.scanWorkspace(db, workspaceId),
      }))
    ),
    listIndexedWorkspaceReferences(db, workspaceId, coverage.indexed),
  ])

  for (const { app, found } of scanned) {
    for (const [url, refs] of found) add(url, refs.map((ref) => ({ app, ...ref })))
  }
  for (const [url, refs] of indexed) add(url, refs)
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
  const coverage = await assertScannerCoverage(db)

  // Every scanner runs, and a rejection is not swallowed: Promise.all rejects on
  // the first failure and the caller must treat that as "cannot delete". The
  // index query is in the same Promise.all for the same reason — a failure to
  // read it is a failure to answer, never a "no".
  const answers = await Promise.all([
    ...coverage.scanned.map((app) => scanners.get(app)!.isUrlReferenced(db, url)),
    isUrlReferencedByIndex(db, url, coverage.indexed),
  ])
  return answers.some(Boolean)
}
