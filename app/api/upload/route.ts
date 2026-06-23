import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '@/lib/upload'

const LOCAL_UPLOAD_DIR = 'public/uploads'

async function saveLocally(file: File, baseName: string): Promise<{ url: string }> {
  const uploadsDir = resolve(process.cwd(), LOCAL_UPLOAD_DIR)
  await mkdir(uploadsDir, { recursive: true })

  const finalName = `${baseName}-${randomBytes(4).toString('hex')}`
  const destPath = resolve(uploadsDir, finalName)
  // Defense-in-depth against path traversal even though baseName is sanitized upstream
  if (!destPath.startsWith(uploadsDir + sep)) {
    throw new Error('Resolved upload path escapes uploads directory')
  }

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
  // Block SVG due to XSS risk; allow everything else.
  if (file.type === 'image/svg+xml') {
    throw Errors.badRequest('file_type_not_allowed', 'SVG files are not allowed for security reasons')
  }

  const timestamp = Date.now()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const filename = `${timestamp}-${sanitizedName}`

  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)

  let url: string
  if (hasBlobToken) {
    const blob = await put(filename, file, { access: 'public', addRandomSuffix: true })
    url = blob.url
  } else if (process.env.NODE_ENV !== 'production') {
    // Local-dev fallback: store under public/uploads and serve via Next.js static.
    const local = await saveLocally(file, filename)
    url = local.url
  } else {
    throw Errors.internal('Blob storage is not configured (set BLOB_READ_WRITE_TOKEN)')
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
    // When true, large files should be uploaded client-direct via /api/upload/blob
    // (bypasses the serverless body limit). When false (local dev), use this route.
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    note: 'All content types accepted except image/svg+xml (blocked for XSS safety)',
  })
})
