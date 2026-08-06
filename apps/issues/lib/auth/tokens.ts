// Moved to @blackcode/platform-auth in Phase 6.
//
// One binary, one login, one token (docs/platform-architecture.md §6): the same
// `bk_live_…` string authenticates every app, so a per-app verifier would be a
// second chance to get constant-time comparison, expiry or the prefix check
// wrong against one shared `platform.api_tokens`.
//
// The package takes the database handle as its first argument, matching
// `requireAppAccess`. These wrappers bind this app's `db` so every existing
// `@/lib/auth/tokens` call site is unchanged.
import { db } from '@/lib/db/client'
import {
  mintToken as mintTokenImpl,
  verifyToken as verifyTokenImpl,
  listTokens as listTokensImpl,
  revokeToken as revokeTokenImpl,
  type MintedToken,
  type TokenSummary,
} from '@blackcode/platform-auth'
import type { User } from '@/lib/db/schema'

export type { MintedToken, TokenSummary }

export function mintToken(opts: {
  user_id: number
  name: string
  scopes?: string[]
  expires_at?: Date | null
}): Promise<MintedToken> {
  return mintTokenImpl(db, opts)
}

export function verifyToken(plaintext: string): Promise<User | null> {
  return verifyTokenImpl(db, plaintext)
}

export function listTokens(user_id: number): Promise<TokenSummary[]> {
  return listTokensImpl(db, user_id)
}

export function revokeToken(token_id: number, user_id: number): Promise<boolean> {
  return revokeTokenImpl(db, token_id, user_id)
}
