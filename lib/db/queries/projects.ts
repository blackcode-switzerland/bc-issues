// Project queries — workspace-scoped.
//
// Permission model: anyone who is a workspace_member sees every project in
// that workspace. project_members is now used as the project's *member list*
// (people working on it), not for access control — see project-relations.ts.
//
// Every mutation records an event in the same transaction.

import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '../client'
import { projects, type Project } from '../schema'
import { recordEvent } from './events'
import { setProjectLabels, setProjectMembers } from './project-relations'

export interface ProjectListItem extends Project {
  issue_count: number
  open_issues: number
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  health: string | null
  health_at: string | null
}

export async function listProjectsInWorkspace(
  workspaceId: number,
  options: { status?: string; search?: string } = {}
): Promise<ProjectListItem[]> {
  const result = await db.execute(sql`
    SELECT
      p.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int AS open_issues,
      lead.name AS lead_name,
      lead.email AS lead_email,
      lead.avatar_url AS lead_avatar,
      upd.status AS health,
      upd.created_at AS health_at
    FROM projects p
    LEFT JOIN issues i ON i.project_id = p.id
    LEFT JOIN users lead ON lead.id = p.owner_id
    LEFT JOIN LATERAL (
      SELECT status, created_at
      FROM project_updates pu
      WHERE pu.project_id = p.id
      ORDER BY pu.created_at DESC, pu.id DESC
      LIMIT 1
    ) upd ON true
    WHERE p.workspace_id = ${workspaceId}
      ${options.status ? sql`AND p.status = ${options.status}` : sql``}
      ${
        options.search
          ? sql`AND (p.name ILIKE ${'%' + options.search + '%'} OR p.description ILIKE ${'%' + options.search + '%'})`
          : sql``
      }
    GROUP BY p.id, lead.name, lead.email, lead.avatar_url, upd.status, upd.created_at
    ORDER BY p.updated_at DESC
  `)
  return result.rows as unknown as ProjectListItem[]
}

export interface ProjectsPage {
  data: ProjectListItem[]
  next_cursor: number | null
}

