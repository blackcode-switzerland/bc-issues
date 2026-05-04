import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { updateMilestone, deleteMilestone, getMilestoneWithDetails, getIssuesByMilestone } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const searchParams = request.nextUrl.searchParams
    const includeIssues = searchParams.get('includeIssues') === 'true'

    const milestone = await getMilestoneWithDetails(id)
    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (includeIssues) {
      const issues = await getIssuesByMilestone(id)
      return NextResponse.json({ ...milestone, issues })
    }

    return NextResponse.json(milestone)
  } catch (error) {
    console.error('Failed to fetch milestone:', error)
    return NextResponse.json(
      { error: 'Failed to fetch milestone' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const body = await request.json()
    const { name, description, due_date } = body

    const milestone = await updateMilestone(id, {
      name,
      description,
      due_date,
    })

    if (!milestone) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    return NextResponse.json(milestone)
  } catch (error) {
    console.error('Failed to update milestone:', error)
    return NextResponse.json(
      { error: 'Failed to update milestone' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: idStr } = await params
    const id = parseInt(idStr)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    await deleteMilestone(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete milestone:', error)
    return NextResponse.json(
      { error: 'Failed to delete milestone' },
      { status: 500 }
    )
  }
}
