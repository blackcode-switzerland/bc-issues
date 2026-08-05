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
import { recordUpload } from '@/lib/db/queries/uploads'
import { attributeUpload } from '@/lib/storage/attribution'
import { assertPathnameWritable } from '@blackcode/platform-storage/paths'
import { knownAppSlugs } from '@/lib/storage'
import { APP_SLUG } from '@/lib/app'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Only authenticated members may mint an upload token.
        const user = await resolveUser(request)
        if (!user) throw new Error('Authentication required')

        // The CLIENT chooses the pathname in this flow and the Blob SDK gives us
        // no way to rewrite it — the token is minted for the path it asked for.
        // So this is the one place a caller can be stopped from writing into
        // ANOTHER app's prefix. It deliberately accepts an unprefixed path: the
        // `bk` CLI uses this same flow and every installed binary sends a bare
        // filename. Demanding the prefix here broke every one of them in
        // production on 2026-08-05 — see assertPathnameWritable's header.
        // (Prefixes are for attribution, not authorisation: the store has one
        // token per deployment. What this prevents is a confused client, not a
        // determined attacker with our token.)
        assertPathnameWritable(APP_SLUG, pathname, await knownAppSlugs())

        // The client forwards file metadata in clientPayload (contentType,
        // filename, size) and may name a target workspace (slug/id).
        let payload: { contentType?: string; filename?: string; size?: number; workspace?: string } = {}
        try {
          payload = clientPayload ? JSON.parse(clientPayload) : {}
        } catch {
          payload = {}
        }

        // Block SVG (XSS) — content type is forwarded by the client.
        if (payload.contentType === 'image/svg+xml') {
          throw new Error('SVG files are not allowed for security reasons')
        }

        const workspace = await attributeUpload(user, payload.workspace ?? null)

        return {
          addRandomSuffix: true,
          // Blob enforces this server-side during the direct upload.
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Forwarded verbatim to onUploadCompleted to write the ledger row.
          tokenPayload: JSON.stringify({
            workspace_id: workspace.id,
            uploaded_by: user.id,
            filename: payload.filename ?? null,
            size: payload.size ?? null,
            contentType: payload.contentType ?? null,
          }),
        }
      },
      // Fires server-to-server after the upload completes (production only — not
      // on localhost, which uses the multipart route). Record the ledger row;
      // never throw, a ledger failure must not fail the upload.
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        try {
          const meta = tokenPayload ? JSON.parse(tokenPayload) : {}
          await recordUpload({
            url: blob.url,
            pathname: blob.pathname,
            filename: meta.filename || blob.pathname,
            size: meta.size ?? null,
            mime_type: meta.contentType ?? blob.contentType ?? null,
            workspace_id: meta.workspace_id ?? null,
            uploaded_by: meta.uploaded_by ?? null,
          })
        } catch (err) {
          console.error('[upload/blob] ledger record failed (non-fatal):', err)
        }
      },
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
