import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId } from '@/lib/api'
import { db } from '@/lib/db/client'
import { addWatcher, isWatcher, removeWatcher } from '@/lib/db/queries/watchers'
import { getIssueInWorkspace } from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const watching = await isWatcher(id, ctx.user.id)
  return NextResponse.json({ watching })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  await addWatcher(db, id, ctx.user.id, 'manual')
  return NextResponse.json({ watching: true })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  await removeWatcher(db, id, ctx.user.id)
  return NextResponse.json({ watching: false })
})
