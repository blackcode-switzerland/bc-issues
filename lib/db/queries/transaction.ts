import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { issues, transactionLog } from '../schema'

export async function logTransaction(data: {
  user_id: number
  operation_type: string
  table_name: string
  record_id: number
  old_data?: unknown
  new_data?: unknown
}) {
  const [row] = await db
    .insert(transactionLog)
    .values({
      user_id: data.user_id,
      operation_type: data.operation_type,
      table_name: data.table_name,
      record_id: data.record_id,
      old_data: data.old_data ?? null,
      new_data: data.new_data ?? null,
    })
    .returning()
  return row ?? null
}

export async function getTransactionLog(limit = 50) {
  return db.select().from(transactionLog).orderBy(desc(transactionLog.created_at)).limit(limit)
}

export async function getActivityFeed(limit = 50, offset = 0) {
  const result = await db.execute(sql`
    SELECT
      t.*,
      u.name as user_name,
      u.avatar_url as user_avatar
    FROM transaction_log t
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)
  return result.rows
}

export async function undoLastOperations(userId: number, count = 1) {
  const ops = await db
    .select()
    .from(transactionLog)
    .where(and(eq(transactionLog.user_id, userId), eq(transactionLog.rolled_back, false)))
    .orderBy(desc(transactionLog.created_at))
    .limit(count)

  const results: typeof ops = []
  for (const op of ops) {
    try {
      if (op.table_name === 'issues' && op.operation_type === 'UPDATE' && op.old_data) {
        const old = op.old_data as Record<string, unknown>
        await db
          .update(issues)
          .set({
            title: old.title as string,
            description: (old.description as string) ?? null,
            status: (old.status as string) ?? 'backlog',
            priority: (old.priority as number) ?? 3,
            assignee_id: (old.assignee_id as number) ?? null,
            milestone_id: (old.milestone_id as number) ?? null,
            updated_at: new Date(),
          })
          .where(eq(issues.id, op.record_id))
      } else if (op.table_name === 'issues' && op.operation_type === 'INSERT') {
        await db.delete(issues).where(eq(issues.id, op.record_id))
      }

      await db
        .update(transactionLog)
        .set({ rolled_back: true })
        .where(eq(transactionLog.id, op.id))
      results.push(op)
    } catch (error) {
      console.error('Undo operation failed:', error)
    }
  }

  return results
}
