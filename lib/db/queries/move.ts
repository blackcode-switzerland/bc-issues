// Cross-workspace item transfer — copy or move projects / tasks / issues (and
// all their satellite data) from one workspace into another the user also
// belongs to.
//
// Design goals
// ------------
//  1. NEVER lose data. The whole operation runs inside a single db.transaction:
//     we copy everything into the target first, then (for mode='move') soft-
//     delete the source rows into the recycle bin in the SAME transaction. Any
//     failure rolls the whole thing back — the source is left exactly as it was
//     and no half-written rows appear in the target.
//  2. Preserve everything we control. New workspace-scoped #numbers (seq) are
//     allocated in the target so they can never collide. Labels are workspace-
//     scoped by id, so they are re-created/matched by name in the target
//     (auto-create). Comments, attachments, watchers, assignees, project
//     members, project updates and rich-text bodies all come along.
//  3. Silently drop only what we genuinely cannot carry: a user reference
//     (assignee / reporter / lead / owner / watcher / project member / comment
//     author / @mention) is kept only if that user is a member of the target
//     workspace; otherwise it is dropped and noted in the report. Nothing else
//     is discarded.
//
// The move never mutates the target's counters or labels outside the tx, so a
// rollback leaves the target's seq counters advanced by nothing that committed.
//
// Parent/child links: when a child (task/issue) is transferred but its parent
// (project/task) is not part of the same operation, the link is cleared in the
// target (and reported) rather than left dangling into the source workspace.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  attachments,
  comments,
  deletionBatches,
  issueAssignees,
  issueLabels,
  issueWatchers,
  issues,
  labels,
  projectLabels,
  projectMembers,
  projectUpdates,
  projects,
  tasks,
  workspaceMembers,
} from '../schema'
import { recordEvent } from './events'
import { resolveOrCreateLabels } from './labels'
import {
  allocateNextIssueSeq,
  allocateNextProjectSeq,
  allocateNextTaskSeq,
} from './workspaces'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type MoveMode = 'move' | 'copy'
type ItemType = 'project' | 'task' | 'issue'

export interface MoveItemsInput {
  sourceWorkspaceId: number
  targetWorkspaceId: number
  mode: MoveMode
  /** Workspace-facing #numbers (seq) in the SOURCE workspace. */
  projectSeqs: number[]
  taskSeqs: number[]
  issueSeqs: number[]
  /** When a selected project is transferred, also carry its tasks. Default true. */
  cascadeTasks: boolean
  /** When a project/task is transferred, also carry its issues. Default true. */
  cascadeIssues: boolean
  actorUserId: number
}

export interface MovedRef {
  id: number
  source_seq: number | null
  target_seq: number | null
  title: string
}

export interface MoveAdjustment {
  kind:
    | 'assignee_dropped'
    | 'watcher_dropped'
    | 'reporter_cleared'
    | 'lead_cleared'
    | 'owner_cleared'
    | 'author_cleared'
    | 'comment_author_cleared'
    | 'mention_dropped'
    | 'project_member_dropped'
    | 'project_link_cleared'
    | 'task_link_cleared'
  entity_type: ItemType
  source_seq: number | null
  detail: string
}

export interface MoveReport {
  mode: MoveMode
  moved: {
    projects: MovedRef[]
    tasks: MovedRef[]
    issues: MovedRef[]
  }
  adjustments: MoveAdjustment[]
  source_deleted: boolean
}

// Thrown for a requested seq that doesn't exist (or is already deleted) in the
// source workspace. The route maps this to a 400 so the caller can fix the id
// list — we deliberately fail fast on the explicitly-requested set rather than
// silently skipping, so nobody thinks an item moved when it didn't.
export class ItemNotFoundError extends Error {
  constructor(
    public itemType: ItemType,
    public seq: number
  ) {
    super(`${itemType}_not_found:${seq}`)
    this.name = 'ItemNotFoundError'
  }
}

// Nothing at all was selected (after cascade expansion). Route → 400.
export class NothingToMoveError extends Error {
  constructor() {
    super('nothing_to_move')
    this.name = 'NothingToMoveError'
  }
}

