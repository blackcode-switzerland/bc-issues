// What the shared store will accept — the caps both upload paths enforce.
//
// ---------------------------------------------------------------------------
// WHY THESE ARE PLATFORM AND NOT AN APP'S
// ---------------------------------------------------------------------------
// There is ONE Blob store, with one token per deployment
// (docs/platform-architecture.md §4.1). A size cap or a blocked content type is
// a property of that store, not of the app that happened to POST the bytes — a
// second app needs both of these unchanged, which is the stated test for moving
// something into a package.
//
// They lived in `apps/issues/lib/upload.ts` until 2026-08-06 and moved with
// `/api/upload` (docs/sales-app-plan.md Phase 1b-C). That file re-exports them,
// so nothing that imported `@/lib/upload` changed.
//
// ---------------------------------------------------------------------------
// DEPENDENCY-FREE, AND THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------
// This module is imported by BROWSER code — an app's client-side `uploadFile`
// checks the size before sending a byte. It is therefore its own entry point
// (`@blackcode/platform-storage/limits`) and imports nothing. Importing it from
// the package root would drag the Drizzle ledger and `@vercel/blob` into the
// client bundle.
//
// The rule these follow is the one in `platform-api/src/limits.ts`: a limit is
// DECLARED once, IMPORTED by the route that enforces it, and SERVED by
// GET /api/meta (→ `bk meta`). The embedded `bk guide` never restates a number,
// so a cap can change without shipping a new CLI and can never disagree with the
// code enforcing it.

/**
 * The largest file the store accepts, in bytes.
 *
 * Enforced in three places, all reading this constant: the multipart route
 * (before storing), the client-direct handshake (`maximumSizeInBytes`, which
 * Blob enforces server-side during the upload), and the browser helper (which
 * fails before sending anything).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** The same cap, as humans read it. Served as `limits.upload_max_label`. */
export const MAX_UPLOAD_LABEL = '100MB'

/**
 * Content types the upload routes refuse (400 `file_type_not_allowed`).
 *
 * SVG is blocked because it can carry script. Everything else is accepted.
 * Served live as `media.blocked_mime_types` by GET /api/meta so no guide topic
 * has to claim "any file type" — which is exactly what drifted before.
 */
export const BLOCKED_UPLOAD_MIME_TYPES = ['image/svg+xml'] as const
