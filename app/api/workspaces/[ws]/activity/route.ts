import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { listEvents, type EntityType, type EventAction } from '@/lib/db/queries/events'

interface Params {
  params: Promise<{ ws: string }>
}

const ENTITY_TYPES = new Set<EntityType>([
  'workspace',
  'workspace_member',
  'invitation',
  'project',
  'milestone',
  'issue',
  'comment',
  'attachment',
  'label',
])

const ACTIONS = new Set<EventAction>([
  'created',
  'updated',
  'deleted',
  'ownership_transferred',
  'member_added',
  'member_removed',
  'member_left',
  'invitation_created',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_declined',
  'commented',
  'assigned',
  'unassigned',
  'status_changed',
  'priority_changed',
  'milestone_changed',
  'project_changed',
  'labeled',
  'unlabeled',
  'attached',
  'unattached',
  'mentioned',
])

function parseList<T extends string>(raw: string | null, allowed: Set<T>): T[] | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as T[]
  for (const p of parts) {
    if (!allowed.has(p)) return undefined
  }
  return parts
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function parseInts(raw: string | null): number[] | undefined {
  if (!raw) return undefined
  const out: number[] = []
  for (const p of raw.split(',').map((s) => s.trim())) {
    const n = parseInt(p)
    if (!Number.isNaN(n)) out.push(n)
  }
  return out.length > 0 ? out : undefined
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const sp = req.nextUrl.searchParams
  const cursor = sp.get('cursor') ? parseInt(sp.get('cursor')!) : null
  if (cursor !== null && Number.isNaN(cursor)) {
    throw Errors.badRequest('invalid_cursor', 'cursor must be an integer')
  }
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw Errors.badRequest('invalid_limit', 'limit must be a positive integer')
  }

  const page = await listEvents({
    workspaceId: ctx.workspace.id,
    actorUserIds: parseInts(sp.get('actor')),
    entityTypes: parseList(sp.get('entity_type'), ENTITY_TYPES),
    actions: parseList(sp.get('action'), ACTIONS),
    fromOccurredAt: parseDate(sp.get('from')),
    toOccurredAt: parseDate(sp.get('to')),
    cursor,
    limit,
  })

  return NextResponse.json(page)
})
