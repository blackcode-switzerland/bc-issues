import { db } from '@/lib/db/client'
import { emailWhitelist } from '@/lib/db/schema'
import { eq, and, or } from 'drizzle-orm'

export async function isEmailAllowedByDb(email: string): Promise<boolean> {
  const domain = email.split('@')[1]
  if (!domain) return false

  const result = await db
    .select({ id: emailWhitelist.id })
    .from(emailWhitelist)
    .where(
      or(
        and(eq(emailWhitelist.type, 'email'), eq(emailWhitelist.value, email)),
        and(eq(emailWhitelist.type, 'domain'), eq(emailWhitelist.value, domain))
      )
    )
    .limit(1)

  return result.length > 0
}

export async function listWhitelist() {
  return db
    .select()
    .from(emailWhitelist)
    .orderBy(emailWhitelist.created_at)
}

export async function addWhitelistEntry(data: {
  type: 'email' | 'domain'
  value: string
  added_by?: number | null
}) {
  const [entry] = await db
    .insert(emailWhitelist)
    .values(data)
    .onConflictDoNothing()
    .returning()
  return entry ?? null
}

export async function removeWhitelistEntry(id: number) {
  await db.delete(emailWhitelist).where(eq(emailWhitelist.id, id))
}
