// Delete one stored file (owner-only).
//
// This is the ONLY place a blob is ever removed from storage. It is gated by a
// live, system-wide reference scan run at this exact moment: if anything still
// references the URL — an active OR trashed issue/task/project/comment/update
// body, or an attachment row, in any workspace — the delete is refused (409).
// Only a genuine orphan is removed. This is what makes manual cleanup safe
// against undo, trash-restore, and copy-pasted references.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, requireOwner } from '@/lib/api'
import { getUpload, deleteUploadRow } from '@/lib/db/queries/uploads'
import { isUrlReferencedAnywhere } from '@/lib/blob-refs'
import { removeBlobBytes } from '@/lib/blob-gc'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'file id must be an integer')

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const upload = await getUpload(id)
  if (!upload || upload.workspace_id !== ctx.workspace.id) throw Errors.notFound('file')

  // The safety gate. Refuse if anything still points at this file.
  if (await isUrlReferencedAnywhere(upload.url)) {
    throw Errors.conflict(
      'file_in_use',
      'This file is still referenced by a description, comment, or attachment (including items in the recycle bin). Remove those references first, or empty the trash, then try again.'
    )
  }

  // Confirmed orphan — remove the bytes, then the ledger row. If the storage
  // delete fails, keep the ledger row so the file stays visible and retryable.
  await removeBlobBytes(upload.url)
  await deleteUploadRow(id)

  return NextResponse.json({ deleted: true })
})
