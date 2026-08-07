// GET /api/workspaces/{ws}/today — what is owed today, and who we are meeting
//
// COMPUTED, never stored (D-33). The reasoning is in
// `lib/db/queries/aggregates.ts`: the doctrine forbids the app DECIDING things,
// not the app READING them, and "which prospects have an action due" is
// arithmetic over rows this app already holds.
//
// An overdue action is IN the answer, flagged — a follow-up queue that drops
// what was missed yesterday is the one thing a follow-up queue must not do.
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { today } from '@/lib/db/queries/aggregates'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  return NextResponse.json(await today(ctx.workspace.id))
})
