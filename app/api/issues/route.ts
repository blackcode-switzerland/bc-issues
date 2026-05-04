import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import {
  createIssue,
  getAllIssuesWithProjects,
  getIssuesByProject,
  getIssuesPage,
  isProjectMember,
} from '@/lib/db'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parsePagination(searchParams: URLSearchParams): { limit?: number; cursor?: number | null } {
  const rawLimit = searchParams.get('limit')
  const rawCursor = searchParams.get('cursor')
  const paginated = rawLimit !== null || rawCursor !== null
  if (!paginated) return {}

  let limit = DEFAULT_LIMIT
  if (rawLimit !== null) {
    const n = parseInt(rawLimit)
    if (Number.isNaN(n) || n < 1) limit = DEFAULT_LIMIT
    else limit = Math.min(n, MAX_LIMIT)
  }
  let cursor: number | null = null
  if (rawCursor !== null) {
    const n = parseInt(rawCursor)
    cursor = Number.isNaN(n) ? null : n
  }
  return { limit, cursor }
}

const VALID_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get('project_id')
    const page = parsePagination(searchParams)

    let pid: number | undefined
    if (projectId) {
      const parsed = parseInt(projectId)
      if (Number.isNaN(parsed)) {
        return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 })
      }
      if (!(await isProjectMember(parsed, user.id))) {
        return NextResponse.json(
          { error: 'Forbidden', suggestion: 'You are not a member of this project' },
          { status: 403 }
        )
      }
      pid = parsed
    }

    if (page.limit !== undefined) {
      const result = await getIssuesPage({
        project_id: pid,
        limit: page.limit,
        cursor: page.cursor ?? null,
      })
      return NextResponse.json(result)
    }

    if (pid !== undefined) {
      return NextResponse.json(await getIssuesByProject(pid))
    }
    return NextResponse.json(await getAllIssuesWithProjects())
  } catch (error) {
    console.error('Failed to fetch issues:', error)
    return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { project_id, title, description, status, priority, assignee_id, milestone_id } = body

    if (!project_id || typeof project_id !== 'number') {
      return NextResponse.json(
        {
          error: 'Invalid project_id',
          suggestion: 'project_id is required and must be an integer',
        },
        { status: 400 }
      )
    }

    if (!(await isProjectMember(project_id, user.id))) {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'You are not a member of this project' },
        { status: 403 }
      )
    }

    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Invalid title', suggestion: 'title is required' },
        { status: 400 }
      )
    }
    if (title.length > 200) {
      return NextResponse.json(
        {
          error: 'Title too long',
          suggestion: `Max 200 chars. You sent ${title.length}. Truncate or split.`,
        },
        { status: 400 }
      )
    }

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status', suggestion: `Valid: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    if (priority && (priority < 1 || priority > 5)) {
      return NextResponse.json(
        { error: 'Invalid priority', suggestion: 'Priority must be 1-5 (1=urgent, 5=low)' },
        { status: 400 }
      )
    }

    const issue = await createIssue({
      project_id,
      title,
      description,
      status,
      priority,
      assignee_id,
      milestone_id,
      reporter_id: user.id,
    })

    return NextResponse.json(issue, { status: 201 })
  } catch (error) {
    console.error('Failed to create issue:', error)
    return NextResponse.json({ error: 'Failed to create issue' }, { status: 500 })
  }
}
