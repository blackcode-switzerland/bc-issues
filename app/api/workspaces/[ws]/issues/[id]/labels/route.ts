import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList } from '@/lib/api'
import { attachLabel, getOrCreateLabels, listIssueLabels } from '@/lib/db/queries/labels'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  const data = await listIssueLabels(id)
  return jsonList(data)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)

  // Validate the issue belongs to this workspace before resolving/creating any
  // label, so a bad issue id can't leave an orphan label behind.
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // Accept an existing label_id, or a name (matched case-insensitively, created
  // on the fly if it doesn't exist yet).
  let labelId: number
  if (typeof body.label_id === 'number') {
    labelId = body.label_id
  } else if (typeof body.name === 'string' && body.name.trim()) {
    const name = body.name.trim()
    if (name.length > 50) throw Errors.badRequest('label_name_too_long', 'label names are max 50 chars')
    const [resolved] = await getOrCreateLabels(ctx.workspace.id, [name], ctx.user.id)
    if (!resolved) throw Errors.badRequest('invalid_label', 'could not resolve label')
    labelId = resolved
  } else {
    throw Errors.badRequest('invalid_label', 'provide label_id (existing) or name (existing or created on the fly)')
  }

  const ok = await attachLabel(ctx.workspace.id, id, labelId, ctx.user.id)
  if (!ok) throw Errors.notFound('issue_or_label')
  return NextResponse.json({ attached: true })
})
