// GET    /api/workspaces/{ws}/documents/{n}
// PATCH  /api/workspaces/{ws}/documents/{n} — title, kind, description, tags
// DELETE /api/workspaces/{ws}/documents/{n} — bin it
//
// **The two URL columns are not patchable.** A CHECK requires exactly one of
// them, so a partial update can violate it in a way the caller cannot see
// coming — and moving a document from a stored file to a link is a different
// document, not an edit. Delete and re-add.
//
// Binning a document does NOT delete the file it points at. `platform.uploads`
// is the ledger and `platform.blob_references` the delete gate; the file goes
// when nothing references it, which is a decision the storage layer makes and
// not this route.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getDocumentBySeq, softDeleteDocument, updateDocument } from '@/lib/db/queries/catalog'
import { publicDocument } from '@/lib/views'
import { DOCUMENT_TITLE_MAX } from '@/lib/limits'
import { nullableStr, requireMaxLength, requireNumberParam, str } from '@/lib/http-input'
import { DOCUMENT_KIND_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'document_not_found',
    `no document #${seq} in this workspace`,
    'run `bk sales doc list` for the numbers'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'document')
  const row = await getDocumentBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)
  return NextResponse.json(publicDocument(row, ctx.workspace.slug))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'document')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  if (body?.upload_url !== undefined || body?.external_url !== undefined) {
    throw Errors.badRequest(
      'url_not_patchable',
      'a document location is not editable',
      'a stored file and a link are different documents — remove this one and add the other'
    )
  }

  const title = str(body?.title)
  if (title) requireMaxLength(title, DOCUMENT_TITLE_MAX, 'title')
  const kind = str(body?.kind)
  if (kind && !DOCUMENT_KIND_VALUES.includes(kind)) {
    throw Errors.badRequest(
      'unknown_kind',
      `unknown document kind ${JSON.stringify(kind)}`,
      'run `bk meta` for the current kinds'
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateDocument(
    ctx.workspace.id,
    seq,
    {
      title,
      kind,
      description: nullableStr(body?.description),
      tags: body?.tags === undefined
        ? undefined
        : Array.isArray(body.tags)
          ? (body.tags as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
          : null,
    },
    actor
  )
  if (!row) throw notFound(seq)
  const full = await getDocumentBySeq(ctx.workspace.id, seq)
  return NextResponse.json(publicDocument(full!, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'document')

  const existing = await getDocumentBySeq(ctx.workspace.id, seq)
  if (!existing) throw notFound(seq)

  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'binning a document requires its title repeated back',
      `pass --confirm ${JSON.stringify(existing.title)}`
    )
  }
  if (confirm !== existing.title) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name document #${seq}`,
      `#${seq} is ${JSON.stringify(existing.title)}`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await softDeleteDocument(ctx.workspace.id, seq, actor)
  if (!row) throw notFound(seq)
  return NextResponse.json({ deleted: true, type: 'document', number: row.seq, name: row.title })
})