export async function moveItems(input: MoveItemsInput): Promise<MoveReport> {
  const {
    sourceWorkspaceId: srcWs,
    targetWorkspaceId: tgtWs,
    mode,
    actorUserId,
  } = input

  return await db.transaction(async (tx) => {
    const adjustments: MoveAdjustment[] = []

    // Users we are allowed to keep as references in the target.
    const memberRows = await tx
      .select({ user_id: workspaceMembers.user_id })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspace_id, tgtWs))
    const targetMembers = new Set(memberRows.map((r) => r.user_id))
    const keepUser = (uid: number | null): number | null =>
      uid != null && targetMembers.has(uid) ? uid : null

    // ---- 1. Resolve the explicitly-requested rows (by source seq) ----
    const selProjects = await (async (): Promise<ProjectRow[]> => {
      if (input.projectSeqs.length === 0) return []
      const uniq = [...new Set(input.projectSeqs)]
      const rows = await tx.select().from(projects).where(and(eq(projects.workspace_id, srcWs), inArray(projects.seq, uniq), isNull(projects.deleted_at)))
      assertAllFound(uniq, rows, 'project')
      return rows
    })()
    const selTasks = await (async (): Promise<TaskRow[]> => {
      if (input.taskSeqs.length === 0) return []
      const uniq = [...new Set(input.taskSeqs)]
      const rows = await tx.select().from(tasks).where(and(eq(tasks.workspace_id, srcWs), inArray(tasks.seq, uniq), isNull(tasks.deleted_at)))
      assertAllFound(uniq, rows, 'task')
      return rows
    })()
    const selIssues = await (async (): Promise<IssueRow[]> => {
      if (input.issueSeqs.length === 0) return []
      const uniq = [...new Set(input.issueSeqs)]
      const rows = await tx.select().from(issues).where(and(eq(issues.workspace_id, srcWs), inArray(issues.seq, uniq), isNull(issues.deleted_at)))
      assertAllFound(uniq, rows, 'issue')
      return rows
    })()

    // ---- 2. Expand cascade (project → tasks/issues, task → issues) ----
    const projectRows = new Map<number, ProjectRow>()
    const taskRows = new Map<number, TaskRow>()
    const issueRows = new Map<number, IssueRow>()
    for (const p of selProjects) projectRows.set(p.id, p)
    for (const t of selTasks) taskRows.set(t.id, t)
    for (const i of selIssues) issueRows.set(i.id, i)

    if (input.cascadeTasks && projectRows.size > 0) {
      const childTasks = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspace_id, srcWs),
            isNull(tasks.deleted_at),
            inArray(tasks.project_id, [...projectRows.keys()])
          )
        )
      for (const t of childTasks) taskRows.set(t.id, t as TaskRow)
    }
    if (input.cascadeIssues) {
      const parentProjectIds = [...projectRows.keys()]
      const parentTaskIds = [...taskRows.keys()]
      const orClauses = []
      if (parentProjectIds.length > 0) orClauses.push(inArray(issues.project_id, parentProjectIds))
      if (parentTaskIds.length > 0) orClauses.push(inArray(issues.task_id, parentTaskIds))
      if (orClauses.length > 0) {
        const childIssues = await tx
          .select()
          .from(issues)
          .where(
            and(
              eq(issues.workspace_id, srcWs),
              isNull(issues.deleted_at),
              orClauses.length === 1 ? orClauses[0] : sql`(${orClauses[0]} OR ${orClauses[1]})`
            )
          )
        for (const i of childIssues) issueRows.set(i.id, i as IssueRow)
      }
    }

    if (projectRows.size === 0 && taskRows.size === 0 && issueRows.size === 0) {
      throw new NothingToMoveError()
    }

    // id maps: source entity id → freshly-created target entity id
    const projectIdMap = new Map<number, number>()
    const taskIdMap = new Map<number, number>()
    const issueIdMap = new Map<number, number>()

    const report: MoveReport = {
      mode,
      moved: { projects: [], tasks: [], issues: [] },
      adjustments,
      source_deleted: false,
    }

    // ---- 3. Copy projects ----
    for (const p of projectRows.values()) {
      const seq = await allocateNextProjectSeq(tx, tgtWs)
      const owner = keepUser(p.owner_id)
      if (p.owner_id != null && owner == null) {
        adjustments.push({ kind: 'owner_cleared', entity_type: 'project', source_seq: p.seq, detail: `owner (user ${p.owner_id}) is not a member of the target workspace` })
      }
      const [row] = await tx
        .insert(projects)
        .values({
          workspace_id: tgtWs,
          name: p.name,
          summary: p.summary,
          description: p.description,
          status: p.status,
          seq,
          owner_id: owner,
          priority: p.priority,
          visibility: p.visibility,
          color: p.color,
          icon: p.icon,
          icon_url: p.icon_url,
          banner_url: p.banner_url,
          start_date: p.start_date,
          due_date: p.due_date,
          created_at: p.created_at,
          updated_at: p.updated_at,
        })
        .returning({ id: projects.id })
      if (!row) throw new Error('project copy returned nothing')
      projectIdMap.set(p.id, row.id)
      report.moved.projects.push({ id: row.id, source_seq: p.seq, target_seq: seq, title: p.name })

      // project labels (remap by name), members (target only), updates, comments
      await copyLabels(tx, tgtWs, actorUserId, 'project', p.id, row.id)
      await copyProjectMembers(tx, p.id, row.id, targetMembers, adjustments, p.seq)
      await copyProjectUpdates(tx, tgtWs, p.id, row.id, keepUser)
      await copyComments(tx, srcWs, tgtWs, 'project', p.id, row.id, null, targetMembers, adjustments, 'project', p.seq)

      await recordEvent(tx, {
        workspaceId: tgtWs,
        actorUserId,
        entityType: 'project',
        entityId: row.id,
        action: 'created',
        meta: { seq, moved_from_workspace_id: srcWs, source_seq: p.seq },
      })
    }

    // ---- 4. Copy tasks ----
    for (const t of taskRows.values()) {
      const seq = await allocateNextTaskSeq(tx, tgtWs)
      const projectId = remapParent(t.project_id, projectIdMap)
      if (t.project_id != null && projectId == null) {
        adjustments.push({ kind: 'project_link_cleared', entity_type: 'task', source_seq: t.seq, detail: 'parent project was not part of this transfer' })
      }
      const lead = keepUser(t.lead_id)
      if (t.lead_id != null && lead == null) {
        adjustments.push({ kind: 'lead_cleared', entity_type: 'task', source_seq: t.seq, detail: `lead (user ${t.lead_id}) is not a member of the target workspace` })
      }
      const [row] = await tx
        .insert(tasks)
        .values({
          workspace_id: tgtWs,
          project_id: projectId,
          name: t.name,
          description: t.description,
          due_date: t.due_date,
          status: t.status,
          seq,
          lead_id: lead,
          created_at: t.created_at,
          updated_at: t.updated_at,
        })
        .returning({ id: tasks.id })
      if (!row) throw new Error('task copy returned nothing')
      taskIdMap.set(t.id, row.id)
      report.moved.tasks.push({ id: row.id, source_seq: t.seq, target_seq: seq, title: t.name })

      await copyComments(tx, srcWs, tgtWs, 'task', t.id, row.id, null, targetMembers, adjustments, 'task', t.seq)

      await recordEvent(tx, {
        workspaceId: tgtWs,
        actorUserId,
        entityType: 'task',
        entityId: row.id,
        action: 'created',
        meta: { seq, moved_from_workspace_id: srcWs, source_seq: t.seq },
      })
    }

    // ---- 5. Copy issues ----
    for (const i of issueRows.values()) {
      const seq = await allocateNextIssueSeq(tx, tgtWs)
      const projectId = remapParent(i.project_id, projectIdMap)
      if (i.project_id != null && projectId == null) {
        adjustments.push({ kind: 'project_link_cleared', entity_type: 'issue', source_seq: i.seq, detail: 'parent project was not part of this transfer' })
      }
      const taskId = remapParent(i.task_id, taskIdMap)
      if (i.task_id != null && taskId == null) {
        adjustments.push({ kind: 'task_link_cleared', entity_type: 'issue', source_seq: i.seq, detail: 'parent task was not part of this transfer' })
      }
      const reporter = keepUser(i.reporter_id)
      if (i.reporter_id != null && reporter == null) {
        adjustments.push({ kind: 'reporter_cleared', entity_type: 'issue', source_seq: i.seq, detail: `reporter (user ${i.reporter_id}) is not a member of the target workspace` })
      }
      const [row] = await tx
        .insert(issues)
        .values({
          workspace_id: tgtWs,
          seq,
          project_id: projectId,
          task_id: taskId,
          title: i.title,
          description: i.description,
          status: i.status,
          priority: i.priority,
          reporter_id: reporter,
          start_date: i.start_date,
          due_date: i.due_date,
          estimated_hours: i.estimated_hours,
          completed_at: i.completed_at,
          cancelled_at: i.cancelled_at,
          created_at: i.created_at,
          updated_at: i.updated_at,
        })
        .returning({ id: issues.id })
      if (!row) throw new Error('issue copy returned nothing')
      issueIdMap.set(i.id, row.id)
      report.moved.issues.push({ id: row.id, source_seq: i.seq, target_seq: seq, title: i.title })

      // assignees (target members only)
      const asg = await tx
        .select({ user_id: issueAssignees.user_id })
        .from(issueAssignees)
        .where(eq(issueAssignees.issue_id, i.id))
      const keptAssignees = asg.map((a) => a.user_id).filter((uid) => targetMembers.has(uid))
      for (const a of asg) {
        if (!targetMembers.has(a.user_id)) {
          adjustments.push({ kind: 'assignee_dropped', entity_type: 'issue', source_seq: i.seq, detail: `assignee (user ${a.user_id}) is not a member of the target workspace` })
        }
      }
      if (keptAssignees.length > 0) {
        await tx
          .insert(issueAssignees)
          .values(keptAssignees.map((uid) => ({ issue_id: row.id, user_id: uid })))
          .onConflictDoNothing()
      }

      // watchers (target members only, reason preserved)
      const wr = await tx
        .select({ user_id: issueWatchers.user_id, reason: issueWatchers.reason })
        .from(issueWatchers)
        .where(eq(issueWatchers.issue_id, i.id))
      const keptWatchers = wr.filter((w) => targetMembers.has(w.user_id))
      for (const w of wr) {
        if (!targetMembers.has(w.user_id)) {
          adjustments.push({ kind: 'watcher_dropped', entity_type: 'issue', source_seq: i.seq, detail: `watcher (user ${w.user_id}) is not a member of the target workspace` })
        }
      }
      if (keptWatchers.length > 0) {
        await tx
          .insert(issueWatchers)
          .values(keptWatchers.map((w) => ({ issue_id: row.id, user_id: w.user_id, reason: w.reason })))
          .onConflictDoNothing()
      }

      // labels (remap by name), attachments (blob shared by URL), comments
      await copyLabels(tx, tgtWs, actorUserId, 'issue', i.id, row.id)
      await copyAttachments(tx, tgtWs, i.id, row.id, keepUser)
      await copyComments(tx, srcWs, tgtWs, 'issue', i.id, row.id, row.id, targetMembers, adjustments, 'issue', i.seq)

      await recordEvent(tx, {
        workspaceId: tgtWs,
        actorUserId,
        entityType: 'issue',
        entityId: row.id,
        action: 'created',
        meta: { seq, moved_from_workspace_id: srcWs, source_seq: i.seq },
      })
    }

    // ---- 6. For a MOVE: soft-delete the source rows (same transaction) ----
    if (mode === 'move') {
      await softDeleteSource(
        tx,
        srcWs,
        actorUserId,
        [...projectRows.values()],
        [...taskRows.values()],
        [...issueRows.values()]
      )
      report.source_deleted = true
    }

    return report
  })
}

