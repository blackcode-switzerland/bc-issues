// Shared client helper for uploading a file.
//
// Two paths, chosen by what the server supports (memoized via GET /api/upload):
//   - Blob configured (production): upload **client-direct** to Vercel Blob via
//     /api/upload/blob. This bypasses the serverless ~4.5MB body limit, so files
//     up to MAX_UPLOAD_BYTES work in production.
//   - No Blob (local dev): POST multipart to /api/upload, which stores under
//     public/uploads.
//
// Single source of truth for the size cap (also imported by the API routes) and
// the only place a failed upload becomes a human-readable error.

import { upload } from '@vercel/blob/client'

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '100MB'

// Cache the capability check for the session.
let blobEnabled: boolean | null = null
async function isBlobEnabled(): Promise<boolean> {
  if (blobEnabled === null) {
    try {
      const res = await fetch('/api/upload')
      blobEnabled = res.ok ? Boolean((await res.json()).blob) : false
    } catch {
      blobEnabled = false
    }
  }
  return blobEnabled
}

export async function uploadFile(file: File): Promise<string> {
  // Fail fast, before sending any bytes.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large — the maximum is ${MAX_UPLOAD_LABEL}`)
  }

  if (await isBlobEnabled()) {
    // Client-direct to Blob; the token handshake hits /api/upload/blob.
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/upload/blob',
      contentType: file.type || undefined,
      clientPayload: JSON.stringify({ contentType: file.type }),
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
