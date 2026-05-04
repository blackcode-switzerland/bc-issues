import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { createProject, getProjects, getProjectsPage } from '@/lib/db'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const rawLimit = sp.get('limit')
    const rawCursor = sp.get('cursor')

    if (rawLimit !== null || rawCursor !== null) {
      let limit = DEFAULT_LIMIT
      if (rawLimit !== null) {
        const n = parseInt(rawLimit)
        if (!Number.isNaN(n) && n >= 1) limit = Math.min(n, MAX_LIMIT)
      }
      let cursor: number | null = null
      if (rawCursor !== null) {
        const n = parseInt(rawCursor)
        cursor = Number.isNaN(n) ? null : n
      }
      const result = await getProjectsPage({ user_id: user.id, limit, cursor })
      return NextResponse.json(result)
    }

    const projects = await getProjects(user.id)
    return NextResponse.json(projects)
  } catch (error) {
    console.error('Failed to fetch projects:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, description } = body

    if (!name || typeof name !== 'string' || name.length > 100) {
      return NextResponse.json(
        { error: 'Invalid name', suggestion: 'Name is required, max 100 chars' },
        { status: 400 }
      )
    }

    const project = await createProject({ name, description, owner_id: user.id })
    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    console.error('Failed to create project:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