// ---------------------------------------------------------------------------
// Row shapes (the columns we read from the source)
// ---------------------------------------------------------------------------

type ProjectRow = typeof projects.$inferSelect
type TaskRow = typeof tasks.$inferSelect
type IssueRow = typeof issues.$inferSelect

// Every requested seq must resolve to an active source row; otherwise fail fast
// (ItemNotFoundError) so nobody thinks an item moved when it didn't.
function assertAllFound(requested: number[], rows: Array<{ seq: number | null }>, itemType: ItemType): void {
  const found = new Set(rows.map((r) => r.seq))
  for (const s of requested) {
    if (!found.has(s)) throw new ItemNotFoundError(itemType, s)
  }
}

function remapParent(sourceId: number | null, map: Map<number, number>): number | null {
  if (sourceId == null) return null
  return map.get(sourceId) ?? null
}

// Re-create/match the labels attached to a source entity onto the target
// entity by NAME (labels are workspace-scoped by id, so ids can't cross). Any
// name missing in the target is auto-created (resolveOrCreateLabels).
async function copyLabels(
  tx: Tx,
  targetWs: number,
  actorUserId: number,
  entity: 'issue' | 'project',
  sourceId: number,
  targetId: number
): Promise<void> {
  const join = entity === 'issue' ? issueLabels : projectLabels
  const joinIdCol = entity === 'issue' ? issueLabels.issue_id : projectLabels.project_id
  const rows = await tx
    .select({ label_id: join.label_id })
    .from(join)
    .where(eq(joinIdCol, sourceId))
  if (rows.length === 0) return
  const names = await tx
    .select({ name: labels.name })
    .from(labels)
    .where(inArray(labels.id, rows.map((r) => r.label_id)))
  if (names.length === 0) return
  const targetLabelIds = await resolveOrCreateLabels(
    tx,
    targetWs,
    names.map((n) => n.name),
    actorUserId
  )
  if (targetLabelIds.length === 0) return
  if (entity === 'issue') {
    await tx
      .insert(issueLabels)
      .values(targetLabelIds.map((label_id) => ({ issue_id: targetId, label_id })))
      .onConflictDoNothing()
  } else {
    await tx
      .insert(projectLabels)
      .values(targetLabelIds.map((label_id) => ({ project_id: targetId, label_id })))
      .onConflictDoNothing()
  }
}

