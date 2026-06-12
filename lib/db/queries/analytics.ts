// Workspace analytics. One entry point: computeAnalytics(opts) returns a fully
// shaped AnalyticsPayload for the requested view + scope + date range.
//
// All queries are workspace-scoped — there is no cross-workspace leakage.
// We accept the cost of computing live (no materialized views) up to roughly
// 100k events per workspace. Optimization is future work and only if measured.

import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client'

export type AnalyticsView = 'workspace' | 'project' | 'milestone' | 'member'

export interface AnalyticsScope {
  type: AnalyticsView
  id: number | null
  label: string
}

export interface AnalyticsPayload {
  scope: AnalyticsScope
  period: { from: string | null; to: string | null }
  summary: {
    total_issues: number
    open: number
    in_progress: number
    done: number
    cancelled: number
    created_in_period: number
    completed_in_period: number
    avg_cycle_time_hours: number | null
    total_members: number
    active_members_in_period: number
  }
  by_status: Array<{ status: string; count: number }>
  by_priority: Array<{ priority: number; count: number }>
  by_assignee: Array<{
    user_id: number
    name: string | null
    email: string
    open: number
    done: number
  }>
  by_label: Array<{ label_id: number; name: string; color: string; count: number }>
  velocity_series: Array<{ bucket: string; created: number; completed: number }>
  burndown_series?: Array<{ date: string; remaining: number }>
  top_active_members: Array<{ user_id: number; name: string | null; events: number }>
}

export interface ComputeAnalyticsInput {
  workspaceId: number
  view: AnalyticsView
  id?: number | null
  from?: Date | null
  to?: Date | null
}

// Build a SQL fragment that restricts the issues query to the requested scope.
function scopeWhere(input: ComputeAnalyticsInput): SQL {
  // Binned issues never count toward analytics. This base predicate flows into
  // summary / by_status / by_priority / by_assignee / by_label / velocity via
  // ${where}. The burndown sub-selects below bypass `where`, so they carry the
  // `deleted_at IS NULL` filter explicitly.
  const base = sql`i.workspace_id = ${input.workspaceId} AND i.deleted_at IS NULL`
  if (input.view === 'workspace') return base
  if (input.view === 'project' && input.id != null) {
    return sql`${base} AND i.project_id = ${input.id}`
  }
  if (input.view === 'milestone' && input.id != null) {
    return sql`${base} AND i.milestone_id = ${input.id}`
  }
  if (input.view === 'member' && input.id != null) {
    // Issues this member is involved with: assignee OR reporter.
    return sql`${base} AND (i.assignee_id = ${input.id} OR i.reporter_id = ${input.id})`
  }
  return base
}

function periodWhere(from?: Date | null, to?: Date | null, col: 'created_at' | 'completed_at' = 'created_at'): SQL {
  if (from && to) return sql`AND i.${sql.raw(col)} BETWEEN ${from} AND ${to}`
  if (from) return sql`AND i.${sql.raw(col)} >= ${from}`
  if (to) return sql`AND i.${sql.raw(col)} <= ${to}`
  return sql``
}

