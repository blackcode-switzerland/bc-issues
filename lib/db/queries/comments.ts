// Polymorphic comments — attach to issue, milestone, or project.
//
// New code uses parent_type + parent_id. The legacy issue_id column is kept
// (NOT NULL for now) and mirrored on issue-parent comments so the old code
// path doesn't break.

import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { comments, issues, milestones, projects, users, type Comment } from '../schema'
import { recordEvent } from './events'

export type CommentParentType = 'issue' | 'milestone' | 'project'

export interface CommentListItem extends Comment {
  author_name: string | null
  author_email: string | null
  author_avatar: string | null
}

export async function listComments(
  parentType: CommentParentType,
  parentId: number
): Promise<CommentListItem[]> {
  const rows = await db
    .select({
      c: comments,
      author_name: users.name,
      author_email: users.email,
      author_avatar: users.avatar_url,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.user_id))
    .where(and(eq(comments.parent_type, parentType), eq(comments.parent_id, parentId)))
    .orderBy(asc(comments.created_at))
  return rows.map((r) => ({
    ...r.c,
    author_name: r.author_name,
    author_email: r.author_email,
    author_avatar: r.author_avatar,
  }))
}

// Legacy helper still called by /api/issues/[id]/comments via the old name.
export async function getComments(issueId: number) {
  return await listComments('issue', issueId)
}

// Verify a polymorphic parent exists in the given workspace. Used by the
// comment routes before insert.
export async function verifyCommentParent(
  workspaceId: number,
  parentType: CommentParentType,
  parentId: number
): Promise<boolean> {
  if (parentType === 'issue') {
    const rows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, parentId), eq(issues.workspace_id, workspaceId)))
      .limit(1)
    return !!rows[0]
  }
  if (parentType === 'milestone') {
    const rows = await db
      .select({ id: milestones.id })
      .from(milestones)
      .where(and(eq(milestones.id, parentId), eq(milestones.workspace_id, workspaceId)))
      .limit(1)
    return !!rows[0]
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, parentId), eq(projects.workspace_id, workspaceId)))
    .limit(1)
  return !!rows[0]
}

export interface CreateCommentInput {
  workspaceId: number
  parentType: CommentParentType
  parentId: number
  userId: number
  content: string
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({
        workspace_id: input.workspaceId,
        parent_type: input.parentType,
        parent_id: input.parentId,
        // Legacy column — mirrored only for 'issue' parents so existing
        // queries that join on issue_id keep working until Phase 13 drops it.
        // For non-issue parents, the column has a NOT NULL constraint from
        // the original schema, so we point it at parent_id (which always
        // satisfies the FK because issues exist for issue parents; for
        // milestone/project parents it would violate FK). Need to relax
        // issue_id constraint first — see migration in this phase.
        issue_id: input.parentType === 'issue' ? input.parentId : null,
        user_id: input.userId,
        content: input.content,
      })
      .returning()
    if (!row) throw new Error('comment insert returned nothing')

    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: 'comment',
      entityId: row.id,
      action: 'created',
      meta: {
        parent_type: input.parentType,
        parent_id: input.parentId,
        excerpt: input.content.slice(0, 120),
      },
    })

    // Surface a 'commented' event on the parent entity so issue activity and
    // watcher fan-out work cleanly.
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: input.parentType,
      entityId: input.parentId,
      action: 'commented',
      meta: {
        comment_id: row.id,
        excerpt: input.content.slice(0, 120),
      },
    })
    return row
  })
}

export async function updateComment(
  workspaceId: number,
  id: number,
  content: string,
  actorUserId: number
): Promise<Comment | null> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return null
    if (before.user_id !== actorUserId) {
      throw new Error('forbidden')
    }
    const [after] = await tx
      .update(comments)
      .set({ content, edited_at: new Date(), updated_at: new Date() })
      .where(and(eq(comments.id, id), eq(comments.workspace_id, workspaceId)))
      .returning()
    if (!after) return null

    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'comment',
      entityId: id,
      action: 'updated',
      diff: { before: { content: before.content }, after: { content: after.content } },
    })
    return after
  })
}

export async function deleteComment(
  workspaceId: number,
  id: number,
  actorUserId: number
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return false
    if (before.user_id !== actorUserId) {
      throw new Error('forbidden')
    }
    await recordEvent(tx, {
      workspaceId,
      actorUserId,
      entityType: 'comment',
      entityId: id,
      action: 'deleted',
      meta: {
        parent_type: before.parent_type,
        parent_id: before.parent_id,
      },
    })
    const result = await tx
      .delete(comments)
      .where(and(eq(comments.id, id), eq(comments.workspace_id, workspaceId)))
    return (result.rowCount ?? 0) > 0
  })
}

// Keep void to silence unused warning if sql is removed; left for future helpers.
void sql
