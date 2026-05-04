import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { attachments } from '../schema'
import type { Attachment } from '../schema'

export async function getAttachments(issueId: number) {
  const result = await db.execute(sql`
    SELECT
      a.*,
      u.name as uploader_name,
      u.avatar_url as uploader_avatar
    FROM attachments a
    LEFT JOIN users u ON u.id = a.uploaded_by
    WHERE a.issue_id = ${issueId}
    ORDER BY a.created_at DESC
  `)
  return result.rows
}

export async function createAttachment(data: {
  issue_id: number
  filename: string
  file_url: string
  file_size?: number
  mime_type?: string
  uploaded_by?: number
}): Promise<Attachment | null> {
  const [created] = await db
    .insert(attachments)
    .values({
      issue_id: data.issue_id,
      filename: data.filename,
      file_url: data.file_url,
      file_size: data.file_size,
      mime_type: data.mime_type,
      uploaded_by: data.uploaded_by,
    })
    .returning()
  return created ?? null
}

export async function deleteAttachment(id: number) {
  await db.delete(attachments).where(eq(attachments.id, id))
}

export async function getAttachment(id: number): Promise<Attachment | null> {
  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1)
  return rows[0] ?? null
}
