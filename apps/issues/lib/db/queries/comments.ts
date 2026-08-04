// Polymorphic comments — attach to issue, task, or project.
//
// New code uses parent_type + parent_id. The legacy issue_id column is kept
// (NOT NULL for now) and mirrored on issue-parent comments so the old code
// path doesn't break.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import {
  comments,
  issues,
  tasks,
  projects,
  users,
  workspaceMembers,
  type Comment,
} from '../schema'
import { recordEvent } from './events'
import { toRichTextHtml } from '@/lib/rich-text'
import { extractUploadedUrls } from '@/lib/blob-refs'
import { sweepOrphanedUrls } from '@/lib/blob-gc'

const MENTION_RE = /@([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g

// Resolve @email mentions in comment content to workspace member user_ids.
// Returns the list of user_ids that:
//   (a) are referenced by @<email> in the content,
//   (b) are members of the given workspace, and
//   (c) are not the comment author (no self-mentions).
async function resolveMentions(
  tx: Tx,
  workspaceId: number,
  content: string,
  authorUserId: number
): Promise<number[]> {
  const emails = new Set<string>()
  for (const match of content.matchAll(MENTION_RE)) {
    emails.add(match[1].toLowerCase())
  }
  if (emails.size === 0) return []

  const rows = await tx
    .select({ user_id: workspaceMembers.user_id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.user_id))
    .where(
      and(
        eq(workspaceMembers.workspace_id, workspaceId),
        sql`lower(${users.email}) IN (${sql.join(
          Array.from(emails).map((e) => sql`${e}`),
          sql`, `
        )})`,
        sql`${users.deleted_at} IS NULL`
      )
    )
  const ids = new Set(rows.map((r) => r.user_id))
  ids.delete(authorUserId)
  return Array.from(ids)
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type CommentParentType = 'issue' | 'task' | 'project'

export interface CommentListItem extends Comment {
  author_name: string | null
  author_email: string | null
  author_avatar: string | null
  // parent_comment_id is already on Comment via schema inference; re-declared here
  // for the client type so it's always present (never undefined).
  parent_comment_id: number | null
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
    parent_comment_id: r.c.parent_comment_id ?? null,
  }))
}

// Resolve a polymorphic parent's workspace #number (seq) from its internal id.
// Used when serializing a comment fetched by its own id (the parent's #number
// isn't in the request path). Returns null if the parent no longer exists.
export async function resolveParentSeq(
  parentType: CommentParentType,
  parentId: number
): Promise<number | null> {
  const table = parentType === 'issue' ? issues : parentType === 'task' ? tasks : projects
  const rows = await db.select({ seq: table.seq }).from(table).where(eq(table.id, parentId)).limit(1)
  return rows[0]?.seq ?? null
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
      .where(
        and(
          eq(issues.id, parentId),
          eq(issues.workspace_id, workspaceId),
          isNull(issues.deleted_at)
        )
      )
      .limit(1)
    return !!rows[0]
  }
  if (parentType === 'task') {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, parentId),
          eq(tasks.workspace_id, workspaceId),
          isNull(tasks.deleted_at)
        )
      )
      .limit(1)
    return !!rows[0]
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, parentId), eq(projects.workspace_id, workspaceId), isNull(projects.deleted_at))
    )
    .limit(1)
  return !!rows[0]
}

export interface CreateCommentInput {
  workspaceId: number
  parentType: CommentParentType
  parentId: number
  userId: number
  content: string
  parentCommentId?: number | null
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  return await db.transaction(async (tx) => {
    const mentionedUserIds = await resolveMentions(
      tx,
      input.workspaceId,
      input.content,
      input.userId
    )

    const [row] = await tx
      .insert(comments)
      .values({
        workspace_id: input.workspaceId,
        parent_type: input.parentType,
        parent_id: input.parentId,
        // Legacy column — mirrored only for 'issue' parents so existing
        // queries that join on issue_id keep working until Phase 13 drops it.
        issue_id: input.parentType === 'issue' ? input.parentId : null,
        user_id: input.userId,
        content: toRichTextHtml(input.content),
        mentions: mentionedUserIds.length > 0 ? mentionedUserIds : null,
        parent_comment_id: input.parentCommentId ?? null,
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
    // watcher fan-out work cleanly. Mention recipients are passed in meta so
    // fanOutCommented can skip them (they'll get a dedicated 'mention' row).
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      entityType: input.parentType,
      entityId: input.parentId,
      action: 'commented',
      meta: {
        comment_id: row.id,
        excerpt: input.content.slice(0, 120),
        mentioned_user_ids: mentionedUserIds,
      },
    })

    // One 'mentioned' event per mentioned user — fanOutEvent will turn each
    // into a typed inbox row.
    for (const uid of mentionedUserIds) {
      await recordEvent(tx, {
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        entityType: input.parentType,
        entityId: input.parentId,
        action: 'mentioned',
        meta: {
          mentioned_user_id: uid,
          comment_id: row.id,
          excerpt: input.content.slice(0, 120),
        },
      })
    }

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
      .set({ content: toRichTextHtml(content), edited_at: new Date(), updated_at: new Date() })
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
  const { deleted, content } = await db.transaction(async (tx) => {
    const beforeRows = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.workspace_id, workspaceId)))
      .limit(1)
    const before = beforeRows[0]
    if (!before) return { deleted: false, content: null as string | null }
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
    return { deleted: (result.rowCount ?? 0) > 0, content: before.content }
  })

  // After the comment is gone, auto-remove any files it embedded that nothing
  // else references (best-effort; never affects the delete result).
  if (deleted && content) {
    await sweepOrphanedUrls(extractUploadedUrls(content))
  }
  return deleted
}

// Keep void to silence unused warning if sql is removed; left for future helpers.
void sql
