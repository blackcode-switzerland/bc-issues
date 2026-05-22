import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { db } from '@/lib/db/client'
import { addWatcher, removeWatcher } from '@/lib/db/queries/watchers'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  await addWatcher(db, id, ctx.user.id, 'manual')
  return NextResponse.json({ watching: true })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const id = parseInt(idStr)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')
  const ctx = await resolveWorkspace(req, ws)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  await removeWatcher(db, id, ctx.user.id)
  return NextResponse.json({ watching: false })
})
