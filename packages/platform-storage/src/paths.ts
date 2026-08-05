// Where an app's files live inside the shared Blob store.
//
// One store, shared by every app, with a per-app path prefix
// (PLATFORM-ARCHITECTURE.md §4.1):
//
//     <app>/<workspace-slug>/<filename>
//
// The prefix buys three things: files stay attributable by looking at them,
// storage stays sortable as apps are added, and extracting an app one day is a
// prefix copy rather than a forensic exercise.
//
// It is NOT a security boundary. The Blob store has one token per deployment and
// nothing at the storage layer enforces which prefix a writer may use — the
// enforcement is `assertOwnPathname` below, called by the upload handshake
// before it mints a client token. Authority over what may be deleted is
// separate again and lives in references.ts.
//
// EXISTING FILES ARE NOT MOVED. Everything uploaded before this landed sits at
// the store root, and `platform.uploads.pathname` records where each one
// actually is. A path is a historical fact, not a derivation — never compute a
// blob's location from its app.

// Workspace segment used when an upload cannot be attributed to a workspace.
// Uploads are never rejected for lack of attribution (the ledger's workspace_id
// is nullable for the same reason), so they need somewhere to go.
export const UNATTRIBUTED_WORKSPACE = 'unattributed'

// Path segments must not introduce a directory of their own, escape upwards, or
// be empty. Anything else is replaced rather than rejected: an upload must not
// fail because a workspace slug or filename contained a slash. A single dot is
// left alone — file extensions are made of them.
function segment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '')
    .replace(/[/\\]+/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned.length > 0 ? cleaned : fallback
}

/**
 * The pathname a new upload should be written to.
 *
 * @param app            the writing app's slug (`platform.apps.slug`)
 * @param workspaceSlug  the owning workspace, or null when unattributable
 * @param filename       the (already sanitised) file name
 */
export function blobPathname(
  app: string,
  workspaceSlug: string | null | undefined,
  filename: string
): string {
  return [
    segment(app, 'unknown'),
    segment(workspaceSlug, UNATTRIBUTED_WORKSPACE),
    segment(filename, 'file'),
  ].join('/')
}

/** The prefix every one of `app`'s files sits under, trailing slash included. */
export function appPrefix(app: string): string {
  return `${segment(app, 'unknown')}/`
}

/**
 * Which app wrote a pathname, or null if it carries no app prefix.
 *
 * Returns null — not a guess — for the pre-Phase-7 files stored flat at the
 * root. Their attribution comes from `platform.uploads.app`, which the Phase 7
 * migration backfilled; inferring it from the path would invent a fact.
 */
export function appFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const path = pathname.replace(/^\/+/, '')
  const slash = path.indexOf('/')
  if (slash <= 0) return null
  return path.slice(0, slash)
}

/**
 * Throw if `pathname` belongs to an app other than `app`.
 *
 * Called server-side before a client-direct upload token is minted: the client
 * chooses the pathname in that flow (the Blob SDK gives the server no way to
 * rewrite it), so this is the only place a caller can be stopped from writing
 * into another app's prefix.
 *
 * ── WHY THIS IS LENIENT ABOUT UNPREFIXED PATHS ───────────────────────────────
 * It once demanded the prefix, and that took production down on 2026-08-05: the
 * `bk` CLI also uses the client-direct flow (`client.go` → `uploadViaBlob`) and
 * every *installed* binary sends a bare filename. Requiring the prefix rejected
 * every one of them — `bk upload`, `--file` embedding, `issue attach` — the
 * moment the deploy went live. The rule that was broken is the one that governs
 * every server change: **the new server must be backwards compatible with the
 * old clients that are still installed.** A client cannot be asked to know a
 * convention that shipped after it did.
 *
 * So an unprefixed path is ACCEPTED. Such a file lands flat at the store root —
 * exactly where every pre-Phase-7 file already sits — and stays correctly
 * attributed anyway, because `uploads.app` is stamped server-side by
 * `recordUpload` and never derived from the path.
 *
 * What is refused is a path under a DIFFERENT known app's prefix, which is the
 * thing this check exists for and which no legitimate client of ours ever sends.
 *
 * @param knownApps every slug in `platform.apps`. Enabled or not: a disabled
 *                  app's files are still its own.
 */
export function assertPathnameWritable(
  app: string,
  pathname: string,
  knownApps: readonly string[]
): void {
  if (!pathname || !pathname.trim()) {
    throw new Error('upload path must not be empty')
  }
  if (pathname.includes('..')) {
    throw new Error('upload path must not contain ".."')
  }
  if (pathname.startsWith(appPrefix(app))) return

  const owner = appFromPathname(pathname)
  if (owner && owner !== app && knownApps.includes(owner)) {
    throw new Error(`upload path belongs to another app ("${owner}/")`)
  }
  // Unprefixed, or a first segment that is not an app: an older client. Allowed.
}
