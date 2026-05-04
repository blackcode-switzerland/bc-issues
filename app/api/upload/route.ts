import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { put } from '@vercel/blob'

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

    // Upload to Vercel Blob
    const blob = await put(filename, file, {
      access: 'public',
      addRandomSuffix: true,
    })

    return NextResponse.json({
      url: blob.url,
      filename: file.name,
      size: file.size,
      contentType: file.type,
    })
  } catch (error) {
    console.error('Failed to upload file:', error)

    // Check for missing blob token
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
