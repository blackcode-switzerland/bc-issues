import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { createMilestone, getAllMilestones, getMilestones, isProjectMember } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = request.nextUrl.searchParams.get('project_id')
    if (projectId) {
      const pid = parseInt(projectId)
      if (Number.isNaN(pid)) {
        return NextResponse.json({ error: 'Invalid project_id' }, { status: 400 })
      }
      if (!(await isProjectMember(pid, user.id))) {
        return NextResponse.json(
          { error: 'Forbidden', suggestion: 'You are not a member of this project' },
          { status: 403 }
        )
      }
      return NextResponse.json(await getMilestones(pid))
    }

    return NextResponse.json(await getAllMilestones())
  } catch (error) {
    console.error('Failed to fetch milestones:', error)
    return NextResponse.json({ error: 'Failed to fetch milestones' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { project_id, name, description, due_date } = body

    if (!project_id || !name) {
      return NextResponse.json(
        { error: 'project_id and name are required' },
        { status: 400 }
      )
    }

    if (!(await isProjectMember(project_id, user.id))) {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'You are not a member of this project' },
        { status: 403 }
      )
    }

    const milestone = await createMilestone({ project_id, name, description, due_date })
    return NextResponse.json(milestone, { status: 201 })
  } catch (error) {
    console.error('Failed to create milestone:', error)
    return NextResponse.json({ error: 'Failed to create milestone' }, { status: 500 })
  }
}