async function copyProjectMembers(
  tx: Tx,
  sourceProjectId: number,
  targetProjectId: number,
  targetMembers: Set<number>,
  adjustments: MoveAdjustment[],
  sourceSeq: number | null
): Promise<void> {
  const rows = await tx
    .select({ user_id: projectMembers.user_id, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.project_id, sourceProjectId))
  const kept = rows.filter((r) => targetMembers.has(r.user_id))
  for (const r of rows) {
    if (!targetMembers.has(r.user_id)) {
      adjustments.push({ kind: 'project_member_dropped', entity_type: 'project', source_seq: sourceSeq, detail: `member (user ${r.user_id}) is not a member of the target workspace` })
    }
  }
  if (kept.length === 0) return
  await tx
    .insert(projectMembers)
    .values(kept.map((r) => ({ project_id: targetProjectId, user_id: r.user_id, role: r.role ?? 'member' })))
    .onConflictDoNothing()
}

async function copyProjectUpdates(
  tx: Tx,
  targetWs: number,
  sourceProjectId: number,
  targetProjectId: number,
  keepUser: (uid: number | null) => number | null
): Promise<void> {
  const rows = await tx
    .select()
    .from(projectUpdates)
    .where(eq(projectUpdates.project_id, sourceProjectId))
  if (rows.length === 0) return
  await tx.insert(projectUpdates).values(
    rows.map((u) => ({
      workspace_id: targetWs,
      project_id: targetProjectId,
      status: u.status,
      body: u.body,
      author_id: keepUser(u.author_id),
      created_at: u.created_at,
      updated_at: u.updated_at,
    }))
  )
}

