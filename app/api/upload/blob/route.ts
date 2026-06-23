// Client-direct upload handshake for Vercel Blob.
//
// Large files (up to MAX_UPLOAD_BYTES) can't go through a serverless function —
// Vercel caps the request body at ~4.5MB. Instead the browser uploads straight
// to Blob storage and only the *token request* hits this route. This is the
// official @vercel/blob/client flow. Used in production (where a Blob store is
// configured); local dev falls back to the multipart /api/upload route.

import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { resolveUser } from '@/lib/auth/resolve'
import { MAX_UPLOAD_BYTES } from '@/lib/upload'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Only authenticated members may mint an upload token.
        const user = await resolveUser(request)
        if (!user) throw new Error('Authentication required')

        // Block SVG (XSS) — content type is forwarded by the client.
        let contentType: string | undefined
        try {
          contentType = clientPayload ? (JSON.parse(clientPayload).contentType as string) : undefined
        } catch {
          contentType = undefined
        }
        if (contentType === 'image/svg+xml') {
          throw new Error('SVG files are not allowed for security reasons')
        }

        return {
          addRandomSuffix: true,
          // Blob enforces this server-side during the direct upload.
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
        }
      },
      // Fires server-to-server after the upload completes. Nothing to do — the
      // client receives the URL directly and inserts it into the document.
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
