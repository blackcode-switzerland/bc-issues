import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, jsonList } from '@/lib/api'
import {
  createProject,
  listProjectsInWorkspace,
  pageProjectsInWorkspace,
} from '@/lib/db/queries/projects'

interface Params {
  params: Promise<{ ws: string }>
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  const rawLimit = sp.get('limit')
  const rawCursor = sp.get('cursor')
  if (rawLimit !== null || rawCursor !== null) {
    let limit = DEFAULT_LIMIT
    if (rawLimit !== null) {
      const n = parseInt(rawLimit)
      if (!Number.isNaN(n) && n >= 1) limit = Math.min(n, MAX_LIMIT)
    }
    let cursor: number | null = null
    if (rawCursor !== null) {
      const n = parseInt(rawCursor)
      cursor = Number.isNaN(n) ? null : n
    }
    const result = await pageProjectsInWorkspace({
      workspaceId: ctx.workspace.id,
      limit,
      cursor,
    })
    return NextResponse.json(result)
  }

  const status = sp.get('status') ?? undefined
  const search = sp.get('search') ?? undefined
  const data = await listProjectsInWorkspace(ctx.workspace.id, { status, search })
  return jsonList(data)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > 100) throw Errors.badRequest('name_too_long', 'name max 100 chars')

  const memberIds = Array.isArray(body.member_ids)
    ? body.member_ids.filter((n: unknown): n is number => typeof n === 'number')
    : undefined

  const project = await createProject({
    workspaceId: ctx.workspace.id,
    name,
    summary: typeof body.summary === 'string' ? body.summary : null,
    description: typeof body.description === 'string' ? body.description : null,
    color: typeof body.color === 'string' ? body.color : undefined,
    icon: typeof body.icon === 'string' ? body.icon : null,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    lead_user_id: typeof body.lead_user_id === 'number' ? body.lead_user_id : ctx.user.id,
    start_date: typeof body.start_date === 'string' ? body.start_date : null,
    end_date: typeof body.end_date === 'string' ? body.end_date : null,
    status: typeof body.status === 'string' ? body.status : undefined,
    member_ids: memberIds,
    actorUserId: ctx.user.id,
  })
  return NextResponse.json(project, { status: 201 })
})