async function copyAttachments(
  tx: Tx,
  targetWs: number,
  sourceIssueId: number,
  targetIssueId: number,
  keepUser: (uid: number | null) => number | null
): Promise<void> {
  // The blob itself is addressed by file_url and shared across workspaces; we
  // only duplicate the metadata row so the file shows up on the copied issue.
  const rows = await tx
    .select()
    .from(attachments)
    .where(eq(attachments.issue_id, sourceIssueId))
  if (rows.length === 0) return
  await tx.insert(attachments).values(
    rows.map((a) => ({
      workspace_id: targetWs,
      issue_id: targetIssueId,
      filename: a.filename,
      file_url: a.file_url,
      file_size: a.file_size,
      mime_type: a.mime_type,
      uploaded_by: keepUser(a.uploaded_by),
      created_at: a.created_at,
    }))
  )
}

// Copy the polymorphic comment thread attached to a source entity onto the
// target entity, preserving thread structure (parent_comment_id), edit stamps
// and timestamps. Comment authors and @mentions are kept only for target
// members. legacyIssueId is set for issue comments (the legacy issue_id column).
async function copyComments(
  tx: Tx,
  sourceWs: number,
  targetWs: number,
  parentType: ItemType,
  sourceParentId: number,
  targetParentId: number,
  legacyIssueId: number | null,
  targetMembers: Set<number>,
  adjustments: MoveAdjustment[],
  entityType: ItemType,
  sourceSeq: number | null
): Promise<void> {
  const rows = await tx
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.workspace_id, sourceWs),
        eq(comments.parent_type, parentType),
        eq(comments.parent_id, sourceParentId)
      )
    )
    .orderBy(comments.id)
  if (rows.length === 0) return

  const commentIdMap = new Map<number, number>()
  for (const c of rows) {
    const author = c.user_id != null && targetMembers.has(c.user_id) ? c.user_id : null
    if (c.user_id != null && author == null) {
      adjustments.push({ kind: 'comment_author_cleared', entity_type: entityType, source_seq: sourceSeq, detail: `comment author (user ${c.user_id}) is not a member of the target workspace` })
    }
    const mentions = c.mentions?.filter((m) => targetMembers.has(m)) ?? null
    if (c.mentions && mentions && mentions.length < c.mentions.length) {
      adjustments.push({ kind: 'mention_dropped', entity_type: entityType, source_seq: sourceSeq, detail: 'one or more @mentions were dropped (not members of the target workspace)' })
    }
    const [inserted] = await tx
      .insert(comments)
      .values({
        workspace_id: targetWs,
        parent_type: parentType,
        parent_id: targetParentId,
        issue_id: legacyIssueId,
        user_id: author,
        content: c.content,
        mentions: mentions && mentions.length > 0 ? mentions : null,
        parent_comment_id: null, // rewired below once we know the new ids
        edited_at: c.edited_at,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })
      .returning({ id: comments.id })
    if (inserted) commentIdMap.set(c.id, inserted.id)
  }

  // Second pass: rewire replies to their (now-copied) parent comment.
  for (const c of rows) {
    if (c.parent_comment_id == null) continue
    const newId = commentIdMap.get(c.id)
    const newParent = commentIdMap.get(c.parent_comment_id)
    if (newId != null && newParent != null) {
      await tx.update(comments).set({ parent_comment_id: newParent }).where(eq(comments.id, newId))
    }
  }
}