async function resolveScope(input: ComputeAnalyticsInput): Promise<AnalyticsScope> {
  if (input.view === 'workspace') {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM workspaces WHERE id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'workspace', id: null, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'project' && input.id != null) {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM projects WHERE id = ${input.id} AND workspace_id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'project', id: input.id, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'milestone' && input.id != null) {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM milestones WHERE id = ${input.id} AND workspace_id = ${input.workspaceId} LIMIT 1`
    )
    return { type: 'milestone', id: input.id, label: rows.rows[0]?.name ?? '' }
  }
  if (input.view === 'member' && input.id != null) {
    const rows = await db.execute<{ email: string; name: string | null }>(
      sql`SELECT email, name FROM users WHERE id = ${input.id} LIMIT 1`
    )
    return { type: 'member', id: input.id, label: rows.rows[0]?.name ?? rows.rows[0]?.email ?? '' }
  }
  return { type: input.view, id: input.id ?? null, label: '' }
}

export async function computeAnalytics(input: ComputeAnalyticsInput): Promise<AnalyticsPayload> {
  const scope = await resolveScope(input)
  const where = scopeWhere(input)
  const wherePeriod = periodWhere(input.from, input.to, 'created_at')
  const wherePeriodCompleted = periodWhere(input.from, input.to, 'completed_at')

  // Summary
  const summaryRows = await db.execute<{
    total_issues: number
    open: number
    in_progress: number
    done: number
    cancelled: number
    created_in_period: number
    completed_in_period: number
    avg_cycle_hours: number | null
  }>(sql`
    SELECT
      COUNT(*)::int AS total_issues,
      COUNT(*) FILTER (WHERE i.status IN ('backlog','todo'))::int AS open,
      COUNT(*) FILTER (WHERE i.status = 'in_progress')::int AS in_progress,
      COUNT(*) FILTER (WHERE i.status = 'done')::int AS done,
      COUNT(*) FILTER (WHERE i.status = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE 1=1 ${wherePeriod})::int AS created_in_period,
      COUNT(*) FILTER (WHERE i.status = 'done' ${wherePeriodCompleted})::int AS completed_in_period,
      AVG(EXTRACT(EPOCH FROM (i.completed_at - i.created_at)) / 3600) FILTER (WHERE i.completed_at IS NOT NULL) AS avg_cycle_hours
    FROM issues i
    WHERE ${where}
  `)
  const summary = summaryRows.rows[0] ?? {
    total_issues: 0,
    open: 0,
    in_progress: 0,
    done: 0,
    cancelled: 0,
    created_in_period: 0,
    completed_in_period: 0,
    avg_cycle_hours: null,
  }

  // Members
  const membersRows = await db.execute<{ total: number; active: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = ${input.workspaceId}) AS total,
      (SELECT COUNT(DISTINCT e.actor_user_id)::int
        FROM events e
        WHERE e.workspace_id = ${input.workspaceId}
          AND e.actor_user_id IS NOT NULL
          ${input.from ? sql`AND e.occurred_at >= ${input.from}` : sql``}
          ${input.to ? sql`AND e.occurred_at <= ${input.to}` : sql``}) AS active
  `)
  const members = membersRows.rows[0] ?? { total: 0, active: 0 }

  // By status
  const byStatusRows = await db.execute<{ status: string; count: number }>(sql`
    SELECT i.status, COUNT(*)::int AS count
    FROM issues i WHERE ${where}
    GROUP BY i.status ORDER BY count DESC
  `)

  // By priority
  const byPriorityRows = await db.execute<{ priority: number; count: number }>(sql`
    SELECT i.priority, COUNT(*)::int AS count
    FROM issues i WHERE ${where}
    GROUP BY i.priority ORDER BY i.priority ASC
  `)

  // By assignee
  const byAssigneeRows = await db.execute<{
    user_id: number
    name: string | null
    email: string
    open: number
    done: number
  }>(sql`
    SELECT u.id AS user_id, u.name, u.email,
      COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled'))::int AS open,
      COUNT(*) FILTER (WHERE i.status = 'done')::int AS done
    FROM issues i
    INNER JOIN users u ON u.id = i.assignee_id
    WHERE ${where}
    GROUP BY u.id, u.name, u.email
    ORDER BY (COUNT(*) FILTER (WHERE i.status NOT IN ('done','cancelled'))) DESC
    LIMIT 25
  `)

  // By label
  const byLabelRows = await db.execute<{
    label_id: number
    name: string
    color: string
    count: number
  }>(sql`
    SELECT l.id AS label_id, l.name, l.color, COUNT(*)::int AS count
    FROM issue_labels il
    INNER JOIN issues i ON i.id = il.issue_id
    INNER JOIN labels l ON l.id = il.label_id
    WHERE ${where}
    GROUP BY l.id, l.name, l.color
    ORDER BY count DESC
    LIMIT 25
  `)

  // Velocity (daily): issues created vs completed per day in window.
  // Default window: last 30 days if no from/to passed.
  const from = input.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const to = input.to ?? new Date()

  const velocityRows = await db.execute<{
    bucket: string
    created: number
    completed: number
  }>(sql`
    WITH days AS (
      SELECT generate_series(date_trunc('day', ${from}::timestamptz),
                             date_trunc('day', ${to}::timestamptz),
                             interval '1 day')::date AS d
    )
    SELECT
      to_char(days.d, 'YYYY-MM-DD') AS bucket,
      COALESCE(c.count, 0)::int AS created,
      COALESCE(done.count, 0)::int AS completed
    FROM days
    LEFT JOIN (
      SELECT date_trunc('day', i.created_at)::date AS d, COUNT(*) AS count
      FROM issues i WHERE ${where} GROUP BY 1
    ) c ON c.d = days.d
    LEFT JOIN (
      SELECT date_trunc('day', i.completed_at)::date AS d, COUNT(*) AS count
      FROM issues i WHERE ${where} AND i.completed_at IS NOT NULL GROUP BY 1
    ) done ON done.d = days.d
    ORDER BY days.d ASC
  `)

  // Top active members (by events)
  const topMembersRows = await db.execute<{
    user_id: number
    name: string | null
    events: number
  }>(sql`
    SELECT e.actor_user_id AS user_id, u.name, COUNT(*)::int AS events
    FROM events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.workspace_id = ${input.workspaceId}
      AND e.actor_user_id IS NOT NULL
      ${input.from ? sql`AND e.occurred_at >= ${input.from}` : sql``}
      ${input.to ? sql`AND e.occurred_at <= ${input.to}` : sql``}
    GROUP BY e.actor_user_id, u.name
    ORDER BY events DESC
    LIMIT 10
  `)

  // Optional milestone burndown.
  let burndown: AnalyticsPayload['burndown_series']
  if (input.view === 'milestone' && input.id != null) {
    const m = await db.execute<{ due_date: string | null }>(
      sql`SELECT due_date FROM milestones WHERE id = ${input.id} LIMIT 1`
    )
    const due = m.rows[0]?.due_date
    if (due) {
      // For each day from milestone creation to due date (or today, whichever later),
      // compute "issues not yet done" by that EOD. We approximate creation date as
      // earliest issue created_at of the milestone.
      const series = await db.execute<{ date: string; remaining: number }>(sql`
        WITH bounds AS (
          SELECT
            COALESCE((SELECT MIN(i.created_at) FROM issues i WHERE i.milestone_id = ${input.id} AND i.deleted_at IS NULL), NOW() - interval '14 days') AS start_at,
            (${due}::date + interval '1 day') AS end_at
        ),
        days AS (
          SELECT generate_series(date_trunc('day', (SELECT start_at FROM bounds)),
                                 date_trunc('day', (SELECT end_at FROM bounds)),
                                 interval '1 day')::date AS d
        )
        SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
          (SELECT COUNT(*)::int FROM issues i
           WHERE i.milestone_id = ${input.id}
             AND i.deleted_at IS NULL
             AND i.created_at <= days.d + interval '1 day'
             AND (i.completed_at IS NULL OR i.completed_at > days.d + interval '1 day')) AS remaining
        FROM days
        ORDER BY days.d
      `)
      burndown = series.rows
    }
  }

  return {
    scope,
    period: {
      from: input.from?.toISOString() ?? null,
      to: input.to?.toISOString() ?? null,
    },
    summary: {
      total_issues: Number(summary.total_issues),
      open: Number(summary.open),
      in_progress: Number(summary.in_progress),
      done: Number(summary.done),
      cancelled: Number(summary.cancelled),
      created_in_period: Number(summary.created_in_period),
      completed_in_period: Number(summary.completed_in_period),
      avg_cycle_time_hours:
        summary.avg_cycle_hours == null
          ? null
          : Math.round(Number(summary.avg_cycle_hours) * 10) / 10,
      total_members: Number(members.total),
      active_members_in_period: Number(members.active),
    },
    by_status: byStatusRows.rows,
    by_priority: byPriorityRows.rows,
    by_assignee: byAssigneeRows.rows,
    by_label: byLabelRows.rows,
    velocity_series: velocityRows.rows,
    burndown_series: burndown,
    top_active_members: topMembersRows.rows,
  }
}

// Legacy helper retained for any old caller.
export async function getAnalytics() {
  return await computeAnalytics({ workspaceId: 0, view: 'workspace' })
}
