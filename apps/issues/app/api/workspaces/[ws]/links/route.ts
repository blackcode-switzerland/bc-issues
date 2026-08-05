// Typed relations between two URNs (Phase 6) — `bk link create|list|rm`.
//
// The route is workspace-scoped even though a URN already names its workspace,
// and that redundancy is the tenant check: `resolveWorkspace` decides which
// workspace the caller may act in, and both ends of the link must be inside it.
// Trusting the URN alone would make the workspace segment of a string the caller
// supplies into an authorisation decision.
//
// `platform.links` is the only table in this phase holding data that is NOT
// derived. `entities` rebuilds from the source tables; a link does not. That is
// why creating one validates both ends up front instead of letting the foreign
// keys reject it — "which end is missing" is the only useful thing to say back,
// and a 23503 does not carry it.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, jsonList, resolveWorkspace } from '@/lib/api'
import { db } from '@/lib/db/client'
import {
  LINK_RELATIONS,
  createLink,
  deleteLink,
  getEntitiesByUrns,
  listLinks,
  parseUrn,
} from '@blackcode/platform-db'
import type { WorkspaceContext } from '@/lib/api'

interface Params {
  params: Promise<{ ws: string }>
}

const RELATIONS = new Set<string>(LINK_RELATIONS)

/** Parse a URN and confirm it addresses something in THIS workspace. */
async function requireUrnInWorkspace(
  ctx: WorkspaceContext,
  raw: string,
  field: string
): Promise<string> {
  const parsed = parseUrn(raw)
  if (!parsed) {
    throw Errors.badRequest(
      'invalid_urn',
      `${field} is not a Blackcode URN: ${raw}`,
      'URNs look like bc:issues:<workspace>/<type>/<number> — run `bk search <query>` to find one'
    )
  }
  if (parsed.workspaceSlug !== ctx.workspace.slug) {
    throw Errors.badRequest(
      'urn_outside_workspace',
      `${field} belongs to workspace ${parsed.workspaceSlug}, not ${ctx.workspace.slug}`,
      'links may only connect two entities in the same workspace'
    )
  }
  return raw.trim()
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const raw = req.nextUrl.searchParams.get('urn')
  if (!raw) {
    throw Errors.badRequest(
      'missing_urn',
      'urn is required',
      'pass the entity to inspect, e.g. `bk link list bc:issues:acme/issue/12`'
    )
  }
  const urn = await requireUrnInWorkspace(ctx, raw, 'urn')

  // 404 rather than an empty list: "this thing has no links" and "this thing does
  // not exist" are different answers, and an agent branching on exit codes needs
  // to tell them apart.
  const [entity] = await getEntitiesByUrns(db, [urn])
  if (!entity) {
    throw Errors.notFound(
      'entity_not_found',
      `nothing is projected at ${urn}`,
      'run `bk search <query>` to find the current URN'
    )
  }

  return jsonList(await listLinks(db, urn))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const rel = typeof body.rel === 'string' ? body.rel.trim() : ''
  if (!RELATIONS.has(rel)) {
    throw Errors.badRequest(
      'invalid_rel',
      `rel must be one of: ${[...RELATIONS].join(', ')}`,
      'run `bk meta` — the current relation list is served under links.relations'
    )
  }
  if (typeof body.from !== 'string' || typeof body.to !== 'string') {
    throw Errors.badRequest('invalid_body', 'from and to are required URN strings')
  }
  const from = await requireUrnInWorkspace(ctx, body.from, 'from')
  const to = await requireUrnInWorkspace(ctx, body.to, 'to')

  const result = await createLink(db, { fromUrn: from, toUrn: to, rel, createdBy: ctx.user.id })
  if (!result.ok) {
    if (result.reason === 'self_link') {
      throw Errors.badRequest('self_link', 'an entity cannot link to itself')
    }
    if (result.reason === 'cross_workspace') {
      throw Errors.badRequest(
        'cross_workspace_link',
        'both ends of a link must be in the same workspace'
      )
    }
    throw Errors.notFound(
      'entity_not_found',
      `nothing is projected at ${result.urn}`,
      'run `bk search <query>` to find the current URN'
    )
  }

  // 201 whether or not a row was inserted: the link exists either way, and an
  // idempotent create that answered 409 the second time would make retrying —
  // which is what an agent does after a timeout — look like a failure.
  return NextResponse.json({ from, to, rel, created: result.created }, { status: 201 })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const rel = (sp.get('rel') ?? '').trim()
  if (!fromRaw || !toRaw || !rel) {
    throw Errors.badRequest(
      'missing_params',
      'from, to and rel are all required',
      'a link is identified by all three — `bk link rm <from> <to> --rel <rel>`'
    )
  }
  const from = await requireUrnInWorkspace(ctx, fromRaw, 'from')
  const to = await requireUrnInWorkspace(ctx, toRaw, 'to')

  const removed = await deleteLink(db, { fromUrn: from, toUrn: to, rel })
  if (!removed) {
    throw Errors.notFound(
      'link_not_found',
      `no ${rel} link from ${from} to ${to}`,
      'links are directed — check the direction with `bk link list <urn>`'
    )
  }
  return NextResponse.json({ deleted: true })
})