// Soft-delete the transferred source rows into the recycle bin, in the current
// transaction. FKs are kept intact (nothing is nulled) so a restore brings the
// group back exactly as it was. Everything goes into one 'cascade' batch since
// they were removed together.
async function softDeleteSource(
  tx: Tx,
  workspaceId: number,
  actorUserId: number,
  projectList: ProjectRow[],
  taskList: TaskRow[],
  issueList: IssueRow[]
): Promise<void> {
  const rootType: ItemType = projectList[0] ? 'project' : taskList[0] ? 'task' : 'issue'
  const rootId = projectList[0]?.id ?? taskList[0]?.id ?? issueList[0]?.id
  if (rootId == null) return

  const [batch] = await tx
    .insert(deletionBatches)
    .values({
      workspace_id: workspaceId,
      actor_user_id: actorUserId,
      mode: 'cascade',
      root_type: rootType,
      root_id: rootId,
    })
    .returning({ id: deletionBatches.id })
  const batchId = batch?.id ?? null
  const now = new Date()
  const stamp = { deleted_at: now, deleted_by: actorUserId, delete_batch_id: batchId }

  // issues → tasks → projects (children first is not required for soft-delete
  // since FKs stay intact, but keeps event order natural).
  for (const i of issueList) {
    await tx.update(issues).set(stamp).where(eq(issues.id, i.id))
    await recordEvent(tx, { workspaceId, actorUserId, entityType: 'issue', entityId: i.id, action: 'deleted', meta: { seq: i.seq, title: i.title, batch_id: batchId, reason: 'moved_to_workspace' } })
  }
  for (const t of taskList) {
    await tx.update(tasks).set(stamp).where(eq(tasks.id, t.id))
    await recordEvent(tx, { workspaceId, actorUserId, entityType: 'task', entityId: t.id, action: 'deleted', meta: { seq: t.seq, title: t.name, batch_id: batchId, reason: 'moved_to_workspace' } })
  }
  for (const p of projectList) {
    await tx.update(projects).set(stamp).where(eq(projects.id, p.id))
    await recordEvent(tx, { workspaceId, actorUserId, entityType: 'project', entityId: p.id, action: 'deleted', meta: { seq: p.seq, title: p.name, batch_id: batchId, reason: 'moved_to_workspace' } })
  }
}
