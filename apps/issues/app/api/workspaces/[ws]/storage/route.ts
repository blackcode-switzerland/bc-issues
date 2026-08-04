// Workspace storage management (owner-only): list every file uploaded into the
// workspace, with what currently references each one and the workspace's total
// usage. This is the data behind the Storage settings page and `bk storage list`.
//
// References are computed by a live scan of the content tables (lib/blob-refs.ts)
// INCLUDING trashed items, so a file shown with 0 references is genuinely an
// orphan and safe to delete. Deletion itself re-checks at delete time — see
// ./[id]/route.ts.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { listWorkspaceUploads, computeWorkspaceStorageUsage } from '@/lib/db/queries/uploads'
import { computeWorkspaceReferences } from '@/lib/blob-refs'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const [rows, refMap, usageBytes] = await Promise.all([
    listWorkspaceUploads(ctx.workspace.id),
    computeWorkspaceReferences(ctx.workspace.id),
    computeWorkspaceStorageUsage(ctx.workspace.id),
  ])

  const data = rows.map((u) => {
    const references = refMap.get(u.url) ?? []
    return {
      id: u.id,
      url: u.url,
      filename: u.filename,
      size: u.size,
      mime_type: u.mime_type,
      uploaded_by: u.uploaded_by,
      uploader_name: u.uploader_name,
      uploader_avatar: u.uploader_avatar,
      created_at: u.created_at,
      reference_count: references.length,
      references,
    }
  })

  return NextResponse.json({
    data,
    next_cursor: null,
    total: data.length,
    usage_bytes: usageBytes,
    limit_bytes: ctx.workspace.storage_limit_bytes ?? null,
  })
})
