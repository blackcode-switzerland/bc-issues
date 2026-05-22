import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { attachLabel, listIssueLabels } from '@/lib/db/queries/labels'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  const data = await listIssueLabels(id)
  return NextResponse.json({ data })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  if (!body || typeof body.label_id !== 'number') {
    throw Errors.badRequest('invalid_label_id', 'label_id (number) is required')
  }
  const ok = await attachLabel(ctx.workspace.id, id, body.label_id, ctx.user.id)
  if (!ok) throw Errors.notFound('issue_or_label')
  return NextResponse.json({ attached: true })
})
