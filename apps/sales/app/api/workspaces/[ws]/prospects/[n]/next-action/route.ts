// PATCH /api/workspaces/{ws}/prospects/{n}/next-action — what we owe them next
//
// Its own route rather than four fields on the generic PATCH, for the same
// reason `stage` is: this is one intention with four columns behind it, and a
// caller that set `next_action_type` without a due date has written half a
// commitment. Setting them together is the only shape that cannot be half done.
//
// THE DATE AND THE WORDS ARE BOTH STORED, and that is departure 8 in
// `docs/backend.md`. `--due` is a RESOLVED date, because a date is what sorts
// and filters and drives the Today queue; `--due-label` keeps the phrase the
// agent actually wrote, because resolving "this week" to a guessed Friday and
// discarding the words loses the difference between "due Friday" and "sometime
// this week, Friday is my guess" — which is exactly the difference a human needs
// when the follow-up is late.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { setNextAction } from '@/lib/db/queries/prospects'
import { findUserIdByEmail } from '@/lib/db/queries/prospects'
import { publicProspect } from '@/lib/views'
import { nullableStr, requireNumberParam, str } from '@/lib/http-input'
import { NEXT_ACTION_TYPE_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const type = nullableStr(body?.type)
  if (typeof type === 'string' && !NEXT_ACTION_TYPE_VALUES.includes(type)) {
    throw Errors.badRequest(
      'unknown_next_action',
      `unknown next-action type ${JSON.stringify(type)}`,
      'run `bk meta` for the current next-action values'
    )
  }

  const due = nullableStr(body?.due)
  if (typeof due === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    throw Errors.badRequest(
      'invalid_due',
      `due must be a date (YYYY-MM-DD), got ${JSON.stringify(due)}`,
      'resolve the phrase to a real date and keep the words in --due-label'
    )
  }

  let ownerUserId: number | null | undefined
  let ownerLabel: string | null | undefined
  const owner = nullableStr(body?.owner)
  if (owner === null) {
    ownerUserId = null
    ownerLabel = null
  } else if (owner !== undefined) {
    // The owner of a NEXT ACTION can be the agent — unlike the deal owner. Four
    // of the mockup's seven prospects have `companion` here, so a user FK alone
    // cannot represent the data. An email resolves to a user AND a label; any
    // other string is a label with no user behind it, which is the agent case.
    const found = owner === 'me' ? ctx.user.id : await findUserIdByEmail(owner)
    ownerUserId = found ?? null
    ownerLabel = owner === 'me' ? (ctx.user.name ?? ctx.user.email) : owner
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const updated = await setNextAction(
    ctx.workspace.id,
    seq,
    {
      type,
      due,
      dueLabel: nullableStr(body?.due_label),
      note: nullableStr(body?.note),
      ownerUserId,
      ownerLabel,
    },
    actor
  )
  if (!updated) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return NextResponse.json(publicProspect(updated, ctx.workspace.slug))
})
