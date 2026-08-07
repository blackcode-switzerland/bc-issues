// GET  /api/workspaces/{ws}/communications — the multi-channel log
// POST /api/workspaces/{ws}/communications — log one
//
// **The app never sends anything.** It records that a message was sent. There is
// no Gmail or WhatsApp integration and none is planned (§2); `external_ref`
// exists so one could be added later without a migration of meaning.
//
// `channel: note` is D-13's consequence: sales has no `platform.comments`, so an
// internal note about a prospect is a communication with nobody on the other end.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { listCommunications, logCommunication } from '@/lib/db/queries/ledger'
import { listContacts, prospectIdBySeq } from '@/lib/db/queries/prospect-children'
import { publicComm } from '@/lib/views'
import { COMM_SUBJECT_MAX } from '@/lib/limits'
import { numberOr, parseList, requireMaxLength, str } from '@/lib/http-input'
import { CHANNEL_VALUES, COMM_DIRECTION_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const channels = parseList(q.get('channel'))
  for (const c of channels) {
    if (!CHANNEL_VALUES.includes(c)) {
      throw Errors.badRequest(
        'unknown_channel',
        `unknown channel ${JSON.stringify(c)}`,
        'run `bk meta` for the current channels'
      )
    }
  }
  const direction = str(q.get('dir'))
  if (direction && !COMM_DIRECTION_VALUES.includes(direction)) {
    throw Errors.badRequest(
      'unknown_direction',
      `unknown direction ${JSON.stringify(direction)}`,
      'run `bk meta` for the current values'
    )
  }

  const page = await listCommunications({
    workspaceId: ctx.workspace.id,
    prospectSeq: numberOr(q.get('prospect')),
    channels,
    direction,
    from: q.get('from') ? new Date(q.get('from')!) : undefined,
    to: q.get('to') ? new Date(q.get('to')!) : undefined,
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
    cursor: numberOr(q.get('cursor')) ?? null,
  })
  return jsonList(
    page.data.map((c) => publicComm(c, ctx.workspace.slug)),
    page.next_cursor
  )
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const prospectSeq = numberOr(String(body?.prospect ?? ''))
  if (prospectSeq == null) {
    throw Errors.badRequest(
      'missing_prospect',
      'prospect is required (its #number)',
      'run `bk sales prospect list` for the numbers'
    )
  }
  const prospectId = await prospectIdBySeq(ctx.workspace.id, prospectSeq)
  if (prospectId == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${prospectSeq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }

  const channel = str(body?.channel)
  if (!channel || !CHANNEL_VALUES.includes(channel)) {
    throw Errors.badRequest(
      'unknown_channel',
      channel ? `unknown channel ${JSON.stringify(channel)}` : 'channel is required',
      'run `bk meta` for the current channels'
    )
  }
  const direction = str(body?.direction)
  if (!direction || !COMM_DIRECTION_VALUES.includes(direction)) {
    throw Errors.badRequest(
      'unknown_direction',
      direction ? `unknown direction ${JSON.stringify(direction)}` : 'direction is required',
      'run `bk meta` for the current values'
    )
  }

  const subject = str(body?.subject) ?? null
  if (subject) requireMaxLength(subject, COMM_SUBJECT_MAX, 'subject')

  const atRaw = str(body?.at)
  const occurredAt = atRaw ? new Date(atRaw) : new Date()
  if (Number.isNaN(occurredAt.getTime())) {
    throw Errors.badRequest(
      'invalid_at',
      `at must be an ISO 8601 timestamp, got ${JSON.stringify(atRaw)}`,
      'e.g. 2026-08-07T14:00:00Z, or omit it for now'
    )
  }

  // A contact is named by its row id, and it must belong to THIS prospect —
  // otherwise a typo files a call against the wrong company's decision maker.
  let contactId: number | null = null
  const contactRaw = body?.contact
  if (contactRaw != null && contactRaw !== '') {
    const wanted = Number(contactRaw)
    const found = (await listContacts(prospectId)).find((c) => c.id === wanted)
    if (!found) {
      throw Errors.badRequest(
        'contact_not_found',
        `no contact ${wanted} on prospect #${prospectSeq}`,
        `run \`bk sales contact list ${prospectSeq}\` for the ids`
      )
    }
    contactId = found.id
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await logCommunication({
    workspaceId: ctx.workspace.id,
    prospectId,
    actor,
    channel,
    direction,
    occurredAt,
    subject,
    body: str(body?.body) ?? null,
    contactId,
  })
  return NextResponse.json(
    publicComm(
      { ...row, prospect_number: prospectSeq, prospect_name: '', contact_name: null },
      ctx.workspace.slug
    ),
    { status: 201 }
  )
})