export async function pageProjectsInWorkspace(opts: {
  workspaceId: number
  limit: number
  cursor?: number | null
}): Promise<ProjectsPage> {
  const { workspaceId, limit, cursor } = opts
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT
      p.*,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done', 'cancelled'))::int AS open_issues
    FROM projects p
    LEFT JOIN issues i ON i.project_id = p.id
    WHERE p.workspace_id = ${workspaceId}
      ${filterCursor ? sql`AND p.id < ${cursor}` : sql``}
    GROUP BY p.id
    ORDER BY p.id DESC
    LIMIT ${limit + 1}
  `)

  const rows = result.rows as unknown as (ProjectListItem & { id: number })[]
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}

export async function getProjectInWorkspace(
  workspaceId: number,
  id: number
): Promise<Project | null> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
    .limit(1)
  return rows[0] ?? null
}

// Legacy compatibility — used by the old /api/projects/[id] endpoint while the
// dashboard UI still calls it. Just fetches by id; workspace gating happens at
// the route layer.
export async function getProject(id: number): Promise<Project | null> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
  return rows[0] ?? null
}

export interface CreateProjectInput {
  workspaceId: number
  name: string
  description?: string | null
  color?: string
  icon?: string | null
  priority?: string
  lead_user_id?: number | null
  start_date?: string | null
  end_date?: string | null
  status?: string
  member_ids?: number[]
  label_ids?: number[]
  actorUserId: number
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({
        workspace_id: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? '#3B82F6',
        icon: input.icon ?? null,
        priority: input.priority ?? 'P2',
        owner_id: input.lead_user_id ?? input.actorUserId,
        status: input.status ?? 'backlog',
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
      })
      .returning()
    if (!row) throw new Error('project insert returned nothing')

    if (input.member_ids && input.member_ids.length > 0) {
      await setProjectMembers(tx, row.id, input.member_ids)
    }
    if (input.label_ids && input.label_ids.length > 0) {
      await setProjectLabels(tx, row.id, input.workspaceId, input.label_ids)
    }

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: 'project',
      entityId: row.id,
      action: 'created',
      diff: {
        after: { name: row.name, description: row.description, status: row.status },
      },
    })

    return row
  })
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  status?: string
  color?: string
  icon?: string | null
  priority?: string
  lead_user_id?: number | null
  start_date?: string | null
  end_date?: string | null
}

const PROJECT_DIFF_KEYS = [
  'name',
  'description',
  'status',
  'color',
  'icon',
  'priority',
  'start_date',
  'end_date',
] as const

export async function updateProject(
  workspaceId: number,
  id: number,
  patch: UpdateProjectInput,
  actorUserId: number
): Promise<Project | null> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null

    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = patch.description
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.color !== undefined) updates.color = patch.color
    if (patch.icon !== undefined) updates.icon = patch.icon
    if (patch.priority !== undefined) updates.priority = patch.priority
    if (patch.lead_user_id !== undefined) updates.owner_id = patch.lead_user_id
    if (patch.start_date !== undefined) updates.start_date = patch.start_date
    if (patch.end_date !== undefined) updates.end_date = patch.end_date

    if (Object.keys(updates).length === 0) return before
    updates.updated_at = new Date()

    const [after] = await tx
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    for (const k of PROJECT_DIFF_KEYS) {
      if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
        beforeSnap[k] = (before as Record<string, unknown>)[k]
        afterSnap[k] = (after as Record<string, unknown>)[k]
      }
    }

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'project',
      entityId: id,
      action: 'updated',
      diff: { before: beforeSnap, after: afterSnap },
    })
    return after
  })
}

export async function deleteProject(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
      .limit(1)
    if (!beforeRows[0]) return false

    // Record event BEFORE delete so the FK cascade doesn't wipe it (events
    // cascade-deletes with workspace, not with project; this is fine).
    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'project',
      entityId: id,
      action: 'deleted',
      diff: { before: { name: beforeRows[0].name, status: beforeRows[0].status } },
    })

    const result = await tx
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.workspace_id, workspaceId)))
    return (result.rowCount ?? 0) > 0
  })
}

// --- Legacy compatibility shims ---
// Kept to avoid touching every old call site. They forward to the new
// workspace-aware functions. The Phase 13 cleanup will remove these.

export async function getProjects(userId?: number) {
  if (userId === undefined) {
    const result = await db.execute(sql`
      SELECT p.*, COUNT(i.id)::int AS issue_count,
        COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
      FROM projects p LEFT JOIN issues i ON i.project_id = p.id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `)
    return result.rows
  }
  // Limit to projects in workspaces the user is a member of.
  const result = await db.execute(sql`
    SELECT p.*,
      wm.role AS member_role,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
    FROM projects p
    INNER JOIN workspace_members wm
      ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
    LEFT JOIN issues i ON i.project_id = p.id
    GROUP BY p.id, wm.role
    ORDER BY p.updated_at DESC
  `)
  return result.rows
}

export async function getProjectsPage(opts: {
  user_id: number
  limit: number
  cursor?: number | null
}): Promise<ProjectsPage> {
  const { user_id, limit, cursor } = opts
  const filterCursor = cursor !== undefined && cursor !== null

  const result = await db.execute(sql`
    SELECT p.*,
      wm.role AS member_role,
      COUNT(i.id)::int AS issue_count,
      COUNT(i.id) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open_issues
    FROM projects p
    INNER JOIN workspace_members wm
      ON wm.workspace_id = p.workspace_id AND wm.user_id = ${user_id}
    LEFT JOIN issues i ON i.project_id = p.id
    WHERE 1=1
      ${filterCursor ? sql`AND p.id < ${cursor}` : sql``}
    GROUP BY p.id, wm.role
    ORDER BY p.id DESC
    LIMIT ${limit + 1}
  `)
  const rows = result.rows as unknown as (ProjectListItem & { id: number })[]
  const has_more = rows.length > limit
  const data = has_more ? rows.slice(0, limit) : rows
  const next_cursor = has_more ? data[data.length - 1].id : null
  return { data, next_cursor }
}
