import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import {
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  getProjectMemberRole,
  getUserByEmail,
} from '@/lib/db'

// GET /api/projects/:id/members - List project members
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const projectId = parseInt(id)
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: 'Invalid project ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const members = await getProjectMembers(projectId)
    return NextResponse.json(members)
  } catch (error) {
    console.error('Failed to fetch project members:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project members' },
      { status: 500 }
    )
  }
}

// POST /api/projects/:id/members - Add member to project
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const projectId = parseInt(id)
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: 'Invalid project ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const currentUserRole = await getProjectMemberRole(projectId, user.id)
    if (!currentUserRole || !['owner', 'admin'].includes(currentUserRole)) {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'Only project owners and admins can add members' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { email, role = 'member' } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Invalid email', suggestion: 'email is required' },
        { status: 400 }
      )
    }

    const validRoles = ['owner', 'admin', 'member', 'viewer']
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role', suggestion: `Valid roles: ${validRoles.join(', ')}` },
        { status: 400 }
      )
    }

    const target = await getUserByEmail(email)
    if (!target) {
      return NextResponse.json(
        { error: 'User not found', suggestion: 'User must sign in at least once before being added' },
        { status: 404 }
      )
    }

    const member = await addProjectMember(projectId, target.id, role)
    return NextResponse.json(
      {
        ...member,
        name: target.name,
        email: target.email,
        avatar_url: target.avatar_url,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Failed to add project member:', error)
    return NextResponse.json(
      { error: 'Failed to add project member' },
      { status: 500 }
    )
  }
}

// DELETE /api/projects/:id/members - Remove member from project
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const projectId = parseInt(id)
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: 'Invalid project ID', suggestion: 'ID must be an integer' },
        { status: 400 }
      )
    }

    const currentUserRole = await getProjectMemberRole(projectId, user.id)
    if (!currentUserRole || !['owner', 'admin'].includes(currentUserRole)) {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'Only project owners and admins can remove members' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { user_id } = body

    if (!user_id || typeof user_id !== 'number') {
      return NextResponse.json(
        { error: 'Invalid user_id', suggestion: 'user_id is required and must be an integer' },
        { status: 400 }
      )
    }

    // Prevent removing owners (only owners can remove other owners)
    const targetUserRole = await getProjectMemberRole(projectId, user_id)
    if (targetUserRole === 'owner' && currentUserRole !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'Only project owners can remove other owners' },
        { status: 403 }
      )
    }

    await removeProjectMember(projectId, user_id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to remove project member:', error)
    return NextResponse.json(
      { error: 'Failed to remove project member' },
      { status: 500 }
    )
  }
}
