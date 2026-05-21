import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

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

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', suggestion: 'Include a file in the form data' },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large', suggestion: 'Maximum file size is 10MB' },
        { status: 400 }
      )
    }

    // Validate file type for images (SVG excluded due to XSS risk)
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const allowedDocTypes = ['application/pdf', 'text/plain', 'application/json', 'text/markdown']
    const allowedTypes = [...allowedImageTypes, ...allowedDocTypes]

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error: 'Invalid file type',
          suggestion: `Allowed types: ${allowedTypes.join(', ')}`
        },
        { status: 400 }
      )
    }

    // Generate unique filename with timestamp
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filename = `${timestamp}-${sanitizedName}`

    const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN)

    let url: string
    if (hasBlobToken) {
      const blob = await put(filename, file, {
        access: 'public',
        addRandomSuffix: true,
      })
      url = blob.url
    } else if (process.env.NODE_ENV !== 'production') {
      // Local-dev fallback: store under public/uploads and serve via Next.js static
      const local = await saveLocally(file, filename)
      url = local.url
    } else {
      return NextResponse.json(
        {
          error: 'Blob storage not configured',
          suggestion: 'Set BLOB_READ_WRITE_TOKEN environment variable',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      url,
      filename: file.name,
      size: file.size,
      contentType: file.type,
    })
  } catch (error) {
    console.error('Failed to upload file:', error)

    if (error instanceof Error && error.message.includes('BLOB_READ_WRITE_TOKEN')) {
      return NextResponse.json(
        {
          error: 'Blob storage not configured',
          suggestion: 'Set BLOB_READ_WRITE_TOKEN environment variable'
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const user = await resolveUser(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    message: 'Upload API endpoint',
    usage: 'POST with multipart/form-data containing a "file" field',
    maxSize: '10MB',
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf', 'text/plain', 'application/json', 'text/markdown'
    ],
  })
}
