import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, publicEvent } from '@/lib/api'
import {
  listEvents,
  resolveEventEntitySeqs,
  type EntityType,
  type EventAction,
} from '@/lib/db/queries/events'

interface Params {
  params: Promise<{ ws: string }>
}

const ENTITY_TYPES = new Set<EntityType>([
  'workspace',
  'workspace_member',
  'workspace_app',
  'invitation',
  'project',
  'task',
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
  // Phase 4's app_* actions and Phase 4's workspace_app entity type were never
  // added to these allow-lists. parseList returns undefined for an unrecognised
  // value, which drops the filter silently rather than rejecting it — so
  // `?action=app_access_granted` quietly returned the WHOLE feed. Fixed here
  // because this phase is what makes the feed cross-app.
  'app_enabled',
  'app_disabled',
  'app_default_access_changed',
  'app_access_granted',
  'app_access_revoked',
  'invitation_created',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_declined',
  'commented',
  'assigned',
  'unassigned',
  'status_changed',
  'priority_changed',
  'task_changed',
  'project_changed',
  'labeled',
  'unlabeled',
  'attached',
  'unattached',
  'mentioned',
  'due_date_changed',
  'restored',
  'purged',
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

function parseCsv(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

// A relative window: <number><m|h|d>. Deliberately not a general date parser —
// `from` already takes an absolute timestamp, and a lenient parser here would
// turn a typo into a silently wrong window rather than a 400.
const DURATION_RE = /^(\d+)\s*(m|h|d)$/i
const DURATION_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

function parseDuration(raw: string): number | null {
  const m = DURATION_RE.exec(raw.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return n * DURATION_MS[m[2].toLowerCase()]
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

  // `since` is a relative window (24h, 7d, 90m) — the shape `bk activity --since`
  // takes. It resolves to the same `from` filter; passing both is a caller error
  // rather than a silent precedence rule nobody would guess.
  const sinceRaw = sp.get('since')
  if (sinceRaw && sp.get('from')) {
    throw Errors.badRequest(
      'since_and_from',
      'pass either since or from, not both',
      'since is a relative window (24h); from is an absolute timestamp'
    )
  }
  let fromOccurredAt = parseDate(sp.get('from'))
  if (sinceRaw) {
    const ms = parseDuration(sinceRaw)
    if (ms === null) {
      throw Errors.badRequest(
        'invalid_since',
        `since must be a duration like 30m, 24h or 7d — got ${sinceRaw}`,
        'use m (minutes), h (hours) or d (days)'
      )
    }
    fromOccurredAt = new Date(Date.now() - ms)
  }

  // `app` filters the feed to one app's events. There is exactly one app today,
  // so this is a no-op filter — shipped now because the flag is the part agents
  // learn, and it should not change meaning the day a second app appears.
  const apps = parseCsv(sp.get('app'))
  const subjectUrn = sp.get('subject_urn') ?? undefined

  const page = await listEvents({
    workspaceId: ctx.workspace.id,
    actorUserIds: parseInts(sp.get('actor')),
    entityTypes: parseList(sp.get('entity_type'), ENTITY_TYPES),
    actions: parseList(sp.get('action'), ACTIONS),
    apps,
    subjectUrn,
    fromOccurredAt,
    toOccurredAt: parseDate(sp.get('to')),
    cursor,
    limit,
  })

  // Expose entity_id as the #number for work-item events (never the internal id).
  const seqMap = await resolveEventEntitySeqs(page.data)
  return NextResponse.json({
    data: page.data.map((e) => publicEvent(e, seqMap)),
    next_cursor: page.next_cursor,
  })
})
