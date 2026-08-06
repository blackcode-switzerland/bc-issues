// Shared CLIENT helper for uploading a file.
//
// Two paths, chosen by what the server supports (memoized via GET /api/upload):
//   - Blob configured (production): upload **client-direct** to Vercel Blob via
//     /api/upload/blob. This bypasses the serverless ~4.5MB body limit, so files
//     up to MAX_UPLOAD_BYTES work in production.
//   - No Blob (local dev): POST multipart to /api/upload, which stores under
//     public/uploads.
//
// The only place a failed upload becomes a human-readable error.
//
// THE CAPS ARE NO LONGER DECLARED HERE. They moved to
// `@blackcode/platform-storage/limits` on 2026-08-06 with the upload routes
// themselves: there is one Blob store, so a size cap and a blocked content type
// are properties of the store rather than of the app that POSTed the bytes, and
// a second app needs both unchanged. Re-exported so every `@/lib/upload` import
// — including `lib/agent-meta.ts`, which serves them to `bk meta` — is
// untouched.
//
// The import is the `/limits` SUBPATH, not the package root, and that matters
// here specifically: this module runs in the BROWSER. The root barrel pulls in
// the Drizzle ledger and @vercel/blob's server half.

import { upload } from '@vercel/blob/client'
import { blobPathname } from '@blackcode/platform-storage/paths'
import {
  BLOCKED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
} from '@blackcode/platform-storage/limits'

export { BLOCKED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL }

// What the server told us about uploading: whether Blob is configured, and
// where this caller's files belong in the store. Memoized for the session — the
// answer only changes when the user switches workspace, and a full page
// navigation happens on that path.
interface UploadCapabilities {
  blob: boolean
  app: string
  workspace: string | null
}

let capabilities: UploadCapabilities | null = null

async function getCapabilities(): Promise<UploadCapabilities> {
  if (capabilities === null) {
    try {
      const res = await fetch('/api/upload')
      const json = res.ok ? await res.json() : null
      capabilities = {
        blob: Boolean(json?.blob),
        app: typeof json?.app === 'string' ? json.app : 'issues',
        workspace: typeof json?.workspace === 'string' ? json.workspace : null,
      }
    } catch {
      capabilities = { blob: false, app: 'issues', workspace: null }
    }
  }
  return capabilities
}

export async function uploadFile(file: File): Promise<string> {
  // Fail fast, before sending any bytes.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large — the maximum is ${MAX_UPLOAD_LABEL}`)
  }

  const caps = await getCapabilities()

  if (caps.blob) {
    // Client-direct to Blob; the token handshake hits /api/upload/blob. The
    // payload carries file metadata so the server can record the upload ledger
    // row (the workspace is resolved server-side from the active workspace).
    //
    // The PATH is built here because this flow gives the server no chance to
    // rewrite it (Phase 7) — `app` and `workspace` come from the same server
    // that will then check the prefix and refuse anything outside it, so client
    // and server cannot disagree about where a file goes.
    const blob = await upload(blobPathname(caps.app, caps.workspace, file.name), file, {
      access: 'public',
      handleUploadUrl: '/api/upload/blob',
      contentType: file.type || undefined,
      clientPayload: JSON.stringify({
        contentType: file.type,
        filename: file.name,
        size: file.size,
      }),
    })
    return blob.url
  }

  // Local dev fallback: multipart through the function.
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || 'Upload failed')
  }
  const json = await res.json()
  return json.url as string
}
