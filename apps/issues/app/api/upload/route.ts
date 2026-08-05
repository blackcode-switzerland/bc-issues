import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, BLOCKED_UPLOAD_MIME_TYPES } from '@/lib/upload'
import { recordUpload } from '@/lib/db/queries/uploads'
import { attributeUpload } from '@/lib/storage/attribution'
import { blobPathname } from '@blackcode/platform-storage/paths'
import { APP_SLUG } from '@/lib/app'

const LOCAL_UPLOAD_DIR = 'public/uploads'

// Store under public/uploads, mirroring the Blob layout (`<app>/<ws>/<file>`) so
// local dev exercises the same paths production uses.
async function saveLocally(file: File, relativePath: string): Promise<{ url: string }> {
  const uploadsDir = resolve(process.cwd(), LOCAL_UPLOAD_DIR)

  // Insert the random suffix BEFORE the extension so the URL keeps a real file
  // extension (…-ab12cd34.pdf, not …pdf-ab12cd34) — the rich-text layer detects
  // media type from that extension. Mirrors Vercel Blob's addRandomSuffix.
  const suffix = randomBytes(4).toString('hex')
  const dot = relativePath.lastIndexOf('.')
  const finalName =
    dot >= 0
      ? `${relativePath.slice(0, dot)}-${suffix}${relativePath.slice(dot)}`
      : `${relativePath}-${suffix}`
  const destPath = resolve(uploadsDir, finalName)
  // Defense-in-depth against path traversal even though every segment is
  // sanitized upstream (blobPathname + the filename sanitizer below).
  if (!destPath.startsWith(uploadsDir + sep)) {
    throw new Error('Resolved upload path escapes uploads directory')
  }

  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, Buffer.from(await file.arrayBuffer()))
  return { url: `/uploads/${finalName}` }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) throw Errors.badRequest('no_file', 'Include a file in the form data under the "file" field')
  if (file.size > MAX_UPLOAD_BYTES) throw Errors.badRequest('file_too_large', `Maximum file size is ${MAX_UPLOAD_LABEL}`)
  // Block SVG due to XSS risk; allow everything else. The list is exported so
  // GET /api/meta can serve it live (media.blocked_mime_types) — the CLI guide
  // must never hardcode "any file type", which is what drifted before.
  if ((BLOCKED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw Errors.badRequest(
      'file_type_not_allowed',
      `${file.type} files are not allowed for security reasons`
    )
  }

  const timestamp = Date.now()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const filename = `${timestamp}-${sanitizedName}`

  // Attribution now happens BEFORE the bytes are stored, because the workspace
  // slug is part of the path (Phase 7). It still never throws: an upload that
  // cannot be attributed lands under the `unattributed` prefix rather than
  // failing.
  const workspaceField = formData.get('workspace')
  const workspace = await attributeUpload(
    user,
    typeof workspaceField === 'string' ? workspaceField : null
  )
  const targetPath = blobPathname(APP_SLUG, workspace.slug, filename)

  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)

  let url: string
  let pathname: string
  if (hasBlobToken) {
    const blob = await put(targetPath, file, { access: 'public', addRandomSuffix: true })
    url = blob.url
    pathname = blob.pathname
  } else if (process.env.NODE_ENV !== 'production') {
    // Local-dev fallback: store under public/uploads and serve via Next.js static.
    const local = await saveLocally(file, targetPath)
    url = local.url
    pathname = local.url
  } else {
    throw Errors.internal('Blob storage is not configured (set BLOB_READ_WRITE_TOKEN)')
  }

  // Record the upload in the ledger (best-effort: a ledger failure must never
  // fail the upload itself).
  try {
    await recordUpload({
      url,
      pathname,
      filename: file.name,
      size: file.size,
      mime_type: file.type || null,
      workspace_id: workspace.id,
      uploaded_by: user.id,
    })
  } catch (err) {
    console.error('[upload] ledger record failed (non-fatal):', err)
  }

  return NextResponse.json({
    url,
    filename: file.name,
    size: file.size,
    contentType: file.type,
  })
})

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  return NextResponse.json({
    message: 'Upload API endpoint',
    usage: 'POST with multipart/form-data containing a "file" field',
    maxSize: MAX_UPLOAD_LABEL,
    // The numeric cap. The old platform reference claimed this route returned a
    // `maxBytes` field — it never did, so nothing could act on the limit
    // programmatically. It does now, and GET /api/meta serves the same value
    // under `limits.upload_max_bytes`.
    maxBytes: MAX_UPLOAD_BYTES,
    // When true, large files should be uploaded client-direct via /api/upload/blob
    // (bypasses the serverless body limit). When false (local dev), use this route.
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    // Where this caller's files belong in the shared store (Phase 7):
    // `<app>/<workspace>/<file>`. The client-direct Blob flow chooses the
    // pathname itself — the Blob SDK gives the server no way to rewrite it — so
    // the client needs both halves to build the same path the server would.
    // POST /api/upload/blob rejects anything outside `app`'s prefix.
    app: APP_SLUG,
    workspace: (await attributeUpload(user)).slug,
    blockedMimeTypes: BLOCKED_UPLOAD_MIME_TYPES,
    note: `All content types accepted except ${BLOCKED_UPLOAD_MIME_TYPES.join(', ')} (blocked for XSS safety)`,
  })
})
