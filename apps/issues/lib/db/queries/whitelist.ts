import { db } from '@/lib/db/client'
import { emailWhitelist } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// `isEmailAllowedByDb` moved to @blackcode/platform-auth in Phase 6 — who may
// exist on the platform is not one app's decision. Re-exported through
// `@/lib/auth/whitelist`, which binds this app's `db`. The CRUD below stays here:
// it backs this app's super-admin screens, not the gate itself.
export { isEmailAllowedByDb } from '@/lib/auth/whitelist'

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
