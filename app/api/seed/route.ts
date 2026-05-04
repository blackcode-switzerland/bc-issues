import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { issues, milestones, projectMembers, projects } from '@/lib/db/schema'

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const userId = user.id

    const projectSeeds = [
      { name: 'Frontend Redesign', description: 'Complete UI/UX overhaul with new design system' },
      { name: 'API v2', description: 'RESTful API redesign with GraphQL support' },
      { name: 'Mobile App', description: 'iOS and Android native applications' },
      { name: 'Infrastructure', description: 'Cloud infrastructure and DevOps improvements' },
      { name: 'Documentation', description: 'Technical documentation and API reference' },
    ]

    const createdProjects: number[] = []
    for (const proj of projectSeeds) {
      const inserted = await db
        .insert(projects)
        .values({ name: proj.name, description: proj.description, owner_id: userId })
        .onConflictDoNothing()
        .returning({ id: projects.id })
      const id = inserted[0]?.id
      if (id) {
        createdProjects.push(id)
        await db
          .insert(projectMembers)
          .values({ project_id: id, user_id: userId, role: 'owner' })
          .onConflictDoNothing()
      }
    }

    const allProjects = await db.select({ id: projects.id }).from(projects)
    const projectIds = allProjects.map((p) => p.id)

    if (projectIds.length === 0) {
      return NextResponse.json({ error: 'No projects to seed issues into' }, { status: 400 })
    }

    const milestoneSeeds = [
      { name: 'Q1 2026 Release', due: '2026-03-31' },
      { name: 'Q2 2026 Release', due: '2026-06-30' },
      { name: 'Beta Launch', due: '2026-02-15' },
      { name: 'MVP Complete', due: '2026-01-31' },
    ]

    const createdMilestones: number[] = []
    for (const ms of milestoneSeeds) {
      for (const projectId of projectIds.slice(0, 3)) {
        const inserted = await db
          .insert(milestones)
          .values({ project_id: projectId, name: ms.name, due_date: ms.due })
          .onConflictDoNothing()
          .returning({ id: milestones.id })
        if (inserted[0]?.id) createdMilestones.push(inserted[0].id)
      }
    }

    const allMilestones = await db
      .select({ id: milestones.id, project_id: milestones.project_id })
      .from(milestones)

    const issueTemplates: Array<{
      title: string
      status: string
      priority: number
      description?: string
    }> = [
      { title: 'Research competitor features', status: 'backlog', priority: 4 },
      { title: 'Define API versioning strategy', status: 'backlog', priority: 3 },
      { title: 'Create wireframes for dashboard', status: 'backlog', priority: 3 },
      { title: 'Plan database migration', status: 'backlog', priority: 2 },
      { title: 'Review security audit findings', status: 'backlog', priority: 1 },
      { title: 'Set up CI/CD pipeline', status: 'todo', priority: 2 },
      { title: 'Configure monitoring alerts', status: 'todo', priority: 2 },
      { title: 'Write unit tests for auth module', status: 'todo', priority: 3 },
      { title: 'Design new onboarding flow', status: 'todo', priority: 3 },
      { title: 'Create API documentation', status: 'todo', priority: 3 },
      { title: 'Implement user authentication', status: 'in_progress', priority: 1 },
      { title: 'Build dashboard components', status: 'in_progress', priority: 2 },
      { title: 'Optimize database queries', status: 'in_progress', priority: 2 },
      { title: 'Integrate payment gateway', status: 'in_progress', priority: 1 },
      { title: 'Refactor legacy code', status: 'in_progress', priority: 3 },
      {
        title: 'Deploy to production',
        status: 'blocked',
        priority: 1,
        description: 'Waiting for security review',
      },
      {
        title: 'External API integration',
        status: 'blocked',
        priority: 2,
        description: 'Awaiting API keys from vendor',
      },
      {
        title: 'Mobile push notifications',
        status: 'blocked',
        priority: 3,
        description: 'Blocked by iOS certificate issue',
      },
      { title: 'New feature: Dark mode', status: 'in_review', priority: 3 },
      { title: 'Performance improvements', status: 'in_review', priority: 2 },
      { title: 'Bug fix: Login issues', status: 'in_review', priority: 1 },
      { title: 'Update dependencies', status: 'in_review', priority: 4 },
      { title: 'Initial project setup', status: 'done', priority: 2 },
      { title: 'Configure development environment', status: 'done', priority: 2 },
      { title: 'Create database schema', status: 'done', priority: 1 },
      { title: 'Implement basic routing', status: 'done', priority: 3 },
      { title: 'Set up error handling', status: 'done', priority: 2 },
    ]

    let issuesCreated = 0
    for (const t of issueTemplates) {
      const projectId = projectIds[Math.floor(Math.random() * projectIds.length)]
      const projectMilestones = allMilestones.filter((m) => m.project_id === projectId)
      const milestoneId =
        projectMilestones.length > 0 && Math.random() > 0.5
          ? projectMilestones[Math.floor(Math.random() * projectMilestones.length)].id
          : null

      await db.insert(issues).values({
        project_id: projectId,
        title: t.title,
        description: t.description ?? `Description for: ${t.title}`,
        status: t.status,
        priority: t.priority,
        milestone_id: milestoneId,
        reporter_id: userId,
        assignee_id: Math.random() > 0.3 ? userId : null,
      })
      issuesCreated++
    }

    const sampleIssues = (
      await db.execute(sql`SELECT id FROM issues ORDER BY RANDOM() LIMIT 15`)
    ).rows as Array<{ id: number }>
    const commentSeeds = [
      'Looking good! Ready for review.',
      'Can we discuss this in the standup?',
      'I have some concerns about the approach.',
      'Great progress on this!',
      'Need more details on the requirements.',
      'This might take longer than estimated.',
      'Found a potential edge case we should handle.',
      'Updated the implementation based on feedback.',
    ]
    for (const issue of sampleIssues) {
      const numComments = Math.floor(Math.random() * 3) + 1
      for (let i = 0; i < numComments; i++) {
        const content = commentSeeds[Math.floor(Math.random() * commentSeeds.length)]
        await db.execute(
          sql`INSERT INTO comments (issue_id, user_id, content) VALUES (${issue.id}, ${userId}, ${content})`
        )
      }
    }

    return NextResponse.json({
      success: true,
      created: {
        projects: createdProjects.length,
        milestones: createdMilestones.length,
        issues: issuesCreated,
      },
    })
  } catch (error) {
    console.error('Failed to seed data:', error)
    return NextResponse.json(
      { error: 'Failed to seed data', details: String(error) },
      { status: 500 }
    )
  }
}
