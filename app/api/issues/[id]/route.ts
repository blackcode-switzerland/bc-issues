import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import {
  deleteIssue,
  getIssue,
  getProjectMemberRole,
  isProjectMember,
  logTransaction,
  updateIssue,
} from '@/lib/db'

const VALID_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

function forbidden(suggestion?: string) {
  return NextResponse.json({ error: 'Forbidden', suggestion }, { status: 403 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) return unauthorized()

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const issue = await getIssue(id)
    if (!issue) {
      return NextResponse.json(
        { error: 'Issue not found', suggestion: 'List available: GET /api/issues' },
        { status: 404 }
      )
    }

    if (!(await isProjectMember(issue.project_id, user.id))) {
      return forbidden('You are not a member of the project that owns this issue')
    }

    return NextResponse.json(issue)
  } catch (error) {
    console.error('Failed to fetch issue:', error)
    return NextResponse.json({ error: 'Failed to fetch issue' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) return unauthorized()

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const oldIssue = await getIssue(id)
    if (!oldIssue) {
      return NextResponse.json(
        { error: 'Issue not found', suggestion: 'List available: GET /api/issues' },
        { status: 404 }
      )
    }

    const role = await getProjectMemberRole(oldIssue.project_id, user.id)
    if (!role || role === 'viewer') {
      return forbidden('Only project members (non-viewer) can edit issues')
    }

    const body = await request.json()
    const { title, description, status, priority, assignee_id, milestone_id, start_date, due_date } =
      body

    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
      return NextResponse.json(
        { error: 'Invalid title', suggestion: 'Max 200 chars' },
        { status: 400 }
      )
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status', suggestion: `Valid: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    if (priority !== undefined && (priority < 1 || priority > 5)) {
      return NextResponse.json(
        { error: 'Invalid priority', suggestion: 'Priority must be 1-5 (1=urgent, 5=low)' },
        { status: 400 }
      )
    }

    const issue = await updateIssue(id, {
      title,
      description,
      status,
      priority,
      assignee_id,
      milestone_id,
      start_date,
      due_date,
    })

    if (issue) {
      await logTransaction({
        user_id: user.id,
        operation_type: 'UPDATE',
        table_name: 'issues',
        record_id: id,
        old_data: oldIssue,
        new_data: issue,
      })
    }

    return NextResponse.json(issue)
  } catch (error) {
    console.error('Failed to update issue:', error)
    return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) return unauthorized()

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const oldIssue = await getIssue(id)
    if (!oldIssue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    const role = await getProjectMemberRole(oldIssue.project_id, user.id)
    if (!role || !['owner', 'admin'].includes(role)) {
      return forbidden('Only project owners and admins can delete issues')
    }

    await deleteIssue(id)

    await logTransaction({
      user_id: user.id,
      operation_type: 'DELETE',
      table_name: 'issues',
      record_id: id,
      old_data: oldIssue,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete issue:', error)
    return NextResponse.json({ error: 'Failed to delete issue' }, { status: 500 })
  }
}
