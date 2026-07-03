import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace } from '@/lib/api'
import { getWorkspaceForUser } from '@/lib/db/queries/workspaces'
import {
  moveItems,
  ItemNotFoundError,
  NothingToMoveError,
  type MoveMode,
} from '@/lib/db/queries/move'

interface Params {
  params: Promise<{ ws: string }>
}

// Coerce an incoming JSON value to an array of positive integers (workspace
// #numbers). Anything non-numeric is rejected so a bad id can't silently vanish.
function seqArray(value: unknown, field: string): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw Errors.badRequest('invalid_body', `${field} must be an array of numbers`)
  return value.map((v) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw Errors.badRequest('invalid_body', `${field} must contain positive integers (workspace #numbers)`)
    }
    return v
  })
}

// POST /api/workspaces/{ws}/move — copy or move projects/tasks/issues from this
// workspace ({ws} = source) into another workspace the caller also belongs to.
// The whole operation is a single transaction: on any error nothing is written
// to the target and the source is untouched (no data can be lost).
export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws) // caller must be a member of the source

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // Resolve the target workspace; must exist AND the caller must be a member of
  // it (getWorkspaceForUser returns null otherwise — mirrors the no-leak 404).
  const targetRef = body.target ?? body.target_workspace
  if (typeof targetRef !== 'string' && typeof targetRef !== 'number') {
    throw Errors.badRequest('missing_target', 'provide `target` (target workspace slug or id)')
  }
  const target = await getWorkspaceForUser(String(targetRef), ctx.user.id)
  if (!target) throw Errors.notFound('workspace')
  if (target.id === ctx.workspace.id) {
    throw Errors.badRequest('same_workspace', 'source and target workspaces are the same')
  }

  const mode: MoveMode = body.mode === 'copy' ? 'copy' : 'move'
  if (body.mode !== undefined && body.mode !== 'move' && body.mode !== 'copy') {
    throw Errors.badRequest('invalid_mode', "mode must be 'move' or 'copy'")
  }

  const projectSeqs = seqArray(body.projects, 'projects')
  const taskSeqs = seqArray(body.tasks, 'tasks')
  const issueSeqs = seqArray(body.issues, 'issues')
  if (projectSeqs.length === 0 && taskSeqs.length === 0 && issueSeqs.length === 0) {
    throw Errors.badRequest('nothing_to_move', 'provide at least one of projects / tasks / issues')
  }

  const cascadeTasks = body.cascade_tasks !== false // default true
  const cascadeIssues = body.cascade_issues !== false // default true

  try {
    const report = await moveItems({
      sourceWorkspaceId: ctx.workspace.id,
      targetWorkspaceId: target.id,
      mode,
      projectSeqs,
      taskSeqs,
      issueSeqs,
      cascadeTasks,
      cascadeIssues,
      actorUserId: ctx.user.id,
    })
    return NextResponse.json(
      {
        ...report,
        source: { id: ctx.workspace.id, slug: ctx.workspace.slug, name: ctx.workspace.name },
        target: { id: target.id, slug: target.slug, name: target.name },
      },
      { status: 200 }
    )
  } catch (err) {
    if (err instanceof ItemNotFoundError) {
      throw Errors.badRequest(`${err.itemType}_not_found`, `no active ${err.itemType} #${err.seq} in the source workspace`)
    }
    if (err instanceof NothingToMoveError) {
      throw Errors.badRequest('nothing_to_move', 'the selection resolved to no movable items')
    }
    throw err
  }
})
