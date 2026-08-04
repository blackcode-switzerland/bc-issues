import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { apiTokens, users } from '@/lib/db/schema'
import type { User } from '@/lib/db/schema'

const TOKEN_PREFIX = 'bk_live_'
const SECRET_BYTES = 32
const PREFIX_VISIBLE_LEN = 8

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export interface MintedToken {
  id: number
  plaintext: string
  prefix: string
  name: string
  scopes: string[]
  expires_at: Date | null
  created_at: Date | null
}

export async function mintToken(opts: {
  user_id: number
  name: string
  scopes?: string[]
  expires_at?: Date | null
}): Promise<MintedToken> {
  const secret = randomBytes(SECRET_BYTES).toString('base64url')
  const plaintext = `${TOKEN_PREFIX}${secret}`
  const token_hash = sha256(plaintext)
  const token_prefix = secret.slice(0, PREFIX_VISIBLE_LEN)

  const [row] = await db
    .insert(apiTokens)
    .values({
      user_id: opts.user_id,
      name: opts.name,
      token_hash,
      token_prefix,
      scopes: opts.scopes ?? ['full'],
      expires_at: opts.expires_at ?? null,
    })
    .returning()

  if (!row) throw new Error('Failed to create token')

  return {
    id: row.id,
    plaintext,
    prefix: token_prefix,
    name: row.name,
    scopes: row.scopes,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }
}

export async function verifyToken(plaintext: string): Promise<User | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null

  const expected_hash = sha256(plaintext)
  const expected_buf = Buffer.from(expected_hash, 'hex')

  const candidates = await db
    .select({
      id: apiTokens.id,
      user_id: apiTokens.user_id,
      token_hash: apiTokens.token_hash,
      expires_at: apiTokens.expires_at,
    })
    .from(apiTokens)
    .where(eq(apiTokens.token_hash, expected_hash))
    .limit(1)

  const candidate = candidates[0]
  if (!candidate) return null

  const stored_buf = Buffer.from(candidate.token_hash, 'hex')
  if (
    stored_buf.length !== expected_buf.length ||
    !timingSafeEqual(stored_buf, expected_buf)
  ) {
    return null
  }

  if (candidate.expires_at && candidate.expires_at.getTime() < Date.now()) {
    return null
  }

  await db
    .update(apiTokens)
    .set({ last_used_at: new Date() })
    .where(eq(apiTokens.id, candidate.id))

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, candidate.user_id))
    .limit(1)
  return userRows[0] ?? null
}

export async function listTokens(user_id: number) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      token_prefix: apiTokens.token_prefix,
      scopes: apiTokens.scopes,
      last_used_at: apiTokens.last_used_at,
      expires_at: apiTokens.expires_at,
      created_at: apiTokens.created_at,
    })
    .from(apiTokens)
    .where(eq(apiTokens.user_id, user_id))
    .orderBy(sql`${apiTokens.created_at} DESC`)
}

export async function revokeToken(token_id: number, user_id: number): Promise<boolean> {
  const result = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, token_id), eq(apiTokens.user_id, user_id)))
    .returning({ id: apiTokens.id })
  return result.length > 0
}
